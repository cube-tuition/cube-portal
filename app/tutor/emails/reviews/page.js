'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { authedFetch } from '../../../../lib/authedFetch'
import { T_STUDENTS, T_PARENTS } from '../../../../lib/tables'
import { TEST_RECIPIENT } from '../../../../lib/emailConfig'
import {
  buildReviewEmailHtml, reviewEmailSubject, isValidReviewUrl, studentNamesFor,
  DEFAULT_REVIEW_CONTENT, REVIEW_CONTENT_KEY, REVIEW_LOG_KEY,
} from '../../../../lib/reviewEmail'

/*
 * Review requests — /tutor/emails/reviews
 * Asks families for a Google review, one email per family. Every send is
 * logged (portal_settings[review_request_log]), so each family shows when it
 * was asked and the families not yet asked are pre-selected.
 *
 * Google's review policy: ask everyone — never only the families you expect
 * to be happy — and offer nothing in return. The page pre-selects by send
 * history only, never by anything about the family.
 */

// label, field, rows (0 = single-line input)
const CONTENT_FIELDS = [
  ['Subject',              'subject',         0],
  ['Message',              'body',            7],
  ['Button label',         'ctaLabel',        0],
  ['Note under button',    'ctaNote',         0],
  ['Sign-off',             'signoff',         2],
]

const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''

export default function ReviewEmailPage() {
  const router = useRouter()
  const [profile, setProfile]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [families, setFamilies] = useState([])   // { key, parent_name, parent_email, students: [full names] }
  const [log, setLog]           = useState({})   // email → { asked }
  const [checked, setChecked]   = useState({})
  const [content, setContent]   = useState({ ...DEFAULT_REVIEW_CONTENT })
  const [editOpen, setEditOpen] = useState(false)
  const [savingContent, setSavingContent] = useState(false)
  const [contentSavedAt, setContentSavedAt] = useState(null)
  const [sending, setSending]   = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [testingKey, setTestingKey] = useState(null)
  const [testSentTo, setTestSentTo] = useState(null)
  const [results, setResults]   = useState(null)
  const [error, setError]       = useState(null)

  useEffect(() => {
    ;(async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile)

      const [{ data: saved }, { data: savedLog }, { data: students }, { data: guardians }] = await Promise.all([
        supabase.from('portal_settings').select('value').eq('key', REVIEW_CONTENT_KEY).maybeSingle(),
        supabase.from('portal_settings').select('value').eq('key', REVIEW_LOG_KEY).maybeSingle(),
        supabase.from(T_STUDENTS).select('id, full_name, family_id, status').eq('status', 'active').order('full_name'),
        supabase.from(T_PARENTS).select('student_id, full_name, email'),
      ])
      if (saved?.value) { try { setContent({ ...DEFAULT_REVIEW_CONTENT, ...JSON.parse(saved.value) }) } catch {} }
      let lg = {}
      if (savedLog?.value) { try { lg = JSON.parse(savedLog.value) || {} } catch {} }
      setLog(lg)

      // Active students + guardians → one row per family (siblings together).
      const gByStudent = {}
      for (const g of guardians || []) (gByStudent[String(g.student_id)] ||= []).push(g)
      const map = {}
      for (const s of students || []) {
        const gs = gByStudent[s.id] ?? []
        const primary = gs.find(g => g.email) ?? gs[0] ?? null
        const key = s.family_id !== null && s.family_id !== undefined
          ? `f_${s.family_id}`
          : (primary?.email ? `e_${primary.email.toLowerCase()}` : `s_${s.id}`)
        if (!map[key]) map[key] = { key, parent_name: null, parent_email: null, students: [] }
        map[key].students.push(s.full_name)
        if (!map[key].parent_email && primary?.email) {
          map[key].parent_email = primary.email
          map[key].parent_name  = primary.full_name
        }
      }
      const list = Object.values(map).sort((a, b) => (a.parent_name ?? 'zz').localeCompare(b.parent_name ?? 'zz'))
      setFamilies(list)
      setChecked(defaultSelection(list, lg))
      setLoading(false)
    })()
  }, [router])

  const logOf = (f) => (f.parent_email ? log[f.parent_email.toLowerCase()] : null) || {}
  // Every family not asked yet. Selection follows send history only — never
  // who is likely to be happy.
  function defaultSelection(list, lg) {
    return Object.fromEntries(list.map(f => {
      const e = f.parent_email ? (lg[f.parent_email.toLowerCase()] || {}) : null
      return [f.key, !!e && !e.asked]
    }))
  }

  const selected = useMemo(() => families.filter(f => checked[f.key] && f.parent_email), [families, checked])
  const askedCount = families.filter(f => logOf(f).asked).length
  const noEmailCount = families.filter(f => !f.parent_email).length
  const linkOk = isValidReviewUrl(content.reviewUrl)
  const sample = selected[0] || families.find(f => f.parent_email) || null
  const previewHtml = useMemo(() => buildReviewEmailHtml(
    { parentName: sample?.parent_name || 'there', studentNames: studentNamesFor(sample?.students || []) },
    content), [sample, content])

  const setField = (key) => (e) => { setContent(prev => ({ ...prev, [key]: e.target.value })); setContentSavedAt(null) }
  const saveContent = async () => {
    setSavingContent(true); setError(null)
    const { error: err } = await supabase.from('portal_settings')
      .upsert({ key: REVIEW_CONTENT_KEY, value: JSON.stringify(content), updated_at: new Date().toISOString() })
    setSavingContent(false)
    if (err) { setError('Could not save: ' + err.message); return }
    setContentSavedAt(new Date())
  }

  const payload = (list) => list.map(f => ({
    parent_name: f.parent_name, parent_email: f.parent_email, student_names: studentNamesFor(f.students),
  }))

  // Test — that family's exact email, redirected to CUBE staff only (marked TEST).
  const sendTestOne = async (family) => {
    setTestingKey(family.key); setError(null); setTestSentTo(null)
    try {
      const res = await authedFetch('/api/send-review-emails', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, test: true, families: payload([family]) }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Test send failed')
      setTestSentTo(`${TEST_RECIPIENT} (test for ${family.parent_name || family.parent_email})`)
    } catch (e) { setError(e.message) }
    finally { setTestingKey(null) }
  }

  const sendAll = async () => {
    setConfirmSend(false); setSending(true); setError(null); setResults(null)
    try {
      const res = await authedFetch('/api/send-review-emails', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, families: payload(selected) }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Send failed')
      setResults(body)
      if (body.log) { setLog(body.log); setChecked(defaultSelection(families, body.log)) }
    } catch (e) { setError(e.message) }
    finally { setSending(false) }
  }

  if (!profile) return <div className="min-h-screen bg-[#F8FAFF]" />

  const INP = 'w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099]'
  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile.full_name} isAdmin />
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-20">
        <Link href="/tutor/emails" className="text-xs text-[#325099] hover:underline">← Emails</Link>
        <div className="mt-1 mb-4">
          <h1 className="text-2xl font-bold text-[#062E63]">⭐ Review Requests</h1>
          <p className="text-sm text-[#325099]/60 mt-1">
            Ask families for a Google review — one email per family, with a record of who has been asked.
          </p>
        </div>

        {/* Review link — the one thing the email cannot go without */}
        <div className={`rounded-2xl border p-4 mb-4 ${linkOk ? 'bg-white border-[#DEE7FF]' : 'bg-amber-50 border-amber-200'}`}>
          <label className="block text-[10px] font-bold text-[#325099] uppercase tracking-wide mb-1">Google review link</label>
          <div className="flex gap-2 items-center flex-wrap">
            <input type="url" value={content.reviewUrl} onChange={setField('reviewUrl')} placeholder="https://g.page/r/…/review"
              className={`${INP} flex-1 min-w-[16rem]`} />
            {linkOk && <a href={content.reviewUrl} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-[#325099] hover:underline">Test link ↗</a>}
            <button onClick={saveContent} disabled={savingContent}
              className="px-3 py-1.5 rounded-lg bg-[#325099] text-white text-xs font-semibold hover:bg-[#062E63] disabled:opacity-50">
              {savingContent ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="text-[11px] text-[#2A2035]/55 mt-2 leading-relaxed">
            {linkOk ? 'Every email’s button opens this link.' : 'Sending is blocked until this is set. '}
            To get it: sign in to your <strong>Google Business Profile</strong> (search “CUBE Tuition” on Google while signed in), choose <strong>Ask for reviews</strong> (or “Read reviews → Get more reviews”), and copy the link.
          </p>
        </div>

        {/* Editable content */}
        <div className="bg-white border border-[#DEE7FF] rounded-2xl mb-6 overflow-hidden">
          <button onClick={() => setEditOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#F8FAFF] transition">
            <span className="text-xs font-bold text-[#062E63]">✏️ Edit email text <span className="font-normal text-[#2A2035]/40">— {'{{parent_name}}'}, {'{{student_names}}'} · **bold** · [label](https://…) · previews live</span></span>
            <span className="text-[#325099] text-xs">{editOpen ? '▲ Collapse' : '▼ Expand'}</span>
          </button>
          {editOpen && (
            <div className="border-t border-[#DEE7FF] p-4">
              <div className="grid sm:grid-cols-2 gap-3">
                {CONTENT_FIELDS.map(([label, key, rows]) => (
                  <div key={key} className={rows >= 3 ? 'sm:col-span-2' : ''}>
                    <label className="block text-[10px] font-bold text-[#325099] uppercase tracking-wide mb-1">{label}</label>
                    {rows === 0
                      ? <input type="text" value={content[key]} onChange={setField(key)} className={INP} />
                      : <textarea value={content[key]} onChange={setField(key)} rows={rows} className={`${INP} leading-relaxed resize-y`} />}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#F0F4FF]">
                <button onClick={saveContent} disabled={savingContent}
                  className="px-4 py-2 rounded-xl bg-[#325099] text-white text-xs font-semibold hover:bg-[#062E63] transition disabled:opacity-50">
                  {savingContent ? 'Saving…' : 'Save text'}
                </button>
                <button onClick={() => { setContent(prev => ({ ...DEFAULT_REVIEW_CONTENT, reviewUrl: prev.reviewUrl })); setContentSavedAt(null) }}
                  className="px-3 py-2 text-xs font-semibold text-[#2A2035]/50 hover:text-[#325099]">Reset text to default</button>
                {contentSavedAt
                  ? <span className="text-[11px] font-semibold text-emerald-700">✓ Saved</span>
                  : <span className="text-[10px] text-[#2A2035]/40">Unsaved edits still apply to this send.</span>}
              </div>
            </div>
          )}
        </div>

        {error && <div className="mb-4 px-4 py-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-medium">{error}</div>}

        <p className="text-xs text-[#2A2035]/45 mb-3">{askedCount} of {families.length} families asked so far · families not yet asked are pre-selected</p>

        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#DEE7FF] bg-[#F8FAFF]">
                <p className="text-xs font-bold text-[#062E63]">Recipients — {selected.length} of {families.length} families</p>
                <div className="flex gap-2">
                  <button onClick={() => setChecked(defaultSelection(families, log))} className="text-[10px] font-semibold text-[#325099] hover:underline">Not asked yet</button>
                  <button onClick={() => setChecked(Object.fromEntries(families.map(f => [f.key, !!f.parent_email])))} className="text-[10px] font-semibold text-[#325099] hover:underline">All</button>
                  <button onClick={() => setChecked({})} className="text-[10px] font-semibold text-[#325099] hover:underline">None</button>
                </div>
              </div>
              <div className="max-h-[440px] overflow-y-auto divide-y divide-[#F0F4FF]">
                {loading ? <p className="text-center text-xs text-[#2A2035]/40 py-8 animate-pulse">Loading families…</p>
                  : families.map(f => {
                    const lg = logOf(f)
                    return (
                      <label key={f.key} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[#F8FAFF] transition ${!f.parent_email ? 'opacity-50' : ''}`}>
                        <input type="checkbox" disabled={!f.parent_email} checked={!!checked[f.key]} onChange={e => setChecked(prev => ({ ...prev, [f.key]: e.target.checked }))} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-semibold text-[#2A2035] truncate">{f.parent_name || <em className="text-[#2A2035]/40">No guardian email on file</em>}</span>
                          <span className="block text-[10px] text-[#2A2035]/45 truncate">{f.students.join(', ')}{f.parent_email ? ` · ${f.parent_email}` : ''}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-right leading-tight">
                          {lg.asked ? <span className="block text-emerald-700 font-semibold">Asked {fmtDate(lg.asked)}</span> : <span className="block text-[#2A2035]/35">Not asked</span>}
                        </span>
                        {f.parent_email && (
                          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); sendTestOne(f) }}
                            disabled={!linkOk || testingKey === f.key || sending}
                            title="Send this exact email to CUBE staff only (marked TEST)"
                            className="shrink-0 text-[10px] font-semibold text-[#92400E] border border-[#FDE68A] bg-[#FFFBEB] hover:bg-[#FEF3C7] px-2.5 py-1 rounded-full transition disabled:opacity-40">
                            {testingKey === f.key ? 'Testing…' : '🧪 Test'}
                          </button>
                        )}
                      </label>
                    )
                  })}
              </div>
            </div>
            {noEmailCount > 0 && (
              <p className="text-[10px] text-[#92400E] mt-2">⚠ {noEmailCount} famil{noEmailCount === 1 ? 'y has' : 'ies have'} no guardian email — fix in the Guardians table to include them.</p>
            )}

            <div className="mt-4 bg-white rounded-2xl border border-[#DEE7FF] p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                {!confirmSend ? (
                  <button onClick={() => setConfirmSend(true)} disabled={!linkOk || !selected.length || sending}
                    title={!linkOk ? 'Set the Google review link first' : ''}
                    className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-40">
                    Send to {selected.length} famil{selected.length === 1 ? 'y' : 'ies'}
                  </button>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#92400E]">Really send {selected.length} email{selected.length === 1 ? '' : 's'}?</span>
                    <button onClick={sendAll} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition">Yes, send</button>
                    <button onClick={() => setConfirmSend(false)} className="px-3 py-2 text-xs font-semibold text-[#2A2035]/50 hover:text-[#2A2035]">Cancel</button>
                  </span>
                )}
                {sending && <span className="text-xs text-[#325099] animate-pulse font-semibold">Sending…</span>}
              </div>
              <p className="text-[10px] text-[#2A2035]/45">Tip: send it a few days after end-of-term reports go out. Use 🧪 Test on any family first.</p>
              {testSentTo && <p className="text-[11px] font-semibold text-emerald-700">✓ Test sent to {testSentTo} — check your inbox before the real send.</p>}
            </div>

            {results && (
              <div className="mt-4 bg-white rounded-2xl border border-[#DEE7FF] p-4">
                <p className="text-xs font-bold text-[#062E63] mb-2">
                  Sent {results.successCount} of {results.total}
                  {results.successCount < results.total && <span className="text-rose-600"> — {results.total - results.successCount} failed</span>}
                </p>
                <div className="max-h-44 overflow-y-auto space-y-1">
                  {results.results.map((r, i) => (
                    <p key={i} className={`text-[11px] ${r.success ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {r.success ? '✓' : '✕'} {r.family || r.email}{r.error ? ` — ${r.error}` : ''}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-bold text-[#062E63] mb-1">Preview <span className="font-normal text-[#2A2035]/40">({sample?.parent_name || 'sample family'} shown)</span></p>
            <p className="text-[11px] text-[#2A2035]/55 mb-2">Subject: <strong>{reviewEmailSubject(content)}</strong></p>
            <div className="rounded-2xl border border-[#DEE7FF] overflow-hidden bg-white" style={{ height: 620 }}>
              <iframe title="Email preview" srcDoc={previewHtml} className="w-full h-full" style={{ border: 0 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
