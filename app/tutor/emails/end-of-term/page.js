'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { fetchAllTerms, getCurrentTerm } from '../../../../lib/terms'
import { T_CLASSES, T_ENROLMENTS, T_STUDENTS, T_PARENTS } from '../../../../lib/tables'

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
function storageKey(termId, studentId, classId) {
  return `${termId}/${studentId}_${classId}.pdf`
}

function formatNames(names) {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return names.slice(0, -1).join(', ') + ' and ' + names.slice(-1)
}

function fillTemplate(template, vars) {
  return template
    .replace(/\{\{parent_name\}\}/g,   vars.parentName   || 'there')
    .replace(/\{\{term_name\}\}/g,     vars.termName     || '')
    .replace(/\{\{student_names\}\}/g, vars.studentNames || '')
    .replace(/\{\{possessive\}\}/g,    vars.possessive   || 'their')
    .replace(/\{\{they_have\}\}/g,     vars.theyHave     || 'they have')
    .replace(/\{\{plural\}\}/g,        vars.plural       || '')
}

function buildEmailHtml(template, family, termName) {
  const firstNames   = family.students.map(s => s.student_name.split(' ')[0])
  const count        = firstNames.length
  const studentNames = formatNames(firstNames)
  const bodyText = fillTemplate(template, {
    parentName:   family.parent_name || 'there',
    termName,
    studentNames,
    possessive:   'their',
    theyHave:     'they have',
    plural:       count > 1 ? 's' : '',
  })
  const escaped = bodyText
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const paragraphs = escaped
    .split(/\n\n+/)
    .map(p => `<p style="margin:0 0 16px 0;line-height:1.7;">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('')
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:#2A2035;background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">
      <div style="background:#062E63;border-radius:12px;padding:18px 24px;margin-bottom:32px;">
        <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">CUBE</span>
        <span style="color:rgba(255,255,255,0.55);font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
      </div>
      <div style="font-size:15px;">${paragraphs}</div>
      <div style="margin-top:32px;padding-top:16px;border-top:1px solid #DEE7FF;font-size:11px;color:#325099;opacity:0.6;">
        CUBE Tuition · This email was sent from the CUBE staff portal.
      </div>
    </div>
  </body></html>`
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
  const [tab,      setTab]      = useState('upload')  // 'upload' | 'send'
  const resultsKey = termId ? `cube_eot_results_${termId}` : null
  const [results,  setResults]  = useState(() => {
    if (typeof window !== 'undefined' && termId) {
      try { return JSON.parse(localStorage.getItem(`cube_eot_results_${termId}`)) || [] } catch { return [] }
    }
    return []
  })
  const [sending,      setSending]      = useState(false)
  const [refreshing,   setRefreshing]   = useState(false)
  const [error,        setError]        = useState(null)
  const [previewFamily, setPreviewFamily] = useState(null) // family object to preview, or null

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

  const refreshUploads = useCallback(async (rowsOverride, tIdOverride) => {
    await checkStorageUploads(rowsOverride || students, tIdOverride || termId)
  }, [termId, students])

  // ── Load students ─────────────────────────────────────────────────────────
  const loadStudents = useCallback(async () => {
    if (!termId) return
    setLoading(true)
    setError(null)
    try {
      // Classes for this term (with fallback)
      let { data: cls } = await supabase.from(T_CLASSES).select('id, class_name').eq('term_id', termId)
      if (!cls?.length) {
        const all = await supabase.from(T_CLASSES).select('id, class_name')
        cls = all.data || []
      }
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

  // ── Persist + restore results per term ────────────────────────────────────
  useEffect(() => {
    if (!termId) return
    try {
      const saved = localStorage.getItem(`cube_eot_results_${termId}`)
      setResults(saved ? JSON.parse(saved) : [])
    } catch { setResults([]) }
  }, [termId])

  useEffect(() => {
    if (!resultsKey) return
    try { localStorage.setItem(resultsKey, JSON.stringify(results)) } catch {}
  }, [results, resultsKey])

  // ── Upload PDF for a student ───────────────────────────────────────────────
  const uploadPDF = async (studentId, classId, file) => {
    const key = `${studentId}_${classId}`
    setUploads(prev => ({ ...prev, [key]: { ...prev[key], uploading: true } }))
    const path = storageKey(termId, studentId, classId)
    const { error: upErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, file, { upsert: true, contentType: 'application/pdf' })
    setUploads(prev => ({ ...prev, [key]: { exists: !upErr, uploading: false } }))
    if (upErr) setError(`Upload failed: ${upErr.message}`)
  }

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

  // ── Derived counts ─────────────────────────────────────────────────────────
  const term = terms.find(t => t.id === termId)
  const uploadedCount = students.filter(s => uploads[`${s.student_id}_${s.class_id}`]?.exists).length
  const allUploaded   = students.length > 0 && uploadedCount === students.length
  const familiesWithEmail = families.filter(f => f.parent_email)

  // ── Send emails ───────────────────────────────────────────────────────────
  const [sendingFamily, setSendingFamily] = useState(null) // email address of family being individually sent
  const [confirmSend,  setConfirmSend]  = useState(null)  // { families, label } | null — pending confirmation

  const sendToFamilies = async (familiesToSend) => {
    try {
      const res = await fetch('/api/send-end-of-term-emails', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          term_id:   termId,
          term_name: term?.name || '',
          template,
          families:  familiesToSend,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      return data.results || []
    } catch (e) {
      throw e
    }
  }

  const executeSend = async ({ families: fams, isBulk }) => {
    setConfirmSend(null)
    if (isBulk) {
      setSending(true)
      setError(null)
      setResults([])
      try {
        const newResults = await sendToFamilies(fams)
        setResults(newResults)
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
    setConfirmSend({
      families: familiesWithEmail,
      isBulk: true,
      label: `Send to all ${familiesWithEmail.length} ${familiesWithEmail.length === 1 ? 'family' : 'families'}`,
      detail: `${term?.name || 'this term'} · ${familiesWithEmail.length} email${familiesWithEmail.length > 1 ? 's' : ''}`,
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

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white border border-[#DEE7FF] rounded-xl p-1 w-fit">
          {[
            { id: 'upload', label: '① Upload Reports' },
            { id: 'preview', label: '② Preview & Send' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${
                tab === t.id
                  ? 'bg-[#062E63] text-white'
                  : 'text-[#325099]/60 hover:text-[#062E63]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-5">{error}</div>
        )}

        {/* ── TAB: Upload Reports ──────────────────────────────────────────── */}
        {tab === 'upload' && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
            {loading ? (
              <div className="text-center py-16 text-[#325099]/40 text-sm">Loading students…</div>
            ) : !termId ? (
              <div className="text-center py-16 text-[#325099]/40 text-sm">Select a term to get started.</div>
            ) : students.length === 0 ? (
              <div className="text-center py-16 text-[#325099]/40 text-sm">No active enrolments found for this term.</div>
            ) : (
              <>
                <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-5 py-3 flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#325099]/60">
                    Upload one PDF per student · Stored in Supabase Storage
                  </span>
                  <div className="flex items-center gap-3">
                    {allUploaded && (
                      <span className="text-xs font-bold text-[#10b981]">✓ All PDFs uploaded</span>
                    )}
                    <button
                      onClick={async () => {
                        setRefreshing(true)
                        await checkStorageUploads(students, termId)
                        setRefreshing(false)
                      }}
                      disabled={refreshing}
                      className="text-xs font-semibold text-[#325099] hover:text-[#062E63] transition disabled:opacity-40"
                    >
                      {refreshing ? 'Checking…' : '↻ Refresh'}
                    </button>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
                      <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-[#325099]/60">Student</th>
                      <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-[#325099]/60">Yr</th>
                      <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-[#325099]/60">Class</th>
                      <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-[#325099]/60">Parent</th>
                      <th className="text-center px-5 py-2.5 text-[11px] font-semibold text-[#325099]/60">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s, i) => {
                      const key      = `${s.student_id}_${s.class_id}`
                      const upStatus = uploads[key] || { exists: false, uploading: false }
                      return (
                        <tr
                          key={key}
                          className={`border-b border-[#DEE7FF] last:border-0 ${
                            upStatus.exists ? 'bg-[#F0FDF4]' : i % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFF]'
                          }`}
                        >
                          <td className="px-5 py-2.5 font-medium text-[#062E63]">{s.student_name}</td>
                          <td className="px-5 py-2.5 text-xs text-[#325099]/60">Y{s.year}</td>
                          <td className="px-5 py-2.5 text-xs text-[#325099]/80">{s.class_name}</td>
                          <td className="px-5 py-2.5 text-xs text-[#325099]/60">{s.parent_name || '—'}</td>
                          <td className="px-5 py-2.5 text-center">
                            {upStatus.uploading ? (
                              <span className="text-xs text-[#325099]/50">Uploading…</span>
                            ) : upStatus.exists ? (
                              <label className="inline-flex items-center gap-1.5 cursor-pointer group">
                                <span className="text-xs font-semibold text-[#10b981]">✓ Uploaded</span>
                                <span className="text-[10px] text-[#325099]/40 group-hover:text-[#325099] transition">Replace</span>
                                <input
                                  type="file" accept="application/pdf" className="hidden"
                                  onChange={e => e.target.files?.[0] && uploadPDF(s.student_id, s.class_id, e.target.files[0])}
                                />
                              </label>
                            ) : (
                              <label className="inline-flex items-center gap-1 bg-[#EEF3FF] hover:bg-[#DEE7FF] text-[#325099] text-xs font-semibold px-3 py-1 rounded-full cursor-pointer transition">
                                ↑ Upload PDF
                                <input
                                  type="file" accept="application/pdf" className="hidden"
                                  onChange={e => e.target.files?.[0] && uploadPDF(s.student_id, s.class_id, e.target.files[0])}
                                />
                              </label>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {/* ── TAB: Preview & Send ──────────────────────────────────────────── */}
        {tab === 'preview' && (
          <div className="space-y-5">

            {/* Email template editor */}
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
                Available placeholders: <code className="bg-[#F0F4FF] px-1 rounded">{'{{parent_name}}'}</code> <code className="bg-[#F0F4FF] px-1 rounded">{'{{student_names}}'}</code> <code className="bg-[#F0F4FF] px-1 rounded">{'{{term_name}}'}</code>
              </p>
              <textarea
                value={template}
                onChange={e => { setTemplate(e.target.value); localStorage.setItem(TEMPLATE_KEY, e.target.value) }}
                rows={12}
                className="w-full border border-[#DEE7FF] rounded-xl px-4 py-3 text-sm text-[#062E63] font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#325099]/25 resize-y"
              />
            </div>

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
                    const allPDFs         = f.students.every(s => uploads[`${s.student_id}_${s.class_id}`]?.exists)
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
                              return (
                                <span
                                  key={`${s.student_id}_${s.class_id}`}
                                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                                    pdfReady
                                      ? 'bg-[#D1FAE5] text-[#065F46]'
                                      : 'bg-[#FEE2E2] text-red-700'
                                  }`}
                                >
                                  {pdfReady ? '✓' : '✗'} {s.student_name.split(' ')[0]} · {s.class_name}
                                </span>
                              )
                            })}
                          </div>
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
                              allPDFs
                                ? 'bg-[#EEF3FF] text-[#325099]'
                                : 'bg-[#FEE2E2] text-red-600'
                            }`}>
                              {allPDFs ? `${f.students.length} PDF${f.students.length > 1 ? 's' : ''} ready` : 'PDFs missing'}
                            </span>
                          )}
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setPreviewFamily(f)}
                              className="text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-3 py-1 rounded-full transition"
                            >
                              👁 Preview
                            </button>
                            <button
                              onClick={() => handleSendOne(f)}
                              disabled={isSendingThis || sending}
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

            {/* Send button */}
            {results.length === 0 ? (
              <div className="flex justify-end">
                <button
                  onClick={handleSend}
                  disabled={sending || familiesWithEmail.length === 0}
                  className="bg-[#062E63] text-white text-sm font-semibold px-8 py-3 rounded-full disabled:opacity-40 hover:bg-[#325099] transition"
                >
                  {sending ? 'Sending…' : `✉ Send to ${familiesWithEmail.length} ${familiesWithEmail.length === 1 ? 'family' : 'families'}`}
                </button>
              </div>
            ) : (
              <div className="bg-[#D1FAE5] border border-[#34D399] rounded-xl px-5 py-4">
                <p className="text-sm font-semibold text-[#065F46] mb-1">
                  ✓ {results.filter(r => r.success).length} of {results.length} emails sent successfully
                </p>
                {results.filter(r => !r.success).length > 0 && (
                  <p className="text-xs text-red-600">
                    {results.filter(r => !r.success).length} failed: {results.filter(r => !r.success).map(r => r.family).join(', ')}
                  </p>
                )}
                <button
                  onClick={() => { setResults([]); if (resultsKey) localStorage.removeItem(resultsKey) }}
                  className="mt-2 text-xs font-semibold text-[#065F46] hover:text-[#062E63] transition"
                >
                  Send again
                </button>
              </div>
            )}
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
                srcDoc={buildEmailHtml(template, previewFamily, term?.name || '')}
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

    </div>
  )
}
