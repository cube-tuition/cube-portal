'use client'
import { authedFetch } from '../../../../lib/authedFetch'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { fetchAllTerms, getCurrentTerm } from '../../../../lib/terms'
import { T_CLASSES, T_ENROLMENTS, T_STUDENTS, T_PARENTS } from '../../../../lib/tables'
import { TEST_RECIPIENT } from '../../../../lib/emailConfig'
import { loadEmailOverrides, saveEmailOverride, deleteEmailOverride, familyKey,
         loadReportExclusions, setReportExcluded, reportKey } from '../../../../lib/emailOverrides'

/*
 * End-of-Term Reports Email — /tutor/emails/end-of-term
 *
 * Workflow:
 *   1. Select a term
 *   2. Upload a PDF report per student (stored in Supabase Storage: term-reports/{termId}/{studentId}_{classId}.pdf)
 *   3. Preview family groupings — siblings combined into one email
 *   4. Send via Resend API
 *
 * Prerequisites:
 *   - Create a "term-reports" bucket in Supabase Storage (Dashboard → Storage)
 *   - npm install resend
 *   - Add RESEND_API_KEY + SUPABASE_SERVICE_ROLE_KEY to .env.local
 */

const STORAGE_BUCKET = 'term-reports'

const DEFAULT_TEMPLATE = `Hi {{parent_name}},

Thank you so much for being part of CUBE Tuition this {{term_name}}. We've truly enjoyed working with {{student_names}} and are proud of the progress {{they_have}} made this term.

Please find attached {{possessive}} end-of-term report{{plural}}. We hope it gives a great overview of the work covered and achievements made.

The report includes an overview of their progress, strengths, and areas for improvement during the term. We encourage you to review it and reach out if you have any questions or would like to discuss any aspect of their learning journey further.

We look forward to seeing you again next term!

Kind regards,
The CUBE Team`

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatNames(names) {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return names.slice(0, -1).join(', ') + ' and ' + names.slice(-1)
}

function followupDate() {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function fillTemplate(template, vars) {
  return template
    .replace(/\{\{parent_name\}\}/g,    vars.parentName    || 'there')
    .replace(/\{\{term_name\}\}/g,      vars.termName      || '')
    .replace(/\{\{student_names\}\}/g,  vars.studentNames  || '')
    .replace(/\{\{possessive\}\}/g,     vars.possessive    || 'their')
    .replace(/\{\{they_have\}\}/g,      vars.theyHave      || 'they have')
    .replace(/\{\{plural\}\}/g,         vars.plural        || '')
    .replace(/\{\{followup_date\}\}/g,  vars.followupDate  || followupDate())
    .replace(/\[date\]/gi,              vars.followupDate  || followupDate())
}

// Resolve a family's plain-text body from a template (placeholders filled).
// Students are de-duplicated by id so a child in two classes isn't repeated —
// matching what the send route does. Used for the preview, the per-family
// editor pre-fill, and the email HTML.
function resolvedBody(template, family, termName) {
  const unique       = family.students.filter((s, i, a) => a.findIndex(x => x.student_id === s.student_id) === i)
  const firstNames   = unique.map(s => s.student_name.split(' ')[0])
  const count        = firstNames.length
  return fillTemplate(template, {
    parentName:   family.parent_name || 'there',
    termName,
    studentNames: formatNames(firstNames),
    possessive:   'their',
    theyHave:     'they have',
    plural:       count > 1 ? 's' : '',
  })
}

function buildEmailHtml(template, family, termName) {
  const bodyText = resolvedBody(template, family, termName)
  const escaped = bodyText
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const paragraphs = escaped
    .split(/\n\n+/)
    .map(p => `<p style="margin:0 0 16px 0;line-height:1.7;">${p.replace(/\n/g, '<br/>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`)
    .join('')
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:#2A2035;background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">
      <div style="background:#062E63;background:linear-gradient(120deg,#04204a 0%,#062E63 48%,#0d3f80 100%);border-radius:14px;padding:26px 30px;margin-bottom:32px;">
        <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">CUBE</span>
        <span style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
        <div style="height:3px;width:48px;background:linear-gradient(90deg,#5b7bc4,#9db8e8);border-radius:2px;margin-top:14px;font-size:0;line-height:0;">&nbsp;</div>
      </div>
      <div style="font-size:15px;">${paragraphs}</div>
    </div>
  </body></html>`
}

// ── Sent-status persistence ─────────────────────────────────────────────────
// "Sent" results are shared across browsers/environments via portal_settings
// (localStorage is only a per-browser cache — that's why localhost showed a
// family as sent but the live portal didn't).
const eotResultsKey = (termId) => `eot_results_${termId}`

function mergeEotResults(a = [], b = []) {
  const byEmail = new Map()
  for (const r of [...a, ...b]) {
    if (!r?.email) continue
    const ex = byEmail.get(r.email)
    if (!ex || (!ex.success && r.success)) byEmail.set(r.email, r) // prefer a successful send
  }
  return [...byEmail.values()]
}

// Accumulate-only: merge with whatever is already stored so a stale or empty
// client state can never erase a previously-recorded send. (There is no
// "un-send" — a family is either sent or not yet, so successes only ever add.)
async function saveEotResultsToDb(termId, results) {
  if (!termId) return
  try {
    const { data } = await supabase.from('portal_settings').select('value').eq('key', eotResultsKey(termId)).maybeSingle()
    let existing = []
    try { existing = JSON.parse(data?.value || '[]') || [] } catch {}
    const merged = mergeEotResults(existing, results || [])
    await supabase.from('portal_settings').upsert({
      key: eotResultsKey(termId),
      value: JSON.stringify(merged),
      updated_at: new Date().toISOString(),
    })
  } catch { /* non-fatal: localStorage still holds the cache */ }
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function EndOfTermEmailPage() {
  const router = useRouter()

  const [profile,  setProfile]  = useState(null)
  const [terms,    setTerms]    = useState([])
  const [termId,   setTermId]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [students, setStudents] = useState([])   // enriched enrolment rows
  const [uploads,  setUploads]  = useState({})   // key → { exists, uploading }
  const TEMPLATE_KEY = 'cube_eot_template'
  const [template, setTemplate] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(TEMPLATE_KEY) || DEFAULT_TEMPLATE
    }
    return DEFAULT_TEMPLATE
  })
  const [tab,      setTab]      = useState('preview') // 'preview' | 'template'
  const resultsKey = termId ? `cube_eot_results_${termId}` : null
  const [results,  setResults]  = useState(() => {
    if (typeof window !== 'undefined' && termId) {
      try { return JSON.parse(localStorage.getItem(`cube_eot_results_${termId}`)) || [] } catch { return [] }
    }
    return []
  })
  const [sending,      setSending]      = useState(false)
  const [error,        setError]        = useState(null)
  const [previewFamily, setPreviewFamily] = useState(null) // family object to preview, or null

  // Per-family personalised email bodies: { [familyKey]: body }. Loaded from the
  // DB per term so they're shared across staff/devices.
  const [overrides,     setOverrides]     = useState({})
  const [editFamily,    setEditFamily]    = useState(null) // family being edited, or null
  const [editBody,      setEditBody]      = useState('')
  const [savingOverride, setSavingOverride] = useState(false)

  // Excluded reports: Set<"studentId_classId"> — these reports are NOT attached
  // when emailing the family. Loaded per term from the DB.
  const [excludedReports, setExcludedReports] = useState(() => new Set())

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) {
        router.replace('/tutor'); return
      }
      setProfile(profile)
    })
    fetchAllTerms().then(allTerms => {
      setTerms(allTerms)
      const cur = getCurrentTerm(allTerms)
      if (cur) setTermId(cur.id)
      setLoading(false)
    })
  }, [router])

  // ── Refresh storage upload statuses ──────────────────────────────────────
  async function checkStorageUploads(rows, tId) {
    if (!tId || !rows?.length) return

    const { data: files, error: listErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(tId)

    if (listErr) {
      setError(`Storage check failed: ${listErr.message}`)
      return
    }

    const existingFiles = new Set((files || []).map(f => f.name))
    const next = {}
    for (const r of rows) {
      const key = `${r.student_id}_${r.class_id}`
      next[key] = { exists: existingFiles.has(`${key}.pdf`), uploading: false }
    }
    setUploads(next)
  }

  // ── Load students ─────────────────────────────────────────────────────────
  const loadStudents = useCallback(async () => {
    if (!termId) return
    setLoading(true)
    setError(null)
    try {
      // Classes for this term only — no all-terms fallback: end-of-term emails
      // must never pick up another term's copy of a class.
      let { data: cls } = await supabase.from(T_CLASSES).select('id, class_name').eq('term_id', termId)
      // 1:1 students don't get written reports — exclude 1:1 classes entirely.
      cls = (cls || []).filter(c => !/\b1\s*:\s*1\b/.test(c.class_name || ''))
      const classMap = Object.fromEntries((cls || []).map(c => [c.id, c]))
      const classIds = (cls || []).map(c => c.id)
      if (!classIds.length) { setStudents([]); setLoading(false); return }

      // Active enrolments
      const { data: enr, error: enrErr } = await supabase
        .from(T_ENROLMENTS).select('id, student_id, class_id, status')
        .in('class_id', classIds)
        .in('status', ['active', 'trial'])
      if (enrErr) throw new Error(enrErr.message)
      if (!enr?.length) { setStudents([]); setLoading(false); return }

      // Students
      const studentIds = [...new Set(enr.map(e => e.student_id))]
      const { data: studs } = await supabase
        .from(T_STUDENTS).select('id, full_name, year, family_id').in('id', studentIds)
      const studMap = Object.fromEntries((studs || []).map(s => [s.id, s]))

      // Parents — look up by student_id (UUID) to avoid family_id serial collisions
      let parentMap = {}
      if (studentIds.length) {
        const { data: parents } = await supabase
          .from(T_PARENTS).select('student_id, full_name, email').in('student_id', studentIds)
        parentMap = Object.fromEntries((parents || []).map(p => [p.student_id, p]))
      }

      const rows = enr.map(e => {
        const s = studMap[e.student_id] || {}
        const p = parentMap[e.student_id] || {}
        const c = classMap[e.class_id] || {}
        return {
          enrolment_id: e.id,
          student_id:   e.student_id,
          class_id:     e.class_id,
          student_name: s.full_name || '—',
          year:         s.year,
          class_name:   c.class_name || '—',
          family_id:    s.family_id || null,
          parent_name:  p.full_name || '',
          parent_email: p.email || '',
        }
      }).sort((a, b) => (a.class_name + a.student_name).localeCompare(b.class_name + b.student_name))

      setStudents(rows)
      await checkStorageUploads(rows, termId)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [termId])

  useEffect(() => { loadStudents() }, [loadStudents])

  // ── Persist + restore results per term (DB-backed, shared across devices) ───
  const loadedRef = useRef(false)
  useEffect(() => {
    if (!termId) return
    loadedRef.current = false
    let cancelled = false
    ;(async () => {
      let db = []
      try {
        const { data } = await supabase.from('portal_settings').select('value').eq('key', eotResultsKey(termId)).maybeSingle()
        if (data?.value) db = JSON.parse(data.value) || []
      } catch { /* fall back to local cache */ }
      let local = []
      try { local = JSON.parse(localStorage.getItem(`cube_eot_results_${termId}`) || '[]') || [] } catch {}
      if (cancelled) return
      const merged = mergeEotResults(db, local)
      setResults(merged)
      loadedRef.current = true
      // One-time migration: push any browser-only sends up to the shared store.
      if (merged.length > db.length) saveEotResultsToDb(termId, merged)
    })()
    return () => { cancelled = true }
  }, [termId])

  useEffect(() => {
    if (!resultsKey) return
    try { localStorage.setItem(resultsKey, JSON.stringify(results)) } catch {}
    // Only write to the DB after the initial load, so an empty mount can't
    // clobber previously-recorded sends.
    if (termId && loadedRef.current) saveEotResultsToDb(termId, results)
  }, [results, resultsKey, termId])


  // ── Family grouping ────────────────────────────────────────────────────────
  const families = useMemo(() => {
    const map = {}
    for (const s of students) {
      const key = s.family_id || `student:${s.student_id}`
      if (!map[key]) map[key] = {
        family_id:    s.family_id,
        parent_name:  s.parent_name || s.student_name,
        parent_email: s.parent_email,
        students:     [],
      }
      if (!map[key].students.find(x => x.student_id === s.student_id && x.class_id === s.class_id)) {
        map[key].students.push({
          student_id:   s.student_id,
          student_name: s.student_name,
          class_id:     s.class_id,
          class_name:   s.class_name,
        })
      }
    }
    return Object.values(map)
  }, [students])

  // Load per-family personalised bodies + per-report exclusions for the term.
  // (Both resolve to empty when there's no term, so the set happens off the
  // effect body and doesn't trip the set-state-in-effect rule.)
  useEffect(() => {
    loadEmailOverrides(termId, 'end_of_term').then(setOverrides)
    loadReportExclusions(termId).then(setExcludedReports)
  }, [termId])

  // Report inclusion helpers.
  const isExcluded       = (s) => excludedReports.has(reportKey(s.student_id, s.class_id))
  const includedStudents = (f) => f.students.filter(s => !isExcluded(s))
  const toggleReport = async (s) => {
    const key = reportKey(s.student_id, s.class_id)
    const nowExcluded = !excludedReports.has(key)
    setExcludedReports(prev => {
      const next = new Set(prev)
      if (nowExcluded) next.add(key); else next.delete(key)
      return next
    })
    const { error: err } = await setReportExcluded(termId, s.student_id, s.class_id, nowExcluded, profile?.full_name)
    if (err) {
      setError(err.message)
      // Roll back the optimistic toggle on failure.
      setExcludedReports(prev => {
        const next = new Set(prev)
        if (nowExcluded) next.delete(key); else next.add(key)
        return next
      })
    }
  }

  // ── Derived counts ─────────────────────────────────────────────────────────
  const term = terms.find(t => t.id === termId)
  const uploadedCount = students.filter(s => uploads[`${s.student_id}_${s.class_id}`]?.exists).length
  const familiesWithEmail = families.filter(f => f.parent_email)

  // Per-STUDENT "not yet sent" list. Family grouping can hide students with no
  // family/parent email, so we track unsent reports at the student level too.
  const sentEmails = new Set(results.filter(r => r.success).map(r => r.email))
  // Excluded reports are intentionally not sent — keep them out of the
  // "not yet sent" warning.
  const unsentStudents = students.filter(s => !isExcluded(s) && !(s.parent_email && sentEmails.has(s.parent_email)))

  // ── Send emails ───────────────────────────────────────────────────────────
  const [sendingFamily, setSendingFamily] = useState(null) // email address of family being individually sent
  const [confirmSend,  setConfirmSend]  = useState(null)  // { families, label } | null — pending confirmation

  const sendToFamilies = async (familiesToSend, test = false) => {
    // Drop excluded reports, and any family left with no reports to send.
    const payloadFamilies = familiesToSend
      .map(f => ({ ...f, students: includedStudents(f), custom_body: overrides[familyKey(f)] || null }))
      .filter(f => f.students.length > 0)
    if (payloadFamilies.length === 0) throw new Error('No reports selected to send for this family.')
    const res = await authedFetch('/api/send-end-of-term-emails', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        term_id:   termId,
        term_name: term?.name || '',
        template,
        families:  payloadFamilies,
        test,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Send failed')
    return data.results || []
  }

  // ── Per-family email personalisation ────────────────────────────────────────
  const openEditor = (family) => {
    const key = familyKey(family)
    setEditFamily(family)
    setEditBody(overrides[key] ?? resolvedBody(template, { ...family, students: includedStudents(family) }, term?.name || ''))
  }
  const saveEditor = async () => {
    if (!editFamily) return
    const key = familyKey(editFamily)
    setSavingOverride(true); setError(null)
    const { error: err } = await saveEmailOverride(termId, 'end_of_term', key, editBody, profile?.full_name)
    setSavingOverride(false)
    if (err) { setError(err.message); return }
    setOverrides(prev => ({ ...prev, [key]: editBody }))
    setEditFamily(null)
  }
  const resetEditor = async () => {
    if (!editFamily) return
    const key = familyKey(editFamily)
    setSavingOverride(true); setError(null)
    const { error: err } = await deleteEmailOverride(termId, 'end_of_term', key)
    setSavingOverride(false)
    if (err) { setError(err.message); return }
    setOverrides(prev => { const next = { ...prev }; delete next[key]; return next })
    setEditFamily(null)
  }

  // Test send — delivers this family's exact email to CUBE staff only (marked
  // TEST). Never touches the family's real "sent" status.
  const [testingFamily, setTestingFamily] = useState(null)
  const [testNote, setTestNote] = useState(null)
  const handleTestOne = async (family) => {
    setTestingFamily(family.parent_email); setError(null); setTestNote(null)
    try {
      await sendToFamilies([family], true)
      setTestNote(`Test for ${family.parent_name || family.parent_email} sent to ${TEST_RECIPIENT}.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setTestingFamily(null)
    }
  }

  const executeSend = async ({ families: fams, isBulk }) => {
    setConfirmSend(null)
    if (isBulk) {
      setSending(true)
      setError(null)
      try {
        const newResults = await sendToFamilies(fams)
        // Merge with prior sends so a partial "send unsent" batch never drops
        // (or un-persists) families sent earlier.
        setResults(prev => mergeEotResults(prev, newResults))
      } catch (e) {
        setError(e.message)
      } finally {
        setSending(false)
      }
    } else {
      const family = fams[0]
      setSendingFamily(family.parent_email)
      setError(null)
      try {
        const newResults = await sendToFamilies([family])
        setResults(prev => {
          const filtered = prev.filter(r => r.email !== family.parent_email)
          return [...filtered, ...newResults]
        })
      } catch (e) {
        setError(e.message)
      } finally {
        setSendingFamily(null)
      }
    }
  }

  const handleSend = () => {
    const term = terms.find(t => t.id === termId)
    const unsentFamilies = familiesWithEmail.filter(f =>
      includedStudents(f).length > 0 && !results.find(r => r.email === f.parent_email && r.success))
    if (!unsentFamilies.length) return
    setConfirmSend({
      families: unsentFamilies,
      isBulk: true,
      label: `Send to ${unsentFamilies.length} unsent ${unsentFamilies.length === 1 ? 'family' : 'families'}`,
      detail: `${term?.name || 'this term'} · ${unsentFamilies.length} email${unsentFamilies.length > 1 ? 's' : ''}`,
    })
  }

  const handleSendOne = (family) => {
    const lastNames  = [...new Set(family.students.filter((s, i, a) => a.findIndex(x => x.student_id === s.student_id) === i).map(s => s.student_name.split(' ').slice(-1)[0]))]
    const firstNames = family.students.filter((s, i, a) => a.findIndex(x => x.student_id === s.student_id) === i).map(s => s.student_name.split(' ')[0])
    const fnStr = firstNames.length === 1 ? firstNames[0] : firstNames.slice(0, -1).join(', ') + ' & ' + firstNames.slice(-1)
    const label = lastNames.length === 1 ? `${fnStr} ${lastNames[0]}'s family` : `${fnStr}'s family`
    setConfirmSend({
      families: [family],
      isBulk: false,
      label,
      detail: family.parent_email,
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading && !terms.length) return (
    <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center">
      <span className="text-[#325099]/50 text-sm">Loading…</span>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />

      <div className="max-w-4xl mx-auto px-6 pt-10 pb-24">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link href="/tutor/emails" className="text-sm text-[#325099]/50 hover:text-[#325099] transition">← Emails</Link>
        </div>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">End-of-Term Reports</h1>
            <p className="text-sm text-[#325099]/60 mt-1">Upload student reports and send personalised emails to families.</p>
          </div>
          {/* Term selector */}
          <select
            value={termId}
            onChange={e => { setTermId(e.target.value); setStudents([]); setUploads({}) }}
            className="border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm text-[#062E63] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/25"
          >
            <option value="">Select term…</option>
            {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        {/* Stats bar */}
        {students.length > 0 && (
          <div className="flex gap-4 mb-6">
            {[
              { label: 'Students',  value: students.length },
              { label: 'Families',  value: familiesWithEmail.length },
              { label: 'PDFs ready', value: `${uploadedCount} / ${students.length}` },
            ].map(s => (
              <div key={s.label} className="bg-white border border-[#DEE7FF] rounded-xl px-4 py-3 flex-1 text-center">
                <div className="text-xl font-bold text-[#062E63]">{s.value}</div>
                <div className="text-xs text-[#325099]/60 font-semibold mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-5">{error}</div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white border border-[#DEE7FF] rounded-xl p-1 w-fit">
          {[{ id: 'preview', label: '① Preview & Send' }, { id: 'template', label: '② Email template' }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${tab === t.id ? 'bg-[#062E63] text-white' : 'text-[#325099]/60 hover:text-[#062E63]'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Email template ──────────────────────────────────────────────── */}
        {tab === 'template' && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-bold text-[#062E63]">Email body</h2>
              <button
                onClick={() => { setTemplate(DEFAULT_TEMPLATE); localStorage.setItem(TEMPLATE_KEY, DEFAULT_TEMPLATE) }}
                className="text-[11px] text-[#325099]/50 hover:text-[#325099] transition"
              >
                Reset to default
              </button>
            </div>
            <p className="text-xs text-[#325099]/60 mb-3">
              Available placeholders: <code className="bg-[#F0F4FF] px-1 rounded">{'{{parent_name}}'}</code> <code className="bg-[#F0F4FF] px-1 rounded">{'{{student_names}}'}</code> <code className="bg-[#F0F4FF] px-1 rounded">{'{{term_name}}'}</code> <code className="bg-[#F0F4FF] px-1 rounded">{'{{followup_date}}'}</code> <span className="text-[#325099]/40">(7 days from send)</span>
            </p>
            <textarea
              value={template}
              onChange={e => { setTemplate(e.target.value); localStorage.setItem(TEMPLATE_KEY, e.target.value) }}
              rows={14}
              className="w-full border border-[#DEE7FF] rounded-xl px-4 py-3 text-sm text-[#062E63] font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#325099]/25 resize-y"
            />
          </div>
        )}

        {/* ── Preview & Send ──────────────────────────────────────────────── */}
        {tab === 'preview' && (
          <div className="space-y-5">

            {/* Reports not yet sent — listed per STUDENT so none are missed,
                including students with no linked family / parent email. */}
            {students.length > 0 && (
              unsentStudents.length === 0 ? (
                <div className="bg-[#F0FDF4] border border-[#A7F3D0] rounded-2xl px-5 py-3 text-sm font-semibold text-[#166534]">
                  ✓ All {students.length} student report{students.length > 1 ? 's have' : ' has'} been sent.
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-[#FED7AA] overflow-hidden">
                  <div className="bg-[#FFF7ED] border-b border-[#FED7AA] px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-xs font-bold text-[#9A3412]">⚠ Reports not yet sent · {unsentStudents.length} student{unsentStudents.length > 1 ? 's' : ''}</span>
                    <span className="text-[11px] text-[#9A3412]/70">Per student — catches anyone with no family / parent email</span>
                  </div>
                  <div className="divide-y divide-[#FFEDD5] max-h-72 overflow-y-auto">
                    {unsentStudents.map(s => {
                      const pdfReady = uploads[`${s.student_id}_${s.class_id}`]?.exists
                      const reason = !s.parent_email
                        ? { t: 'No parent email', c: 'bg-[#FEE2E2] text-red-700' }
                        : !pdfReady
                          ? { t: 'PDF missing', c: 'bg-[#FEF3C7] text-[#92400E]' }
                          : { t: 'Not sent yet', c: 'bg-[#EEF3FF] text-[#325099]' }
                      return (
                        <div key={`${s.student_id}_${s.class_id}`} className="px-5 py-2.5 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <span className="font-medium text-sm text-[#062E63]">{s.student_name}</span>
                            <span className="text-xs text-[#325099]/50 ml-2">Y{s.year} · {s.class_name}{s.parent_email ? ` · ${s.parent_email}` : ''}</span>
                          </div>
                          <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 ${reason.c}`}>{reason.t}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            )}

            {/* Family preview cards */}
            <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
              <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-5 py-3">
                <span className="text-xs font-semibold text-[#325099]/60">
                  {familiesWithEmail.length} {familiesWithEmail.length === 1 ? 'family' : 'families'} · siblings grouped into one email
                </span>
              </div>
              {familiesWithEmail.length === 0 ? (
                <div className="text-center py-12 text-[#325099]/40 text-sm">No families with email addresses found.</div>
              ) : (
                <div className="divide-y divide-[#DEE7FF]">
                  {[...familiesWithEmail].sort((a, b) => {
                    const aSent = results.find(r => r.email === a.parent_email)?.success ? 1 : 0
                    const bSent = results.find(r => r.email === b.parent_email)?.success ? 1 : 0
                    return aSent - bSent
                  }).map((f, i) => {
                    const sentResult      = results.find(r => r.email === f.parent_email)
                    const included        = includedStudents(f)
                    const noneIncluded    = included.length === 0
                    const allPDFs         = !noneIncluded && included.every(s => uploads[`${s.student_id}_${s.class_id}`]?.exists)
                    const isSendingThis   = sendingFamily === f.parent_email
                    // Build family label — deduplicate by student_id first
                    const uniqueStudents  = f.students.filter((s, idx, arr) => arr.findIndex(x => x.student_id === s.student_id) === idx)
                    const lastNames       = [...new Set(uniqueStudents.map(s => s.student_name.split(' ').slice(-1)[0]))]
                    const firstNames      = uniqueStudents.map(s => s.student_name.split(' ')[0])
                    const firstNamesStr   = firstNames.length === 1
                      ? firstNames[0]
                      : firstNames.slice(0, -1).join(', ') + ' & ' + firstNames.slice(-1)
                    const familyLabel     = lastNames.length === 1
                      ? `${firstNamesStr} ${lastNames[0]}'s family`
                      : `${firstNamesStr}'s family`
                    return (
                      <div key={i} className={`px-5 py-4 flex items-start justify-between gap-4 transition ${sentResult?.success ? 'bg-[#F0FDF4]' : ''}`}>
                        <div className="min-w-0">
                          <div className={`font-semibold text-sm ${sentResult?.success ? 'text-[#166534]' : 'text-[#062E63]'}`}>{familyLabel}</div>
                          <div className="text-xs text-[#325099]/50 mt-0.5">{f.parent_email}</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {f.students.map(s => {
                              const pdfReady = uploads[`${s.student_id}_${s.class_id}`]?.exists
                              const excluded = isExcluded(s)
                              return (
                                <button
                                  key={`${s.student_id}_${s.class_id}`}
                                  onClick={() => toggleReport(s)}
                                  title={excluded ? 'Excluded — click to include this report in the email' : 'Included — click to leave this report out of the email'}
                                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full border transition ${
                                    excluded
                                      ? 'bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB] line-through'
                                      : pdfReady
                                        ? 'bg-[#D1FAE5] text-[#065F46] border-transparent hover:border-[#34D399]'
                                        : 'bg-[#FEE2E2] text-red-700 border-transparent hover:border-red-300'
                                  }`}
                                >
                                  {excluded ? '🚫' : pdfReady ? '✓' : '✗'} {s.student_name.split(' ')[0]} · {s.class_name}
                                </button>
                              )
                            })}
                          </div>
                          {noneIncluded && (
                            <p className="text-[11px] text-[#9A3412] mt-1.5">All reports excluded — this family won’t be emailed.</p>
                          )}
                        </div>
                        <div className="flex-shrink-0 flex flex-col items-end gap-2">
                          {sentResult ? (
                            sentResult.success ? (
                              <span className="text-xs font-semibold text-[#10b981] bg-[#D1FAE5] px-3 py-1 rounded-full">✓ Sent</span>
                            ) : (
                              <div className="text-right">
                                <span className="text-xs font-semibold text-red-600 bg-red-50 px-3 py-1 rounded-full">✗ Failed</span>
                                {sentResult.error && (
                                  <p className="text-[10px] text-red-500 mt-1 max-w-[180px] leading-tight">{sentResult.error}</p>
                                )}
                              </div>
                            )
                          ) : (
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                              noneIncluded
                                ? 'bg-[#F3F4F6] text-[#9CA3AF]'
                                : allPDFs
                                  ? 'bg-[#EEF3FF] text-[#325099]'
                                  : 'bg-[#FEE2E2] text-red-600'
                            }`}>
                              {noneIncluded ? 'No reports selected' : allPDFs ? `${included.length} PDF${included.length > 1 ? 's' : ''} ready` : 'PDFs missing'}
                            </span>
                          )}
                          <div className="flex gap-1.5">
                            {overrides[familyKey(f)] && (
                              <span title="This family has a personalised email" className="text-[11px] font-semibold text-[#6D28D9] border border-[#DDD6FE] bg-[#F5F3FF] px-2.5 py-1 rounded-full self-center">
                                ✦ Personalised
                              </span>
                            )}
                            <button
                              onClick={() => setPreviewFamily(f)}
                              className="text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-3 py-1 rounded-full transition"
                            >
                              👁 Preview
                            </button>
                            <button
                              onClick={() => openEditor(f)}
                              className="text-[11px] font-semibold text-[#6D28D9] border border-[#DDD6FE] bg-white hover:bg-[#F5F3FF] px-3 py-1 rounded-full transition"
                            >
                              ✎ Edit
                            </button>
                            <button
                              onClick={() => handleTestOne(f)}
                              disabled={testingFamily === f.parent_email || isSendingThis || sending || noneIncluded}
                              title="Send this exact email to CUBE staff only (marked TEST)"
                              className="text-[11px] font-semibold text-[#92400E] border border-[#FDE68A] bg-[#FFFBEB] hover:bg-[#FEF3C7] px-3 py-1 rounded-full transition disabled:opacity-40"
                            >
                              {testingFamily === f.parent_email ? 'Testing…' : '🧪 Test'}
                            </button>
                            <button
                              onClick={() => handleSendOne(f)}
                              disabled={isSendingThis || sending || noneIncluded}
                              className="text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-3 py-1 rounded-full transition disabled:opacity-40"
                            >
                              {isSendingThis ? 'Sending…' : sentResult?.success ? '↺ Resend' : '✉ Send'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Families missing email */}
            {families.filter(f => !f.parent_email).length > 0 && (
              <div className="bg-[#FEF9C3] border border-[#FDE047] text-[#854D0E] text-xs font-medium px-4 py-3 rounded-xl">
                ⚠ {families.filter(f => !f.parent_email).length} {families.filter(f => !f.parent_email).length === 1 ? 'family has' : 'families have'} no email address on file and will be skipped.
              </div>
            )}

            {/* Test send confirmation */}
            {testNote && (
              <div className="bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] text-xs font-semibold px-4 py-3 rounded-xl">
                🧪 {testNote}
              </div>
            )}

            {/* Results summary */}
            {results.length > 0 && (
              <div className="bg-[#D1FAE5] border border-[#34D399] rounded-xl px-5 py-4">
                <p className="text-sm font-semibold text-[#065F46]">
                  ✓ {results.filter(r => r.success).length} of {results.length} emails sent successfully
                </p>
                {results.filter(r => !r.success).length > 0 && (
                  <p className="text-xs text-red-600 mt-1">
                    {results.filter(r => !r.success).length} failed: {results.filter(r => !r.success).map(r => r.family).join(', ')}
                  </p>
                )}
              </div>
            )}

            {/* Bulk send button — always visible, only targets unsent families */}
            {(() => {
              const unsentFamilies = familiesWithEmail.filter(f => !results.find(r => r.email === f.parent_email && r.success))
              return (
                <div className="flex items-center justify-between">
                  {unsentFamilies.length < familiesWithEmail.length && familiesWithEmail.length > 0 ? (
                    <span className="text-xs text-[#325099]/50">{familiesWithEmail.length - unsentFamilies.length} already sent</span>
                  ) : <span />}
                  <button
                    onClick={handleSend}
                    disabled={sending || unsentFamilies.length === 0}
                    className="bg-[#062E63] text-white text-sm font-semibold px-8 py-3 rounded-full disabled:opacity-40 hover:bg-[#325099] transition"
                  >
                    {sending ? 'Sending…' : unsentFamilies.length === 0 ? '✓ All sent' : `✉ Send to ${unsentFamilies.length} unsent ${unsentFamilies.length === 1 ? 'family' : 'families'}`}
                  </button>
                </div>
              )
            })()}
          </div>
        )}

      </div>

      {/* ── Send confirmation modal ─────────────────────────────────────────── */}
      {confirmSend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#DEE7FF] w-full max-w-sm p-6">
            <div className="w-11 h-11 rounded-2xl bg-[#FEF9C3] flex items-center justify-center text-2xl mb-4">✉️</div>
            <h2 className="text-base font-bold text-[#062E63] mb-1">Confirm send</h2>
            <p className="text-sm text-[#325099]/70 mb-1">
              You're about to send to <span className="font-semibold text-[#062E63]">{confirmSend.label}</span>.
            </p>
            <p className="text-xs text-[#325099]/50 mb-6">{confirmSend.detail}</p>
            <p className="text-xs text-[#854D0E] bg-[#FEF9C3] border border-[#FDE047] rounded-lg px-3 py-2 mb-6">
              This will send real emails. This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmSend(null)}
                className="text-sm font-semibold text-[#325099] px-4 py-2 rounded-full border border-[#DEE7FF] hover:bg-[#F0F4FF] transition"
              >
                Cancel
              </button>
              <button
                onClick={() => executeSend(confirmSend)}
                className="text-sm font-semibold bg-[#062E63] text-white px-5 py-2 rounded-full hover:bg-[#325099] transition"
              >
                Yes, send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Email preview modal ─────────────────────────────────────────────── */}
      {previewFamily && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
          onClick={e => e.target === e.currentTarget && setPreviewFamily(null)}
        >
          <div className="bg-white rounded-2xl shadow-2xl border border-[#DEE7FF] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#DEE7FF] bg-[#F8FAFF] shrink-0">
              <div>
                <p className="text-xs font-bold text-[#325099] tracking-wider uppercase">Email Preview</p>
                <p className="text-sm font-semibold text-[#062E63] mt-0.5">To: {previewFamily.parent_email}</p>
              </div>
              <button
                onClick={() => setPreviewFamily(null)}
                className="text-[#325099]/50 hover:text-[#062E63] text-xl leading-none transition"
              >
                ✕
              </button>
            </div>
            {/* Rendered email */}
            <div className="flex-1 overflow-auto">
              <iframe
                srcDoc={buildEmailHtml(overrides[familyKey(previewFamily)] || template, { ...previewFamily, students: includedStudents(previewFamily) }, term?.name || '')}
                className="w-full border-0"
                style={{ minHeight: '500px' }}
                title="Email preview"
              />
            </div>
            {/* Footer */}
            <div className="px-5 py-3 border-t border-[#DEE7FF] bg-[#F8FAFF] flex justify-end gap-2 shrink-0">
              <button
                onClick={() => setPreviewFamily(null)}
                className="text-sm font-semibold text-[#325099] px-4 py-2 rounded-full border border-[#DEE7FF] hover:bg-[#F0F4FF] transition"
              >
                Close
              </button>
              <button
                onClick={() => { setPreviewFamily(null); handleSendOne(previewFamily) }}
                disabled={sendingFamily === previewFamily.parent_email || sending}
                className="text-sm font-semibold bg-[#062E63] text-white px-5 py-2 rounded-full hover:bg-[#325099] transition disabled:opacity-40"
              >
                ✉ Send this email
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Per-family email editor ── */}
      {editFamily && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && !savingOverride && setEditFamily(null)}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-[#EEF1F9]">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-[#062E63]">Personalise email</h2>
                <p className="text-sm font-semibold text-[#2A2035] mt-0.5 truncate">
                  {editFamily.parent_name || editFamily.parent_email}
                  <span className="text-[#2A2035]/50 font-normal"> · {editFamily.students.map(s => s.student_name.split(' ')[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</span>
                </p>
                <p className="text-[11px] text-[#2A2035]/50 mt-1">Edits the full body for this family only. The CUBE header, subject and attached reports are unchanged.</p>
              </div>
              <button onClick={() => !savingOverride && setEditFamily(null)} className="text-[#325099]/50 hover:text-[#325099] text-xl leading-none shrink-0">✕</button>
            </div>
            <div className="px-6 py-4 overflow-y-auto">
              <textarea
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                rows={16}
                className="w-full border border-[#DEE7FF] rounded-xl px-4 py-3 text-sm leading-relaxed text-[#2A2035] focus:outline-none focus:border-[#325099] resize-y font-mono"
              />
            </div>
            <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-[#EEF1F9]">
              <button
                onClick={resetEditor}
                disabled={savingOverride || !overrides[familyKey(editFamily)]}
                title={overrides[familyKey(editFamily)] ? 'Discard this family’s personalisation and use the standard template' : 'No personalisation saved yet'}
                className="text-xs font-semibold text-red-500 border border-[#FCA5A5] bg-white hover:bg-[#FEF2F2] px-3 py-1.5 rounded-full transition disabled:opacity-40"
              >
                ↺ Reset to template
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditBody(resolvedBody(template, { ...editFamily, students: includedStudents(editFamily) }, term?.name || ''))}
                  disabled={savingOverride}
                  className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-3 py-1.5 rounded-full transition disabled:opacity-40"
                >
                  Reload template text
                </button>
                <button onClick={() => setEditFamily(null)} disabled={savingOverride} className="text-xs font-semibold text-[#325099] px-3 py-1.5 disabled:opacity-40">Cancel</button>
                <button
                  onClick={saveEditor}
                  disabled={savingOverride || !editBody.trim()}
                  className="text-sm font-semibold bg-[#062E63] text-white px-5 py-2 rounded-full hover:bg-[#325099] transition disabled:opacity-40"
                >
                  {savingOverride ? 'Saving…' : 'Save personalisation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
