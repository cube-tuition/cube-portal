'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../../../lib/terms'
import { CADENCE_KEY, CADENCE_DONE_KEY, DEFAULT_CADENCE, parseCadence, cadenceHref, termWeek, markCadenceDone } from '../../../../lib/emailCadence'
import { publicFormUrl } from '../../../../lib/forms'
import { T_COURSE_OFFERS, T_HOLIDAY_COURSE_EMAILS, T_FORMS } from '../../../../lib/tables'

/*
 * Marketing — /tutor/admin/marketing (admin only)
 *
 * The marketing regime on one page. The FUNNEL across the top is the frame:
 * five stages a family moves through, live counts on the boxes, conversion
 * on the arrows, and under each stage the actions that move families along.
 * Below it the TERM PLAN puts those actions on a ten-week strip with done
 * ticks (the same cadence the Action Centre raises each week), CHANNELS shows
 * where enquiries come from and what the referral programme is doing, and
 * CAMPAIGNS / LINKS gather the sendable pieces and public forms.
 */

const STAGES = [
  { key: 'reach',   label: 'Reach',        blurb: 'Families hear of CUBE',
    actions: [
      { label: 'Referral programme ($50 each way)', href: '/tutor/emails/discount-program' },
      { label: 'Website free-trial form', href: 'https://www.cubetuition.com.au/free-trial', external: true },
      { label: 'Google reviews ask (after reports)', href: '/tutor/emails/end-of-term' },
      { label: 'Holiday course push', href: '/tutor/emails/holiday-courses' },
    ] },
  { key: 'enquire', label: 'Enquire',      blurb: 'A trial request arrives',
    actions: [
      { label: 'Follow up within 2 days', href: '/tutor/trials' },
      { label: 'Book a trial + level test', href: '/tutor/trials' },
    ] },
  { key: 'trial',   label: 'Trial',        blurb: 'They try a lesson',
    actions: [
      { label: 'Trial reminder email', href: '/tutor/emails/trials' },
      { label: 'Trial outcome + level-test report', href: '/tutor/trials' },
    ] },
  { key: 'enrol',   label: 'Enrol',        blurb: 'They join for the term',
    actions: [
      { label: 'Term Start email + invoice', href: '/tutor/emails/term-start' },
      { label: 'Enrolment form', href: '/tutor/admin/forms' },
      { label: 'Welcome line: "ask about referral & sibling discounts"', href: '/tutor/emails' },
    ] },
  { key: 'stay',    label: 'Stay & refer', blurb: 'They re-enrol and bring others',
    actions: [
      { label: 'Discount Program email (week 2)', href: '/tutor/emails/discount-program' },
      { label: 'Mid-term + end-of-term reports', href: '/tutor/emails/end-of-term' },
      { label: 'Re-enrolment reminder (weeks 7–8)', href: '/tutor/emails/term-start' },
      { label: 'Course Offers to existing families', href: '/tutor/emails/course-offers' },
    ] },
]

// Which funnel stage a plan row belongs to: an explicit 4th column wins, else
// it is inferred from the email's name.
const STAGE_KEYS = STAGES.map(s => s.key)
function stageOf(row) {
  const explicit = (row.stage || '').toLowerCase()
  const hit = STAGES.find(s => explicit && (s.key === explicit || s.label.toLowerCase().startsWith(explicit)))
  if (hit) return hit.key
  const e = (row.email || '').toLowerCase()
  if (e.includes('welcome') || e.includes('term start') || e.includes('invoice')) return 'enrol'
  if (e.includes('trial')) return 'trial'
  if (e.includes('holiday') || e.includes('review') || e.includes('social') || e.includes('flyer')) return 'reach'
  return 'stay'
}
// Rows are "When | Email | Notes" with optional "| Stage | Channel" columns.
function parsePlan(text) {
  return parseCadence(text).map(r => {
    const cols = (text.split('\n').map(l => l.trim()).filter(Boolean)[Number(r.key.split(':')[0])] || '').split('|').map(p => p.trim())
    return { ...r, stage: cols[3] || '', channel: cols[4] || '' }
  })
}

const CAMPAIGNS = [
  { href: '/tutor/emails/term-start',       icon: '🎉', title: 'Term Start',       what: 'Re-enrolment confirmation with class details and invoice notice.' },
  { href: '/tutor/emails/trials',           icon: '🧪', title: 'Trial reminders',  what: 'Welcome + first lesson details for new students.' },
  { href: '/tutor/emails/discount-program', icon: '🎁', title: 'Discount Program', what: 'Referral ($50 each way), multi-course and sibling discounts.' },
  { href: '/tutor/emails/course-offers',    icon: '📣', title: 'Course Offers',    what: 'Pitch a course to a chosen cohort.', table: T_COURSE_OFFERS },
  { href: '/tutor/emails/holiday-courses',  icon: '🏖️', title: 'Holiday Courses',  what: 'Advertise a holiday intensive with a sign-up link.', table: T_HOLIDAY_COURSE_EMAILS },
  { href: '/tutor/emails/end-of-term',      icon: '📋', title: 'Reports',          what: 'Mid-term and end-of-term reports — the goodwill peak, with the referral PS line.' },
]

const fmtPct = (a, b) => b > 0 ? `${Math.round((a / b) * 100)}%` : '—'
const fmtD = (iso) => iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—'

export default function MarketingPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [terms, setTerms] = useState([])
  const [term, setTerm] = useState(null)
  const [scope, setScope] = useState('term')          // 'term' | 'all'
  const [trials, setTrials] = useState([])
  const [credits, setCredits] = useState([])
  const [planText, setPlanText] = useState(DEFAULT_CADENCE)
  const [doneKeys, setDoneKeys] = useState([])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [templates, setTemplates] = useState({})      // table → [{name, updated_at}]
  const [forms, setForms] = useState([])
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    const allTerms = await fetchAllTerms()
    const cur = getCurrentTerm(allTerms)
    setTerms(allTerms); setTerm(cur)
    const [{ data: tr }, { data: cr }, { data: cad }, { data: done }, { data: co }, { data: hc }, { data: fm }] = await Promise.all([
      supabase.from('trial_submissions').select('id, submitted_at, status, contacted_at, trial_date, converted_student_id, how_heard, referred_by, source'),
      supabase.from('student_credits').select('student_id, amount, reason, created_at'),
      supabase.from('portal_settings').select('value').eq('key', CADENCE_KEY).maybeSingle(),
      cur ? supabase.from('portal_settings').select('value').eq('key', CADENCE_DONE_KEY(cur.id)).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from(T_COURSE_OFFERS).select('name, updated_at').order('updated_at', { ascending: false }),
      supabase.from(T_HOLIDAY_COURSE_EMAILS).select('name, updated_at').order('updated_at', { ascending: false }),
      supabase.from(T_FORMS).select('slug, title, active').order('title'),
    ])
    setTrials(tr || []); setCredits(cr || [])
    setPlanText(cad?.value || DEFAULT_CADENCE)
    try { setDoneKeys(JSON.parse(done?.value || '[]')) } catch { setDoneKeys([]) }
    setTemplates({ [T_COURSE_OFFERS]: co || [], [T_HOLIDAY_COURSE_EMAILS]: hc || [] })
    setForms(fm || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    (async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile); await load()
    })()
  }, [router, load])

  // ── Funnel numbers ─────────────────────────────────────────────────────────
  const inScope = useMemo(() => {
    if (scope === 'all' || !term) return trials
    return trials.filter(t => t.submitted_at && t.submitted_at.slice(0, 10) >= term.start_date && t.submitted_at.slice(0, 10) <= term.end_date)
  }, [trials, term, scope])
  const funnel = useMemo(() => {
    const enquired  = inScope.length
    const contacted = inScope.filter(t => t.contacted_at || ['contacted', 'trial_scheduled', 'enrolled', 'declined'].includes(t.status)).length
    const trialled  = inScope.filter(t => t.trial_date || ['trial_scheduled', 'enrolled'].includes(t.status)).length
    const enrolled  = inScope.filter(t => t.status === 'enrolled' || t.converted_student_id).length
    const referred  = inScope.filter(t => t.referred_by || /referr/i.test(t.how_heard || '')).length
    return { enquired, contacted, trialled, enrolled, referred }
  }, [inScope])

  const channels = useMemo(() => {
    const m = {}
    for (const t of inScope) {
      const k = (t.how_heard || '').trim() || 'Not recorded'
      m[k] ||= { n: 0, enrolled: 0 }
      m[k].n++
      if (t.status === 'enrolled' || t.converted_student_id) m[k].enrolled++
    }
    return Object.entries(m).map(([label, v]) => ({ label, ...v })).sort((a, b) => b.n - a.n)
  }, [inScope])

  const referral = useMemo(() => {
    const creditedStudents = new Set(credits.map(c => c.student_id))
    const owed = trials.filter(t => t.converted_student_id && t.referred_by && !creditedStudents.has(t.converted_student_id)).length
    const refCredits = credits.filter(c => /referr/i.test(c.reason || ''))
    return { owed, issued: refCredits.length, issuedTotal: refCredits.reduce((s, c) => s + Number(c.amount || 0), 0) }
  }, [trials, credits])

  // ── Plan ───────────────────────────────────────────────────────────────────
  const plan = useMemo(() => parsePlan(planText), [planText])
  const week = term ? termWeek(term, new Date().toISOString().slice(0, 10)) : null
  const savePlan = async () => {
    setSaving(true)
    const value = draft.trim() || DEFAULT_CADENCE
    const { error } = await supabase.from('portal_settings').upsert({ key: CADENCE_KEY, value, updated_at: new Date().toISOString() })
    setSaving(false)
    if (error) { alert('Could not save: ' + error.message); return }
    setPlanText(value); setEditing(false)
  }
  const toggleDone = async (row) => {
    if (!term) return
    if (doneKeys.includes(row.key)) {
      const next = doneKeys.filter(k => k !== row.key)
      await supabase.from('portal_settings').upsert({ key: CADENCE_DONE_KEY(term.id), value: JSON.stringify(next), updated_at: new Date().toISOString() })
      setDoneKeys(next)
    } else {
      await markCadenceDone(term.id, row.key)
      setDoneKeys([...doneKeys, row.key])
    }
  }
  const copy = async (text, k) => { try { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(''), 1500) } catch {} }

  if (!profile || loading) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const counts = { reach: funnel.referred, enquire: funnel.enquired, trial: funnel.trialled, enrol: funnel.enrolled, stay: funnel.referred }
  const arrows = [null, fmtPct(funnel.contacted, funnel.enquired), fmtPct(funnel.trialled, funnel.enquired), fmtPct(funnel.enrolled, funnel.trialled), fmtPct(funnel.referred, funnel.enrolled)]
  const rowsByStage = Object.fromEntries(STAGE_KEYS.map(k => [k, plan.filter(r => stageOf(r) === k)]))
  const maxChan = Math.max(1, ...channels.map(c => c.n))
  const referralLine = 'Know a family who’d benefit from CUBE? Refer them and you both get $50 off your term fees.'

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />
      <div className="max-w-6xl mx-auto px-6 pt-10 pb-16 space-y-6">
        <div className="rounded-2xl px-7 py-6 border bg-[#EEF3FF] border-[#DEE7FF] flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-3xl">📣</span>
            <div>
              <h1 className="text-2xl font-bold text-[#062E63]">Marketing</h1>
              <p className="text-xs text-[#2A2035]/55 mt-0.5">How families find CUBE, what moves them along, and what fires each week of the term.</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-white border border-[#DEE7FF] rounded-full p-1 text-xs font-semibold">
            <button onClick={() => setScope('term')} className={`px-3 py-1 rounded-full ${scope === 'term' ? 'bg-[#062E63] text-white' : 'text-[#325099]'}`}>{term ? formatTermLabel(term) : 'This term'}</button>
            <button onClick={() => setScope('all')} className={`px-3 py-1 rounded-full ${scope === 'all' ? 'bg-[#062E63] text-white' : 'text-[#325099]'}`}>All time</button>
          </div>
        </div>

        {/* ── Funnel ─────────────────────────────────────────────────────── */}
        <section className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
          <p className="text-xs font-bold text-[#062E63] mb-4">The journey — {scope === 'all' ? 'all time' : term ? formatTermLabel(term) : ''}</p>
          <div className="grid grid-cols-1 md:grid-cols-[repeat(5,minmax(0,1fr))] gap-3 items-stretch">
            {STAGES.map((s, i) => (
              <div key={s.key} className="relative flex flex-col">
                {i > 0 && (
                  <div className="hidden md:flex absolute -left-3 top-9 -translate-x-1/2 flex-col items-center z-10">
                    <span className="text-[#BACBFF] text-lg leading-none">→</span>
                    <span className="text-[9px] font-bold text-[#325099] bg-white px-1 rounded">{arrows[i]}</span>
                  </div>
                )}
                <div className={`rounded-xl border p-3.5 ${i === 3 ? 'bg-[#062E63] border-[#062E63] text-white' : 'bg-[#F8FAFF] border-[#DEE7FF]'}`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${i === 3 ? 'text-white/70' : 'text-[#325099]/70'}`}>{i + 1} · {s.label}</p>
                  <p className={`text-2xl font-bold tabular-nums mt-0.5 ${i === 3 ? 'text-white' : 'text-[#062E63]'}`}>
                    {s.key === 'reach' ? <span className="text-base">{counts.reach} via referral</span> : counts[s.key]}
                  </p>
                  <p className={`text-[11px] ${i === 3 ? 'text-white/70' : 'text-[#2A2035]/50'}`}>{s.blurb}</p>
                </div>
                <ul className="mt-2 space-y-1 flex-1">
                  {s.actions.map(a => (
                    <li key={a.label}>
                      {a.external
                        ? <a href={a.href} target="_blank" rel="noreferrer" className="block text-[11px] text-[#2A2035]/75 hover:text-[#325099] bg-white border border-[#F0F4FF] rounded-lg px-2.5 py-1.5">↗ {a.label}</a>
                        : <Link href={a.href} className="block text-[11px] text-[#2A2035]/75 hover:text-[#325099] bg-white border border-[#F0F4FF] rounded-lg px-2.5 py-1.5">{a.label}</Link>}
                    </li>
                  ))}
                  {rowsByStage[s.key].map(r => (
                    <li key={r.key} className={`text-[11px] rounded-lg px-2.5 py-1.5 border ${doneKeys.includes(r.key) ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]' : 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'}`} title={r.notes}>
                      {doneKeys.includes(r.key) ? '✓' : '○'} {r.email} <span className="opacity-60">· {r.when}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#2A2035]/40 mt-3">Counts come from the trials pipeline. Arrows show the share moving to the next stage. Amber items are this term&apos;s planned actions from the plan below; green are done.</p>
        </section>

        {/* ── Term plan ──────────────────────────────────────────────────── */}
        <section className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div>
              <p className="text-xs font-bold text-[#062E63]">📅 Term plan{term ? ` — ${formatTermLabel(term)}` : ''}{week ? ` · now week ${Math.min(week, 10)}` : ''}</p>
              <p className="text-[11px] text-[#2A2035]/45">The same plan the Action Centre raises each week. Tick an action when it has gone out.</p>
            </div>
            {!editing
              ? <button onClick={() => { setDraft(planText); setEditing(true) }} className="text-xs font-semibold text-[#325099] hover:underline">✏️ Edit plan</button>
              : <div className="flex items-center gap-2">
                  <button onClick={() => setDraft(DEFAULT_CADENCE)} className="text-[10px] font-semibold text-[#2A2035]/40 hover:text-[#325099]">Reset to default</button>
                  <button onClick={() => setEditing(false)} className="text-xs font-semibold text-[#2A2035]/50">Cancel</button>
                  <button onClick={savePlan} disabled={saving} className="text-xs font-semibold bg-[#325099] text-white px-3 py-1.5 rounded-lg hover:bg-[#062E63] disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
                </div>}
          </div>
          {editing ? (
            <>
              <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={Math.max(6, draft.split('\n').length + 1)}
                className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2.5 text-xs font-mono text-[#2A2035] leading-relaxed focus:outline-none focus:border-[#325099] resize-y" />
              <p className="text-[10px] text-[#2A2035]/40 mt-1.5">One row per line: <code className="font-mono">When | Action | Notes | Stage | Channel</code>. Stage (reach, enquire, trial, enrol, stay) and Channel are optional. Rows starting “Week N” land on the strip and become weekly to-dos.</p>
            </>
          ) : (
            <>
              {/* Ten-week strip */}
              <div className="overflow-x-auto">
                <div className="min-w-[720px]">
                  <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(11, minmax(0, 1fr))' }}>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map(w => (
                      <div key={w} className={`text-center text-[10px] font-bold py-1 rounded ${week === w ? 'bg-[#062E63] text-white' : 'bg-[#F0F4FF] text-[#325099]'}`}>W{w}</div>
                    ))}
                    <div className={`text-center text-[10px] font-bold py-1 rounded ${week > 10 ? 'bg-[#062E63] text-white' : 'bg-[#FFF7ED] text-[#92400E]'}`}>🏖</div>
                  </div>
                  <div className="mt-1 space-y-1">
                    {plan.filter(r => r.weekFrom !== null).map(r => {
                      const from = Math.min(11, r.weekFrom), to = Math.min(11, r.weekTo)
                      const done = doneKeys.includes(r.key)
                      return (
                        <div key={r.key} className="grid gap-1 items-center" style={{ gridTemplateColumns: 'repeat(11, minmax(0, 1fr))' }}>
                          <button onClick={() => toggleDone(r)} title={`${r.notes}${r.channel ? ` · ${r.channel}` : ''}\nClick to mark ${done ? 'not done' : 'done'} for this term`}
                            className={`text-left text-[11px] font-semibold rounded-lg px-2 py-1.5 truncate border transition ${done ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]' : week !== null && week >= from && week <= to ? 'bg-[#062E63] border-[#062E63] text-white' : 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'}`}
                            style={{ gridColumn: `${from} / ${to + 1}` }}>
                            {done ? '✓ ' : ''}{r.email}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
              {/* Standing rules + detail */}
              <div className="mt-4 divide-y divide-[#F0F4FF]">
                {plan.map(r => (
                  <div key={r.key} className="flex items-start gap-3 py-2">
                    <span className="text-[11px] font-bold text-[#325099] w-32 shrink-0 pt-0.5">{r.when}</span>
                    <Link href={cadenceHref(r.email)} className="text-xs font-semibold text-[#062E63] w-44 shrink-0 pt-0.5 hover:underline">{r.email}</Link>
                    <span className="text-xs text-[#2A2035]/60 leading-relaxed flex-1">{r.notes}{r.channel ? <span className="ml-2 text-[10px] font-semibold text-[#325099]/70">· {r.channel}</span> : null}</span>
                    {r.weekFrom !== null && term && (
                      <button onClick={() => toggleDone(r)} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${doneKeys.includes(r.key) ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]' : 'bg-white border-[#DEE7FF] text-[#325099]'}`}>
                        {doneKeys.includes(r.key) ? '✓ done' : 'mark done'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* ── Channels ───────────────────────────────────────────────── */}
          <section className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
            <p className="text-xs font-bold text-[#062E63] mb-1">📡 Where enquiries come from</p>
            <p className="text-[11px] text-[#2A2035]/45 mb-4">Each trial request&apos;s “how did you hear about us”, and how many of them enrolled.</p>
            {channels.length === 0 ? <p className="text-xs text-[#2A2035]/40">No trial requests in this range.</p> : (
              <div className="space-y-2">
                {channels.map(c => (
                  <div key={c.label}>
                    <div className="flex items-center justify-between text-[11px] mb-0.5">
                      <span className="font-semibold text-[#2A2035]">{c.label}</span>
                      <span className="text-[#2A2035]/50 tabular-nums">{c.n} enquir{c.n === 1 ? 'y' : 'ies'} · {c.enrolled} enrolled · {fmtPct(c.enrolled, c.n)}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-[#F0F4FF] overflow-hidden">
                      <div className="h-full bg-[#325099]" style={{ width: `${(c.n / maxChan) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-5 rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] p-3.5">
              <p className="text-[11px] font-bold text-[#062E63] mb-2">🎁 Referral programme</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-lg font-bold text-[#062E63] tabular-nums">{funnel.referred}</p><p className="text-[10px] text-[#2A2035]/50">referred enquiries</p></div>
                <div><p className="text-lg font-bold text-[#062E63] tabular-nums">{referral.issued}</p><p className="text-[10px] text-[#2A2035]/50">credits issued · ${referral.issuedTotal.toLocaleString('en-AU')}</p></div>
                <div><p className={`text-lg font-bold tabular-nums ${referral.owed ? 'text-[#B23A3A]' : 'text-[#047857]'}`}>{referral.owed}</p><p className="text-[10px] text-[#2A2035]/50">credits still to issue</p></div>
              </div>
              {referral.owed > 0 && <Link href="/tutor/trials" className="block text-center text-[11px] font-semibold text-[#325099] hover:underline mt-2">Issue them from Trials →</Link>}
            </div>
          </section>

          {/* ── Campaigns ──────────────────────────────────────────────── */}
          <section className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
            <p className="text-xs font-bold text-[#062E63] mb-1">✉️ Campaigns</p>
            <p className="text-[11px] text-[#2A2035]/45 mb-4">Everything you can send, and its saved templates.</p>
            <div className="divide-y divide-[#F0F4FF]">
              {CAMPAIGNS.map(c => {
                const tpl = c.table ? templates[c.table] || [] : null
                return (
                  <Link key={c.href} href={c.href} className="flex items-start gap-3 py-2.5 group">
                    <span className="text-xl leading-none mt-0.5">{c.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-bold text-[#062E63] group-hover:underline">{c.title}</span>
                      <span className="block text-[11px] text-[#2A2035]/55">{c.what}</span>
                      {tpl && <span className="block text-[10px] text-[#325099]/70 mt-0.5">{tpl.length ? `${tpl.length} template${tpl.length === 1 ? '' : 's'} · last edited ${fmtD(tpl[0].updated_at)}` : 'no templates yet'}</span>}
                    </span>
                    <span className="text-[11px] font-semibold text-[#325099] shrink-0">Open →</span>
                  </Link>
                )
              })}
            </div>
          </section>
        </div>

        {/* ── Links & copy ───────────────────────────────────────────────── */}
        <section className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
          <p className="text-xs font-bold text-[#062E63] mb-1">🔗 Links and standing copy</p>
          <p className="text-[11px] text-[#2A2035]/45 mb-4">Paste these into emails, the website or a message so the wording and links stay the same everywhere.</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {[{ k: 'trial', label: 'Free trial form (website)', value: 'https://www.cubetuition.com.au/free-trial' },
              ...forms.map(f => ({ k: f.slug, label: `${f.title}${f.active ? '' : ' (closed)'}`, value: publicFormUrl(f.slug) })),
              { k: 'ref', label: 'Referral one-liner', value: referralLine }].map(item => (
              <div key={item.k} className="flex items-center gap-2 rounded-xl border border-[#F0F4FF] bg-[#FBFCFF] px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold text-[#062E63]">{item.label}</span>
                  <span className="block text-[10px] text-[#2A2035]/50 truncate">{item.value}</span>
                </span>
                <button onClick={() => copy(item.value, item.k)} className="text-[10px] font-semibold px-2 py-1 rounded-full border border-[#DEE7FF] bg-white text-[#325099] hover:border-[#325099] shrink-0">{copied === item.k ? 'Copied ✓' : 'Copy'}</button>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#2A2035]/40 mt-3">Manage forms on <Link href="/tutor/admin/forms" className="text-[#325099] hover:underline">Forms</Link>. {terms.length ? `${terms.filter(t => Number(t.term_number) <= 10).length} terms on record.` : ''}</p>
        </section>
      </div>
    </div>
  )
}
