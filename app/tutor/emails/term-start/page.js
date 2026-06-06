'use client'
import { useEffect, useState, useCallback, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { fetchAllTerms } from '../../../../lib/terms'
import { T_CLASSES, T_ENROLMENTS, T_STUDENTS, T_PARENTS } from '../../../../lib/tables'

/*
 * Term Start Emails — /tutor/emails/term-start
 *
 * Sends re-enrolment confirmation emails to families at the start of a new term.
 * Loads active enrolments for the selected term, groups by family, and sends
 * personalised emails with class details and term dates via Resend.
 */

const TEMPLATE_KEY = 'cube_term_start_template'

const DEFAULT_TEMPLATE = `Hi {{parent_name}},

We're looking forward to seeing you again for **{{term_name}}** at CUBE Tuition!

This is a confirmation that the following enrolments have been carried over:

{{class_details}}

Term dates: {{term_dates}}

Please find your invoice attached to this email. If you have any questions about your invoice or enrolments, don't hesitate to reach out.

Kind regards,
The CUBE Team`

// ── Helpers ───────────────────────────────────────────────────────────────────
function followupDate() {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function buildTermDates(term) {
  if (!term) return ''
  const weeks = term.start_date && term.end_date
    ? Math.round((new Date(term.end_date) - new Date(term.start_date)) / (7 * 86400000)) + 1
    : null
  return `${fmtDate(term.start_date)} to ${fmtDate(term.end_date)}${weeks ? ` (${weeks} weeks)` : ''}`
}

function buildClassDetails(students) {
  const unique = students.filter((s, i, a) =>
    a.findIndex(x => x.student_name === s.student_name && x.class_name === s.class_name) === i
  )
  return unique.map(s => {
    const time = s.class_day ? ` (${s.class_day}${s.class_start ? ', ' + s.class_start : ''})` : ''
    return `  • ${s.student_name} — ${s.class_name}${time}`
  }).join('\n')
}

function fillTemplatePreview(template, family, termName, termDates) {
  const unique       = family.students.filter((s, i, a) => a.findIndex(x => x.student_name === s.student_name && x.class_name === s.class_name) === i)
  const firstNames   = unique.map(s => s.student_name.split(' ')[0])
  const count        = firstNames.length
  const studentNames = count === 1 ? firstNames[0] : firstNames.slice(0, -1).join(', ') + ' and ' + firstNames.slice(-1)
  const classDetails = buildClassDetails(family.students)

  return template
    .replace(/\{\{parent_name\}\}/g,    family.parent_name || 'there')
    .replace(/\{\{term_name\}\}/g,      termName)
    .replace(/\{\{term_dates\}\}/g,     termDates)
    .replace(/\{\{student_names\}\}/g,  studentNames)
    .replace(/\{\{class_details\}\}/g,  classDetails)
    .replace(/\{\{followup_date\}\}/g,  followupDate())
    .replace(/\[date\]/gi,              followupDate())
    .replace(/\{\{possessive\}\}/g,     'their')
    .replace(/\{\{they_have\}\}/g,      'they have')
    .replace(/\{\{plural\}\}/g,         count > 1 ? 's' : '')
}

function buildPreviewHtml(template, family, termName, termDates) {
  const body    = fillTemplatePreview(template, family, termName, termDates)
  const escaped = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const paras   = escaped.split(/\n\n+/)
    .map(p => `<p style="margin:0 0 16px 0;line-height:1.7;">${
      p.replace(/\n/g, '<br/>')
       .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    }</p>`).join('')
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4ff;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:32px auto;padding:32px 24px;color:#2A2035;background:#ffffff;border-radius:12px;box-shadow:0 2px 16px rgba(6,46,99,0.08);">
      <div style="background:#062E63;border-radius:12px;padding:18px 24px;margin-bottom:32px;">
        <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">CUBE</span>
        <span style="color:rgba(255,255,255,0.55);font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-left:10px;vertical-align:middle;">Tuition</span>
      </div>
      <div style="font-size:15px;">${paras}</div>
      <div style="margin-top:32px;padding-top:16px;border-top:1px solid #DEE7FF;font-size:11px;color:#325099;opacity:0.6;">
        CUBE Tuition · This email was sent from the CUBE staff portal.
      </div>
    </div>
  </body></html>`
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TermStartEmailPage() {
  return (
    <Suspense>
      <TermStartEmailPageInner />
    </Suspense>
  )
}

function TermStartEmailPageInner() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [profile,  setProfile]  = useState(null)
  const [terms,    setTerms]    = useState([])
  const [termId,   setTermId]   = useState(searchParams.get('termId') || '')
  const [loading,  setLoading]  = useState(false)
  const [students, setStudents] = useState([])
  const [template, setTemplate] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem(TEMPLATE_KEY) || DEFAULT_TEMPLATE
    return DEFAULT_TEMPLATE
  })
  const [tab,          setTab]          = useState('preview')
  const [sending,      setSending]      = useState(false)
  const [sendingFamily, setSendingFamily] = useState(null)
  const [confirmSend,  setConfirmSend]  = useState(null)
  const [previewFamily, setPreviewFamily] = useState(null)
  const [error,        setError]        = useState(null)

  const resultsKey = termId ? `cube_ts_results_${termId}` : null
  const [results, setResults] = useState([])

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) router.replace('/tutor')
      else setProfile(profile)
    })
    fetchAllTerms().then(setTerms)
  }, [router])

  // ── Persist + restore results per term ────────────────────────────────────
  useEffect(() => {
    if (!termId) return
    try { setResults(JSON.parse(localStorage.getItem(`cube_ts_results_${termId}`)) || []) } catch { setResults([]) }
  }, [termId])

  useEffect(() => {
    if (!resultsKey) return
    try { localStorage.setItem(resultsKey, JSON.stringify(results)) } catch {}
  }, [results, resultsKey])

  // ── Load enrolments ───────────────────────────────────────────────────────
  const loadStudents = useCallback(async () => {
    if (!termId) return
    setLoading(true); setError(null)
    try {
      // Get classes for this term
      const { data: cls } = await supabase
        .from(T_CLASSES).select('id, class_name, day_of_week, start_time, end_time').eq('term_id', termId)
      const classMap = Object.fromEntries((cls || []).map(c => [c.id, c]))
      const classIds = (cls || []).map(c => c.id)
      if (!classIds.length) { setStudents([]); setLoading(false); return }

      // Active enrolments
      const { data: enr, error: enrErr } = await supabase
        .from(T_ENROLMENTS).select('id, student_id, class_id, status')
        .in('class_id', classIds).in('status', ['active', 'trial'])
      if (enrErr) throw new Error(enrErr.message)
      if (!enr?.length) { setStudents([]); setLoading(false); return }

      // Students
      const studentIds = [...new Set(enr.map(e => e.student_id))]
      const { data: studs } = await supabase
        .from(T_STUDENTS).select('id, full_name, year, family_id').in('id', studentIds)
      const studMap = Object.fromEntries((studs || []).map(s => [s.id, s]))

      // Guardians
      let parentMap = {}
      if (studentIds.length) {
        const { data: parents } = await supabase
          .from(T_PARENTS).select('student_id, full_name, email').in('student_id', studentIds)
        parentMap = Object.fromEntries((parents || []).map(p => [p.student_id, p]))
      }

      const rows = enr.map(e => {
        const s = studMap[e.student_id] || {}
        const c = classMap[e.class_id]  || {}
        const p = parentMap[e.student_id] || {}
        return {
          student_id:   e.student_id,
          class_id:     e.class_id,
          student_name: s.full_name || '—',
          year:         s.year,
          family_id:    s.family_id || null,
          class_name:   c.class_name || '—',
          class_day:    c.day_of_week || '',
          class_start:  c.start_time?.slice(0, 5) || '',
          parent_name:  p.full_name || '',
          parent_email: p.email || '',
        }
      }).sort((a, b) => (a.class_name + a.student_name).localeCompare(b.class_name + b.student_name))

      setStudents(rows)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [termId])

  useEffect(() => { loadStudents() }, [loadStudents])

  // ── Family grouping ───────────────────────────────────────────────────────
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
        map[key].students.push(s)
      }
    }
    return Object.values(map)
  }, [students])

  const term             = terms.find(t => t.id === termId)
  const termDates        = buildTermDates(term)
  const familiesWithEmail = families.filter(f => f.parent_email)

  // ── Family label ──────────────────────────────────────────────────────────
  function familyLabel(f) {
    const unique     = f.students.filter((s, i, a) => a.findIndex(x => x.student_id === s.student_id) === i)
    const lastNames  = [...new Set(unique.map(s => s.student_name.split(' ').slice(-1)[0]))]
    const firstNames = unique.map(s => s.student_name.split(' ')[0])
    const fnStr      = firstNames.length === 1 ? firstNames[0] : firstNames.slice(0, -1).join(', ') + ' & ' + firstNames.slice(-1)
    return lastNames.length === 1 ? `${fnStr} ${lastNames[0]}'s family` : `${fnStr}'s family`
  }

  // ── Send helpers ──────────────────────────────────────────────────────────
  const sendToFamilies = async (fams) => {
    const res = await fetch('/api/send-term-start-emails', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        term_id:    termId,
        term_name:  term?.name || '',
        term_dates: termDates,
        template,
        families: fams.map(f => ({
          ...f,
          family_id:   f.family_id   || null,
          student_ids: f.students.map(s => s.student_id).filter(Boolean),
        })),
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Send failed')
    return data.results || []
  }

  const executeSend = async ({ families: fams, isBulk }) => {
    setConfirmSend(null)
    if (isBulk) {
      setSending(true); setError(null)
      try {
        const newResults = await sendToFamilies(fams)
        setResults(newResults)
      } catch (e) { setError(e.message) } finally { setSending(false) }
    } else {
      const family = fams[0]
      setSendingFamily(family.parent_email); setError(null)
      try {
        const newResults = await sendToFamilies([family])
        setResults(prev => [...prev.filter(r => r.email !== family.parent_email), ...newResults])
      } catch (e) { setError(e.message) } finally { setSendingFamily(null) }
    }
  }

  const handleSend = () => {
    const unsent = familiesWithEmail.filter(f => !results.find(r => r.email === f.parent_email && r.success))
    if (!unsent.length) return
    setConfirmSend({ families: unsent, isBulk: true, label: `Send to ${unsent.length} unsent ${unsent.length === 1 ? 'family' : 'families'}`, detail: `${term?.name || 'this term'} · ${unsent.length} email${unsent.length > 1 ? 's' : ''}` })
  }

  const handleSendOne = (family) => {
    setConfirmSend({ families: [family], isBulk: false, label: familyLabel(family), detail: family.parent_email })
  }

  // ── Render ────────────────────────────────────────────────────────────────
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
            <h1 className="text-2xl font-bold text-[#062E63]">Term Start</h1>
            <p className="text-sm text-[#325099]/60 mt-1">Send re-enrolment confirmation emails to families at the start of a new term.</p>
          </div>
          {term ? (
            <div className="flex items-center gap-2 border border-[#DEE7FF] rounded-xl px-4 py-2 bg-white">
              <span className="text-sm font-semibold text-[#062E63]">{term.name}</span>
              <Link href="/tutor/transition" className="text-[11px] text-[#325099]/50 hover:text-[#325099] transition">← Change</Link>
            </div>
          ) : (
            <Link href="/tutor/transition" className="text-sm font-semibold text-[#325099] border border-[#DEE7FF] px-4 py-2 rounded-xl hover:bg-[#F0F4FF] transition">
              Run transition first →
            </Link>
          )}
        </div>
        {!termId && (
          <div className="bg-[#FEF9C3] border border-[#FDE047] text-[#854D0E] text-sm font-medium px-4 py-3 rounded-xl mb-6">
            ⚠ No term selected. Complete the <Link href="/tutor/transition" className="underline">term transition</Link> first, then use the "Send Term Start emails" button on the Done step.
          </div>
        )}

        {/* Stats */}
        {students.length > 0 && (
          <div className="flex gap-4 mb-6">
            {[
              { label: 'Students',  value: students.length },
              { label: 'Families',  value: familiesWithEmail.length },
              { label: 'Term dates', value: termDates || '—' },
            ].map(s => (
              <div key={s.label} className="bg-white border border-[#DEE7FF] rounded-xl px-4 py-3 flex-1 text-center">
                <div className="text-sm font-bold text-[#062E63] leading-tight">{s.value}</div>
                <div className="text-xs text-[#325099]/60 font-semibold mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white border border-[#DEE7FF] rounded-xl p-1 w-fit">
          {[
            { id: 'preview', label: '① Email template' },
            { id: 'send',    label: '② Preview & Send'  },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${tab === t.id ? 'bg-[#062E63] text-white' : 'text-[#325099]/60 hover:text-[#062E63]'}`}
            >{t.label}</button>
          ))}
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-5">{error}</div>}

        {/* ── TAB: Email template ──────────────────────────────────────────── */}
        {tab === 'preview' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-[#DEE7FF] p-6">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-sm font-bold text-[#062E63]">Email body</h2>
                <button
                  onClick={() => { setTemplate(DEFAULT_TEMPLATE); localStorage.setItem(TEMPLATE_KEY, DEFAULT_TEMPLATE) }}
                  className="text-[11px] text-[#325099]/50 hover:text-[#325099] transition"
                >Reset to default</button>
              </div>
              <p className="text-xs text-[#325099]/60 mb-3">
                Placeholders: <code className="bg-[#F0F4FF] px-1 rounded">{'{{parent_name}}'}</code>{' '}
                <code className="bg-[#F0F4FF] px-1 rounded">{'{{student_names}}'}</code>{' '}
                <code className="bg-[#F0F4FF] px-1 rounded">{'{{class_details}}'}</code>{' '}
                <code className="bg-[#F0F4FF] px-1 rounded">{'{{term_name}}'}</code>{' '}
                <code className="bg-[#F0F4FF] px-1 rounded">{'{{term_dates}}'}</code>{' '}
                <code className="bg-[#F0F4FF] px-1 rounded">{'{{followup_date}}'}</code>{' '}
                <span className="text-[#325099]/40">· Use **bold** for bold text</span>
              </p>
              <textarea
                value={template}
                onChange={e => { setTemplate(e.target.value); localStorage.setItem(TEMPLATE_KEY, e.target.value) }}
                rows={14}
                className="w-full border border-[#DEE7FF] rounded-xl px-4 py-3 text-sm text-[#062E63] font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#325099]/25 resize-y"
              />
            </div>
          </div>
        )}

        {/* ── TAB: Preview & Send ──────────────────────────────────────────── */}
        {tab === 'send' && (
          <div className="space-y-4">
            {/* Family list */}
            <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
              {termId && students.length > 0 && (
                <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-5 py-3">
                  <span className="text-xs font-semibold text-[#325099]/60">
                    {familiesWithEmail.length} {familiesWithEmail.length === 1 ? 'family' : 'families'} · siblings grouped into one email
                  </span>
                </div>
              )}

              {loading ? (
                <div className="text-center py-12 text-[#325099]/40 text-sm">Loading…</div>
              ) : !termId ? (
                <div className="text-center py-12 text-[#325099]/40 text-sm">Select a term to get started.</div>
              ) : familiesWithEmail.length === 0 ? (
                <div className="text-center py-12 text-[#325099]/40 text-sm">No families with email addresses found for this term.</div>
              ) : (
                <div className="divide-y divide-[#DEE7FF]">
                  {[...familiesWithEmail].sort((a, b) => {
                    const aS = results.find(r => r.email === a.parent_email)?.success ? 1 : 0
                    const bS = results.find(r => r.email === b.parent_email)?.success ? 1 : 0
                    return aS - bS
                  }).map((f, i) => {
                    const sentResult    = results.find(r => r.email === f.parent_email)
                    const isSendingThis = sendingFamily === f.parent_email
                    const label         = familyLabel(f)
                    return (
                      <div key={i} className={`px-5 py-4 flex items-start justify-between gap-4 transition ${sentResult?.success ? 'bg-[#F0FDF4]' : ''}`}>
                        <div className="min-w-0">
                          <div className={`font-semibold text-sm ${sentResult?.success ? 'text-[#166534]' : 'text-[#062E63]'}`}>{label}</div>
                          <div className="text-xs text-[#325099]/50 mt-0.5">{f.parent_email}</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {f.students.filter((s, idx, arr) => arr.findIndex(x => x.student_id === s.student_id && x.class_id === s.class_id) === idx).map(s => (
                              <span key={`${s.student_id}_${s.class_id}`} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#EEF3FF] text-[#325099]">
                                {s.student_name.split(' ')[0]} · {s.class_name}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex-shrink-0 flex flex-col items-end gap-2">
                          {sentResult ? (
                            sentResult.success ? (
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-xs font-semibold text-[#10b981] bg-[#D1FAE5] px-3 py-1 rounded-full">✓ Sent</span>
                                {sentResult.invoiceAttached
                                  ? <span className="text-[10px] font-semibold text-[#325099] bg-[#EEF3FF] px-2 py-0.5 rounded-full">📎 {sentResult.invoiceNumber}</span>
                                  : <span className="text-[10px] text-[#92400E] bg-[#FEF3C7] px-2 py-0.5 rounded-full">⚠ no invoice attached</span>
                                }
                              </div>
                            ) : (
                              <div className="text-right">
                                <span className="text-xs font-semibold text-red-600 bg-red-50 px-3 py-1 rounded-full">✗ Failed</span>
                                {sentResult.error && <p className="text-[10px] text-red-500 mt-1 max-w-[180px] leading-tight">{sentResult.error}</p>}
                              </div>
                            )
                          ) : null}
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setPreviewFamily(f)}
                              className="text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-3 py-1 rounded-full transition"
                            >👁 Preview</button>
                            <button
                              onClick={() => handleSendOne(f)}
                              disabled={isSendingThis || sending}
                              className="text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-3 py-1 rounded-full transition disabled:opacity-40"
                            >{isSendingThis ? 'Sending…' : sentResult?.success ? '↺ Resend' : '✉ Send'}</button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Families without email */}
            {families.filter(f => !f.parent_email).length > 0 && (
              <div className="bg-[#FEF9C3] border border-[#FDE047] text-[#854D0E] text-xs font-medium px-4 py-3 rounded-xl">
                ⚠ {families.filter(f => !f.parent_email).length} {families.filter(f => !f.parent_email).length === 1 ? 'family has' : 'families have'} no email on file and will be skipped.
              </div>
            )}

            {/* Results summary */}
            {results.length > 0 && (
              <div className="bg-[#D1FAE5] border border-[#34D399] rounded-xl px-5 py-4">
                <p className="text-sm font-semibold text-[#065F46]">
                  ✓ {results.filter(r => r.success).length} of {results.length} emails sent
                  {results.filter(r => r.invoiceAttached).length > 0 && (
                    <span className="ml-2 font-normal text-[#065F46]/80">
                      · 📎 {results.filter(r => r.invoiceAttached).length} with invoice attached
                    </span>
                  )}
                </p>
                {results.filter(r => r.success && !r.invoiceAttached).length > 0 && (
                  <p className="text-xs text-[#92400E] mt-1">
                    ⚠ {results.filter(r => r.success && !r.invoiceAttached).length} sent without invoice (approve invoices first): {results.filter(r => r.success && !r.invoiceAttached).map(r => r.family).join(', ')}
                  </p>
                )}
                {results.filter(r => !r.success).length > 0 && (
                  <p className="text-xs text-red-600 mt-1">
                    {results.filter(r => !r.success).length} failed: {results.filter(r => !r.success).map(r => r.family).join(', ')}
                  </p>
                )}
              </div>
            )}

            {/* Bulk send */}
            {(() => {
              const unsent = familiesWithEmail.filter(f => !results.find(r => r.email === f.parent_email && r.success))
              return (
                <div className="flex items-center justify-between">
                  {unsent.length < familiesWithEmail.length && familiesWithEmail.length > 0
                    ? <span className="text-xs text-[#325099]/50">{familiesWithEmail.length - unsent.length} already sent</span>
                    : <span />}
                  <button
                    onClick={handleSend}
                    disabled={sending || unsent.length === 0}
                    className="bg-[#062E63] text-white text-sm font-semibold px-8 py-3 rounded-full disabled:opacity-40 hover:bg-[#325099] transition"
                  >
                    {sending ? 'Sending…' : unsent.length === 0 ? '✓ All sent' : `✉ Send to ${unsent.length} unsent ${unsent.length === 1 ? 'family' : 'families'}`}
                  </button>
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* ── Confirm modal ────────────────────────────────────────────────────── */}
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
              <button onClick={() => setConfirmSend(null)} className="text-sm font-semibold text-[#325099] px-4 py-2 rounded-full border border-[#DEE7FF] hover:bg-[#F0F4FF] transition">Cancel</button>
              <button onClick={() => executeSend(confirmSend)} className="text-sm font-semibold bg-[#062E63] text-white px-5 py-2 rounded-full hover:bg-[#325099] transition">Yes, send</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview modal ─────────────────────────────────────────────────────── */}
      {previewFamily && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={e => e.target === e.currentTarget && setPreviewFamily(null)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-[#DEE7FF] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#DEE7FF] bg-[#F8FAFF] shrink-0">
              <div>
                <p className="text-xs font-bold text-[#325099] tracking-wider uppercase">Email Preview</p>
                <p className="text-sm font-semibold text-[#062E63] mt-0.5">To: {previewFamily.parent_email}</p>
              </div>
              <button onClick={() => setPreviewFamily(null)} className="text-[#325099]/50 hover:text-[#062E63] text-xl leading-none transition">✕</button>
            </div>
            <div className="flex-1 overflow-auto">
              <iframe
                srcDoc={buildPreviewHtml(template, previewFamily, term?.name || '', termDates)}
                className="w-full border-0"
                style={{ minHeight: '500px' }}
                title="Email preview"
              />
            </div>
            <div className="px-5 py-3 border-t border-[#DEE7FF] bg-[#F8FAFF] flex justify-end gap-2 shrink-0">
              <button onClick={() => setPreviewFamily(null)} className="text-sm font-semibold text-[#325099] px-4 py-2 rounded-full border border-[#DEE7FF] hover:bg-[#F0F4FF] transition">Close</button>
              <button onClick={() => { setPreviewFamily(null); handleSendOne(previewFamily) }} disabled={sendingFamily === previewFamily.parent_email || sending} className="text-sm font-semibold bg-[#062E63] text-white px-5 py-2 rounded-full hover:bg-[#325099] transition disabled:opacity-40">✉ Send this email</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
