'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { buildDiscountEmailHtml, DEFAULT_DISCOUNT_CONTENT } from '../../../../lib/discountEmail'
import { authedFetch } from '../../../../lib/authedFetch'

const CONTENT_KEY = 'discount_email_content'

// label, field, rows (0 = single-line input)
const CONTENT_FIELDS = [
  ['Subject line',               'subject',          0],
  ['Headline',                   'heroTitle',        0],
  ['Intro (after "Hi {name},")', 'intro',            3],
  ['Referral card — headline',   'referralHeadline', 0],
  ['Referral card — text',       'referralBody',     3],
  ['How it works — step 1',      'step1',            2],
  ['How it works — step 2',      'step2',            2],
  ['How it works — step 3',      'step3',            2],
  ['Card 1 — title',             'multiTitle',       0],
  ['Card 1 — text',              'multiBody',        2],
  ['Card 2 — title',             'siblingTitle',     0],
  ['Card 2 — text',              'siblingBody',      2],
  ['Forms note',                 'formsNote',        2],
  ['Good to know (one bullet per line)', 'finePrint', 3],
  ['Button label',               'ctaLabel',         0],
  ['Button note',                'ctaNote',          0],
]
import { T_STUDENTS, T_PARENTS } from '../../../../lib/tables'
import { TEST_RECIPIENT } from '../../../../lib/emailConfig'

/*
 * Discount Program — /tutor/emails/discount-program
 * Marketing email: referral program (hero) + multi-course & sibling discounts.
 * One email per family (deduped by family number / guardian), with preview,
 * test-send to yourself, then the real send via /api/send-discount-program-emails.
 *
 * Suggested cadence (see docs/EMAIL_MARKETING_PLAN.md):
 *   Week 2 of term  → this email (families are settled, invoices done)
 *   Week 7–8        → re-enrolment season: term-start email mentions discounts
 *   New enrolments  → include discount one-liner in welcome email
 */

export default function DiscountProgramEmailPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [families, setFamilies] = useState([])    // { key, parent_name, parent_email, students: [names] }
  const [checked, setChecked] = useState({})      // key → bool
  const [sending, setSending] = useState(false)
  const [testing, setTesting] = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [testSentTo, setTestSentTo] = useState(null)
  const [content, setContent] = useState({ ...DEFAULT_DISCOUNT_CONTENT })
  const [editOpen, setEditOpen] = useState(false)
  const [savingContent, setSavingContent] = useState(false)
  const [contentSavedAt, setContentSavedAt] = useState(null)

  useEffect(() => {
    ;(async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile)

      // Saved email content (shared between directors via portal_settings)
      supabase.from('portal_settings').select('value').eq('key', CONTENT_KEY).maybeSingle()
        .then(({ data }) => {
          if (!data?.value) return
          try { setContent({ ...DEFAULT_DISCOUNT_CONTENT, ...JSON.parse(data.value) }) } catch {}
        })

      // Active students + their guardians → one row per family
      const [{ data: students }, { data: guardians }] = await Promise.all([
        supabase.from(T_STUDENTS).select('id, full_name, family_id, status').eq('status', 'active').order('full_name'),
        supabase.from(T_PARENTS).select('student_id, full_name, email'),
      ])
      const gByStudent = {}
      for (const g of guardians || []) (gByStudent[String(g.student_id)] = gByStudent[String(g.student_id)] ?? []).push(g)

      const map = {} // family key → entry
      for (const s of students || []) {
        const gs = gByStudent[s.id] ?? []
        const primary = gs.find(g => g.email) ?? gs[0] ?? null
        // Group siblings by family number; students without one stand alone
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
      // Pre-tick everyone who has an email
      setChecked(Object.fromEntries(list.map(f => [f.key, !!f.parent_email])))
      setLoading(false)
    })()
  }, [router])

  const selected = useMemo(() => families.filter(f => checked[f.key] && f.parent_email), [families, checked])
  const noEmailCount = useMemo(() => families.filter(f => !f.parent_email).length, [families])
  const previewHtml = useMemo(() => buildDiscountEmailHtml(selected[0]?.parent_name || 'there', content), [selected, content])
  const setField = (key) => (e) => { setContent(prev => ({ ...prev, [key]: e.target.value })); setContentSavedAt(null) }

  const saveContent = async () => {
    setSavingContent(true); setError(null)
    const { error: err } = await supabase.from('portal_settings')
      .upsert({ key: CONTENT_KEY, value: JSON.stringify(content), updated_at: new Date().toISOString() })
    setSavingContent(false)
    if (err) { setError('Could not save content: ' + err.message); return }
    setContentSavedAt(new Date())
  }

  const sendTest = async () => {
    setTesting(true); setError(null); setTestSentTo(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const email = user?.email || profile?.email
      if (!email) throw new Error('Could not determine your email address.')
      const res = await authedFetch('/api/send-discount-program-emails', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true, testEmail: email, content }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Test send failed')
      setTestSentTo(email)
    } catch (e) { setError(e.message) }
    finally { setTesting(false) }
  }

  // Per-family test — sends THAT family's exact email to CUBE staff only (TEST).
  const [testingKey, setTestingKey] = useState(null)
  const sendTestOne = async (family) => {
    setTestingKey(family.key); setError(null); setTestSentTo(null)
    try {
      const res = await authedFetch('/api/send-discount-program-emails', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, test: true, families: [{ parent_name: family.parent_name, parent_email: family.parent_email }] }),
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
      const res = await authedFetch('/api/send-discount-program-emails', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, families: selected.map(f => ({ parent_name: f.parent_name, parent_email: f.parent_email })) }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Send failed')
      setResults(body)
    } catch (e) { setError(e.message) }
    finally { setSending(false) }
  }

  if (!profile) return <div className="min-h-screen bg-[#F8FAFF]" />

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile.full_name} isAdmin />
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-20">
        <Link href="/tutor/emails" className="text-xs text-[#325099] hover:underline">← Emails</Link>
        <div className="flex items-start justify-between gap-4 mt-1 mb-2">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">🎁 Discount Program</h1>
            <p className="text-sm text-[#325099]/60 mt-1">
              Referral program ($50 for both families) + multi-course and sibling discounts. One email per family.
            </p>
          </div>
        </div>
        {/* Editable email content — every text block, persisted in portal_settings */}
        <div className="bg-white border border-[#DEE7FF] rounded-2xl mb-6 overflow-hidden">
          <button onClick={() => setEditOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#F8FAFF] transition">
            <span className="text-xs font-bold text-[#062E63]">✏️ Edit email content <span className="font-normal text-[#2A2035]/40">— **bold** supported · changes preview live</span></span>
            <span className="text-[#325099] text-xs">{editOpen ? '▲ Collapse' : '▼ Expand'}</span>
          </button>
          {editOpen && (
            <div className="border-t border-[#DEE7FF] p-4">
              <div className="grid sm:grid-cols-2 gap-3">
                {CONTENT_FIELDS.map(([label, key, rows]) => (
                  <div key={key} className={rows >= 3 ? 'sm:col-span-2' : ''}>
                    <label className="block text-[10px] font-bold text-[#325099] uppercase tracking-wide mb-1">{label}</label>
                    {rows === 0 ? (
                      <input type="text" value={content[key]} onChange={setField(key)}
                        className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099]" />
                    ) : (
                      <textarea value={content[key]} onChange={setField(key)} rows={rows}
                        className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs text-[#2A2035] leading-relaxed focus:outline-none focus:border-[#325099] resize-y" />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#F0F4FF]">
                <button onClick={saveContent} disabled={savingContent}
                  className="px-4 py-2 rounded-xl bg-[#325099] text-white text-xs font-semibold hover:bg-[#062E63] transition disabled:opacity-50">
                  {savingContent ? 'Saving…' : 'Save content'}
                </button>
                <button onClick={() => { setContent({ ...DEFAULT_DISCOUNT_CONTENT }); setContentSavedAt(null) }}
                  className="px-3 py-2 text-xs font-semibold text-[#2A2035]/50 hover:text-[#325099]">
                  Reset all to default
                </button>
                {contentSavedAt && <span className="text-[11px] font-semibold text-emerald-700">✓ Saved — used for all future sends</span>}
                {!contentSavedAt && <span className="text-[10px] text-[#2A2035]/40">Unsaved edits still apply to this send; Save to keep them for next time.</span>}
              </div>
            </div>
          )}
        </div>

        {error && <div className="mb-4 px-4 py-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-medium">{error}</div>}

        <div className="grid lg:grid-cols-2 gap-6">
          {/* ── Left: recipients ─────────────────────────────────────────── */}
          <div>
            <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#DEE7FF] bg-[#F8FAFF]">
                <p className="text-xs font-bold text-[#062E63]">Recipients — {selected.length} of {families.length} families</p>
                <div className="flex gap-2">
                  <button onClick={() => setChecked(Object.fromEntries(families.map(f => [f.key, !!f.parent_email])))} className="text-[10px] font-semibold text-[#325099] hover:underline">All</button>
                  <button onClick={() => setChecked({})} className="text-[10px] font-semibold text-[#325099] hover:underline">None</button>
                </div>
              </div>
              <div className="max-h-[420px] overflow-y-auto divide-y divide-[#F0F4FF]">
                {loading ? <p className="text-center text-xs text-[#2A2035]/40 py-8 animate-pulse">Loading families…</p>
                  : families.map(f => (
                    <label key={f.key} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[#F8FAFF] transition ${!f.parent_email ? 'opacity-50' : ''}`}>
                      <input type="checkbox" disabled={!f.parent_email} checked={!!checked[f.key]} onChange={e => setChecked(prev => ({ ...prev, [f.key]: e.target.checked }))} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-semibold text-[#2A2035] truncate">{f.parent_name || <em className="text-[#2A2035]/40">No guardian email on file</em>}</span>
                        <span className="block text-[10px] text-[#2A2035]/45 truncate">{f.students.join(', ')}{f.parent_email ? ` · ${f.parent_email}` : ''}</span>
                      </span>
                      {f.parent_email && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); sendTestOne(f) }}
                          disabled={testingKey === f.key || sending}
                          title="Send this exact email to CUBE staff only (marked TEST)"
                          className="shrink-0 text-[10px] font-semibold text-[#92400E] border border-[#FDE68A] bg-[#FFFBEB] hover:bg-[#FEF3C7] px-2.5 py-1 rounded-full transition disabled:opacity-40"
                        >{testingKey === f.key ? 'Testing…' : '🧪 Test'}</button>
                      )}
                    </label>
                  ))}
              </div>
            </div>
            {noEmailCount > 0 && (
              <p className="text-[10px] text-[#92400E] mt-2">⚠ {noEmailCount} famil{noEmailCount === 1 ? 'y has' : 'ies have'} no guardian email — fix in the Guardians table to include them.</p>
            )}

            {/* Send controls */}
            <div className="mt-4 bg-white rounded-2xl border border-[#DEE7FF] p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={sendTest} disabled={testing || sending}
                  className="px-4 py-2 rounded-xl border border-[#325099] text-[#325099] text-sm font-semibold hover:bg-[#F0F4FF] transition disabled:opacity-40">
                  {testing ? 'Sending test…' : '✉ Send test to myself'}
                </button>
                {!confirmSend ? (
                  <button onClick={() => setConfirmSend(true)} disabled={!selected.length || sending || testing}
                    className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-40">
                    Send to {selected.length} famil{selected.length === 1 ? 'y' : 'ies'}
                  </button>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#92400E]">Really send {selected.length} emails?</span>
                    <button onClick={sendAll} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition">Yes, send</button>
                    <button onClick={() => setConfirmSend(false)} className="px-3 py-2 text-xs font-semibold text-[#2A2035]/50 hover:text-[#2A2035]">Cancel</button>
                  </span>
                )}
                {sending && <span className="text-xs text-[#325099] animate-pulse font-semibold">Sending…</span>}
              </div>
              {testSentTo && <p className="text-[11px] font-semibold text-emerald-700">✓ Test sent to {testSentTo} — check your inbox before the real send.</p>}
            </div>

            {/* Results */}
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

          {/* ── Right: live preview ──────────────────────────────────────── */}
          <div>
            <p className="text-xs font-bold text-[#062E63] mb-2">Preview <span className="font-normal text-[#2A2035]/40">— personalised per parent ({selected[0]?.parent_name?.split(' ')[0] || 'there'} shown)</span></p>
            <div className="rounded-2xl border border-[#DEE7FF] overflow-hidden bg-white" style={{ height: 640 }}>
              <iframe title="Email preview" srcDoc={previewHtml} className="w-full h-full" style={{ border: 0 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
