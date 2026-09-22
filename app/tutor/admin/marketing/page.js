'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'

/*
 * Marketing — /tutor/admin/marketing (admin only)
 *
 * STRATEGIES lists every way CUBE reaches families, grouped by channel and
 * editable in place; CHANNELS shows where enquiries actually come from and
 * what the referral programme is doing.
 */

// ── The six-month goal ────────────────────────────────────────────────────────
// Double the student count: 45 active students on 23 Sep 2026 → 90 by 23 Mar
// 2027. Progress is live (active students now); the plan below is the route,
// with a target per channel that adds up to the gap plus the Year 12 leavers.
const GOAL = { baseline: 45, baselineDate: '2026-09-23', target: 90, deadline: '2027-03-23', year12Leaving: 8 }
const PLAN_CHANNELS = [
  { icon: '🎁', name: 'Referrals', target: 20, why: '11 of the last 17 enquiries were referrals — the channel that already works, doubled down.',
    actions: [
      'Referral email in week 2 of Term 4 and again week 2 of Term 1 (Discount Program page): $50 off for both families.',
      'Hand every family a referral card with the end-of-term report (week 10) — name on it, $50 each way, a QR to the free-trial form.',
      '"Bring a friend" to the holiday intensive: a second student from a new family attends the first day free.',
      'Issue every referral credit within a week and say so in the invoice email — a credit families see is a credit they mention.',
      'Ask the 10 longest-standing families personally, by phone, for one introduction each.',
    ] },
  { icon: '🏖️', name: 'Holiday intensives', target: 12, why: 'Short courses are the lowest-commitment way into CUBE; convert them into term enrolments.',
    actions: [
      'Term 3–4 break (28 Sep – 3 Oct): the Year 6 Head Start intensive, already built — fill it via the Holiday Courses email and the sign-up form.',
      'January: "Year 7 Ready" (Maths + English, one week) and "HSC Kick-off" for the new Year 12 cohort (Adv Maths, Chemistry).',
      'Every holiday student gets an offer on the last day: enrol for the term by the Friday and the first fortnight is $50 off.',
      'Target: 20 holiday students across both breaks, 60% converting to a term class.',
    ] },
  { icon: '🌐', name: 'Google & website', target: 10, why: 'Only 2 enquiries came from search; the profile has almost no reviews. This is the cheapest untapped channel.',
    actions: [
      'Google Business profile: ask the 20 happiest families for a review in the week after end-of-term reports (a link in the reports email). Target 25 reviews by January.',
      'Google Ads: $300/month from November to February on "tutoring Chatswood", "HSC tutoring", "Year 7 maths tutor", landing on the free-trial form.',
      'Website: add the January course dates and the timetable in November so summer searches land on something concrete.',
      'Every enquiry gets a same-day call and a trial booked within a week — the free-trial form is only worth what the follow-up is.',
    ] },
  { icon: '📍', name: 'Local schools & community', target: 8, why: 'Families of the current Year 6 and Year 10 cohorts cluster around a few schools.',
    actions: [
      'A one-page flyer ("Year 7 head start · Free trial · $50 referral") to the P&C newsletters of the five primary schools most of our Year 5–6 students attend, in late October and again in late January.',
      'Notice boards: Chatswood library, the community centre, the two nearest swim schools — October and January.',
      'An end-of-year results flyer in December: real (anonymised) improvements, three lines, one QR.',
    ] },
  { icon: '📱', name: 'Social media', target: 5, why: 'Not a lead engine on its own, but it keeps CUBE visible to the parents referrals send our way.',
    actions: [
      'Two posts a week during term on Instagram and Facebook: a study tip, a result, a photo of the room. Batch-made monthly.',
      'Post holiday course dates and the free-trial link in the local parents\' Facebook groups where allowed, twice per break.',
      'One boosted post in mid-January ($150) aimed at parents within 5 km, pointing at the January courses.',
    ] },
]
const PLAN_PHASES = [
  { when: 'Now → 12 Oct', label: 'Set up', items: ['Fill the Year 6 intensive', 'Reports go out with referral cards + review link', 'Google profile tidied, review asks sent', 'Flyer designed, schools listed'] },
  { when: 'Term 4 · 13 Oct – 20 Dec', label: 'Referral term', items: ['Week 2: referral email', 'Late Oct: school newsletters + notice boards', 'Nov: Google Ads on, January courses on the website', 'Week 7–8: re-enrolment reminder with "second subject saves $100"', 'Dec: results flyer'] },
  { when: 'Summer · 21 Dec – 1 Feb', label: 'January courses', items: ['Year 7 Ready and HSC Kick-off run', 'Boosted post + parents\' groups', 'Every holiday student gets the term offer', 'Late Jan: school newsletters again'] },
  { when: 'Term 1 · Feb – 23 Mar', label: 'Convert', items: ['Week 1: term-start emails to every new family', 'Week 2: referral email', 'Weekly: call every open enquiry', 'Count on 23 March'] },
]

const monthsBetween = (a, b) => (new Date(b) - new Date(a)) / (30.44 * 86400000)

function GoalSection({ activeNow, joinedByMonth }) {
  const today = new Date().toISOString().slice(0, 10)
  const monthsLeft = Math.max(0, monthsBetween(today, GOAL.deadline))
  const monthsGone = Math.max(0.1, monthsBetween(GOAL.baselineDate, today))
  const needed = GOAL.target - GOAL.baseline + GOAL.year12Leaving   // new students the plan must bring in
  const gap = Math.max(0, GOAL.target - activeNow)
  const gained = activeNow - GOAL.baseline
  const paceNeeded = monthsLeft > 0 ? gap / monthsLeft : gap
  const recent = joinedByMonth.slice(-3)
  const paceNow = recent.length ? recent.reduce((a, m) => a + m.enrolled, 0) / recent.length : 0
  const pct = Math.min(100, Math.max(0, Math.round(((activeNow - GOAL.baseline) / (GOAL.target - GOAL.baseline)) * 100)))
  const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <section className="rounded-2xl border border-[#062E63] bg-[#062E63] text-white p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">Six-month goal</p>
          <h2 className="text-2xl font-bold mt-1">Double the students: {GOAL.baseline} → {GOAL.target} by {fmtDate(GOAL.deadline)}</h2>
          <p className="text-sm text-white/70 mt-1">Counted from {fmtDate(GOAL.baselineDate)}. With {GOAL.year12Leaving} Year 12s finishing in November, that means about <strong className="text-white">{needed} new students</strong> in six months — roughly <strong className="text-white">{Math.ceil(needed / 6)} a month</strong>, against about {paceNow ? paceNow.toFixed(1) : '5'} a month lately.</p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-bold tabular-nums">{activeNow}</p>
          <p className="text-[11px] text-white/60">active students now</p>
        </div>
      </div>
      <div className="mt-5">
        <div className="h-3 rounded-full bg-white/15 overflow-hidden">
          <div className="h-full bg-[#9db8e8] rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between text-[11px] text-white/70 mt-1.5 flex-wrap gap-2">
          <span>{gained >= 0 ? `+${gained}` : gained} since {fmtDate(GOAL.baselineDate)} · {pct}% of the way</span>
          <span>{gap} to go · {monthsLeft.toFixed(1)} months left · need {paceNeeded.toFixed(1)} new students a month from here</span>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-6">
        {PLAN_CHANNELS.map(c => (
          <div key={c.name} className="rounded-xl bg-white/10 border border-white/15 p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-bold">{c.icon} {c.name}</p>
              <p className="text-lg font-bold tabular-nums text-[#9db8e8]">+{c.target}</p>
            </div>
            <p className="text-[11px] text-white/60 mt-1 leading-snug">{c.why}</p>
            <ul className="mt-2.5 space-y-1.5">
              {c.actions.map((a, i) => <li key={i} className="text-[11px] leading-snug text-white/85 pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-[#9db8e8]">{a}</li>)}
            </ul>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-white/55 mt-3">Channel targets add to +{PLAN_CHANNELS.reduce((n, c) => n + c.target, 0)} new students, against the {needed} needed. Alongside them: keep every current family (re-enrolment reminder weeks 7–8) and lift subjects per student from 1.4 towards 1.7 with the multi-course discount — that doubles revenue faster than headcount alone.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
        {PLAN_PHASES.map((ph, i) => (
          <div key={ph.label} className="rounded-xl border border-white/15 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#9db8e8]">{i + 1} · {ph.when}</p>
            <p className="text-sm font-bold mt-0.5">{ph.label}</p>
            <ul className="mt-2 space-y-1">
              {ph.items.map(it => <li key={it} className="text-[11px] text-white/80 leading-snug">– {it}</li>)}
            </ul>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-white/55 mt-4">Weekly numbers to watch: enquiries (target 2–3 a week), enquiry → enrolment (keep above 70%), Google reviews (25 by January), referral credits issued.</p>
    </section>
  )
}

// ── Strategies by channel ─────────────────────────────────────────────────────
// Everything CUBE does (or might do) to bring families in, grouped by the kind
// of channel. Stored in portal_settings as JSON so directors can edit it here;
// the default is a starting point built from what the portal already runs.
const STRATEGIES_KEY = 'marketing_strategies'
const STATUSES = { active: { label: 'Active', cls: 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]' }, idea: { label: 'Idea', cls: 'bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]' }, paused: { label: 'Paused', cls: 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]' } }
const DEFAULT_STRATEGIES = [
  { id: 'emails', icon: '✉️', category: 'Emails', items: [
    { id: 'e1', title: 'Term Start + invoice', note: 'Week 1. One line about referral & sibling discounts.', status: 'active', href: '/tutor/emails/term-start' },
    { id: 'e2', title: 'Discount Program email', note: 'Week 2, once invoices are paid. Referral $50 each way, multi-course, siblings.', status: 'active', href: '/tutor/emails/discount-program' },
    { id: 'e3', title: 'Re-enrolment reminder', note: 'Weeks 7–8. "A second subject saves $100."', status: 'active', href: '/tutor/emails/term-start' },
    { id: 'e4', title: 'Reports with referral PS', note: 'Week 10 (and mid-term). Goodwill peak.', status: 'active', href: '/tutor/emails/end-of-term' },
    { id: 'e5', title: 'Course Offers to a cohort', note: 'e.g. Maths to English-only families, Chemistry to Year 10.', status: 'active', href: '/tutor/emails/course-offers' },
    { id: 'e6', title: 'Holiday Courses email', note: 'Week 8. Links to the sign-up form.', status: 'active', href: '/tutor/emails/holiday-courses' },
  ] },
  { id: 'referral', icon: '🎁', category: 'Referrals & word of mouth', items: [
    { id: 'r1', title: '$50 / $50 referral credit', note: 'Both families credited once the new student is fully enrolled.', status: 'active', href: '/tutor/trials' },
    { id: 'r2', title: 'Sibling discount', note: '$50 off per sibling enrolled together.', status: 'active' },
    { id: 'r3', title: 'Ask happy families for a Google review', note: 'Right after end-of-term reports.', status: 'idea' },
  ] },
  { id: 'physical', icon: '📍', category: 'Physical promotions', items: [
    { id: 'p1', title: 'Flyers / letterbox drop near local schools', note: 'Term 4 and January, before enrolments settle.', status: 'idea' },
    { id: 'p2', title: 'School newsletter listing', note: 'Ask local primary schools to list holiday courses.', status: 'idea' },
    { id: 'p3', title: 'Holiday course open morning', note: 'Free taster session in the break.', status: 'idea' },
  ] },
  { id: 'social', icon: '📱', category: 'Social media', items: [
    { id: 's1', title: 'Instagram / Facebook posts', note: 'Results, study tips, holiday course dates. Weekly during term.', status: 'idea' },
    { id: 's2', title: 'Local parents Facebook groups', note: 'Post holiday courses and free trials where allowed.', status: 'idea' },
  ] },
  { id: 'web', icon: '🌐', category: 'Website & search', items: [
    { id: 'w1', title: 'Free-trial form', note: 'Submissions land in Trials with the "how did you hear" channel.', status: 'active', href: 'https://www.cubetuition.com.au/free-trial', external: true },
    { id: 'w2', title: 'Google Business profile', note: 'Hours, photos, reviews. Feeds "Google Search" enquiries.', status: 'active' },
    { id: 'w3', title: 'Google Ads for "tutoring near me"', note: 'Small budget test in January.', status: 'idea' },
  ] },
  { id: 'partners', icon: '🤝', category: 'Partnerships', items: [
    { id: 'k1', title: 'School careers / wellbeing staff', note: 'Introduce CUBE for students needing support.', status: 'idea' },
    { id: 'k2', title: 'Community centres and libraries', note: 'Notice boards, holiday programme listings.', status: 'idea' },
  ] },
]
const uid = () => Math.random().toString(36).slice(2, 8)

function StrategiesSection() {
  const [cats, setCats] = useState(null)
  const [status, setStatus] = useState('')   // '' | 'saving' | 'saved' | 'failed'
  const [editingItem, setEditingItem] = useState(null)   // { catId, item } while a row's fields are open
  const timer = useRef(null)
  const latest = useRef(null)
  useEffect(() => {
    supabase.from('portal_settings').select('value').eq('key', STRATEGIES_KEY).maybeSingle().then(({ data }) => {
      let parsed = DEFAULT_STRATEGIES
      try { if (data?.value) parsed = JSON.parse(data.value) } catch { /* fall back to the default list */ }
      if (!Array.isArray(parsed)) parsed = DEFAULT_STRATEGIES
      latest.current = parsed; setCats(parsed)
    })
    return () => clearTimeout(timer.current)
  }, [])
  // Every edit saves itself a moment later — there is no button to miss.
  const persist = async () => {
    const value = latest.current
    if (!value) return
    setStatus('saving')
    const { error } = await supabase.from('portal_settings').upsert({ key: STRATEGIES_KEY, value: JSON.stringify(value), updated_at: new Date().toISOString() })
    if (error) { setStatus('failed'); timer.current = setTimeout(persist, 4000); return }
    setStatus('saved')
  }
  const update = (fn) => {
    setCats(prev => { const next = fn(prev); latest.current = next; return next })
    setStatus('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(persist, 600)
  }
  const setItem = (catId, itemId, patch) => update(prev => prev.map(c => c.id !== catId ? c : { ...c, items: c.items.map(i => i.id === itemId ? { ...i, ...patch } : i) }))
  const removeItem = (catId, itemId) => update(prev => prev.map(c => c.id !== catId ? c : { ...c, items: c.items.filter(i => i.id !== itemId) }))
  const addItem = (catId) => { const item = { id: uid(), title: '', note: '', status: 'idea' }; update(prev => prev.map(c => c.id !== catId ? c : { ...c, items: [...c.items, item] })); setEditingItem({ catId, itemId: item.id }) }
  const addCategory = () => { const name = prompt('Name of the new category (e.g. Events)'); if (!name?.trim()) return; update(prev => [...prev, { id: uid(), icon: '📌', category: name.trim(), items: [] }]) }
  const renameCategory = (c) => { const name = prompt('Category name', c.category); if (!name?.trim()) return; const icon = prompt('Emoji for it', c.icon || '📌') || c.icon; update(prev => prev.map(x => x.id === c.id ? { ...x, category: name.trim(), icon } : x)) }
  const removeCategory = (c) => { if (!confirm(`Remove "${c.category}" and its ${c.items.length} item${c.items.length === 1 ? '' : 's'}?`)) return; update(prev => prev.filter(x => x.id !== c.id)) }
  const cycleStatus = (catId, item) => { const order = ['idea', 'active', 'paused']; setItem(catId, item.id, { status: order[(order.indexOf(item.status || 'idea') + 1) % order.length] }) }

  if (!cats) return null
  const totals = cats.flatMap(c => c.items).reduce((m, i) => ({ ...m, [i.status || 'idea']: (m[i.status || 'idea'] || 0) + 1 }), {})
  return (
    <section className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <p className="text-xs font-bold text-[#062E63]">🗂 Strategies by channel</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#2A2035]/45">{totals.active || 0} active · {totals.idea || 0} ideas · {totals.paused || 0} paused</span>
          <button onClick={addCategory} className="text-[11px] font-semibold text-[#325099] hover:underline">+ Category</button>
          {status && (
            <span className={`text-[10px] font-semibold ${status === 'failed' ? 'text-[#B23A3A]' : status === 'saving' ? 'text-[#2A2035]/40' : 'text-[#047857]'}`}>
              {status === 'failed' ? 'Not saved — retrying…' : status === 'saving' ? 'Saving…' : 'Saved ✓'}
            </span>
          )}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cats.map(c => (
          <div key={c.id} className="rounded-xl border border-[#DEE7FF] bg-[#F8FAFF] flex flex-col">
            <div className="px-3.5 pt-3 pb-2 border-b border-[#E4EAFB] flex items-center gap-2">
              <span className="text-lg leading-none">{c.icon}</span>
              <button onClick={() => renameCategory(c)} className="text-xs font-bold text-[#062E63] hover:underline text-left flex-1 truncate" title="Rename">{c.category}</button>
              <span className="text-[10px] text-[#2A2035]/40">{c.items.filter(i => i.status === 'active').length}/{c.items.length}</span>
              <button onClick={() => removeCategory(c)} title="Remove category" className="text-[11px] text-[#2A2035]/25 hover:text-[#DC2626]">✕</button>
            </div>
            <ul className="p-2 space-y-1.5 flex-1">
              {c.items.map(i => {
                const st = STATUSES[i.status] || STATUSES.idea
                const open = editingItem?.catId === c.id && editingItem?.itemId === i.id
                return (
                  <li key={i.id} className="rounded-lg border border-[#EEF2FB] bg-white px-2.5 py-2">
                    {open ? (
                      <div className="space-y-1.5">
                        <input autoFocus value={i.title} onChange={e => setItem(c.id, i.id, { title: e.target.value })} placeholder="Strategy" className="w-full border border-[#DEE7FF] rounded-lg px-2 py-1 text-xs font-semibold" />
                        <input value={i.note || ''} onChange={e => setItem(c.id, i.id, { note: e.target.value })} placeholder="When / how / notes" className="w-full border border-[#DEE7FF] rounded-lg px-2 py-1 text-[11px]" />
                        <input value={i.href || ''} onChange={e => setItem(c.id, i.id, { href: e.target.value, external: /^https?:/i.test(e.target.value) })} placeholder="Link (portal path or https://…)" className="w-full border border-[#DEE7FF] rounded-lg px-2 py-1 text-[11px]" />
                        <div className="flex items-center gap-2">
                          <button onClick={() => setEditingItem(null)} className="text-[11px] font-semibold text-[#325099]">Done</button>
                          <button onClick={() => { removeItem(c.id, i.id); setEditingItem(null) }} className="text-[11px] text-[#DC2626] ml-auto">Delete</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1">
                          <button onClick={() => setEditingItem({ catId: c.id, itemId: i.id })} className="block text-left text-xs font-semibold text-[#2A2035] hover:text-[#325099] truncate w-full" title="Edit">{i.title || <span className="italic text-[#2A2035]/40">Untitled</span>}</button>
                          {i.note && <span className="block text-[10px] text-[#2A2035]/50 leading-snug">{i.note}</span>}
                          {i.href && (i.external
                            ? <a href={i.href} target="_blank" rel="noreferrer" className="text-[10px] text-[#325099] hover:underline">↗ open</a>
                            : <Link href={i.href} className="text-[10px] text-[#325099] hover:underline">open →</Link>)}
                        </span>
                        <button onClick={() => cycleStatus(c.id, i)} title="Click to change status" className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${st.cls}`}>{st.label}</button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            <button onClick={() => addItem(c.id)} className="text-[11px] font-semibold text-[#325099] hover:underline px-3.5 pb-3 text-left">+ Add strategy</button>
          </div>
        ))}
      </div>
    </section>
  )
}

const fmtPct = (a, b) => b > 0 ? `${Math.round((a / b) * 100)}%` : '—'

export default function MarketingPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [trials, setTrials] = useState([])
  const [credits, setCredits] = useState([])
  const [activeNow, setActiveNow] = useState(GOAL.baseline)

  const load = useCallback(async () => {
    const [{ data: tr }, { data: cr }, { count: act }] = await Promise.all([
      supabase.from('trial_submissions').select('id, submitted_at, status, contacted_at, trial_date, converted_student_id, how_heard, referred_by, source'),
      supabase.from('student_credits').select('student_id, amount, reason, created_at'),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    ])
    setTrials(tr || []); setCredits(cr || [])
    if (typeof act === 'number') setActiveNow(act)
    setLoading(false)
  }, [])

  useEffect(() => {
    (async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile); await load()
    })()
  }, [router, load])

  // ── Funnel numbers — every enquiry ever recorded ────────────────────────────
  const inScope = trials
  const funnel = useMemo(() => {
    const enquired  = inScope.length
    const contacted = inScope.filter(t => t.contacted_at || ['contacted', 'trial_scheduled', 'enrolled', 'declined'].includes(t.status)).length
    const trialled  = inScope.filter(t => t.trial_date || ['trial_scheduled', 'enrolled'].includes(t.status)).length
    const enrolled  = inScope.filter(t => t.status === 'enrolled' || t.converted_student_id).length
    const referred  = inScope.filter(t => t.referred_by || /referr/i.test(t.how_heard || '')).length
    return { enquired, contacted, trialled, enrolled, referred }
  }, [inScope])

  // Students who enrolled, by month of enquiry — the recent pace.
  const joinedByMonth = useMemo(() => {
    const m = {}
    for (const t of trials) {
      if (!t.submitted_at || !(t.status === 'enrolled' || t.converted_student_id)) continue
      const k = t.submitted_at.slice(0, 7); m[k] = (m[k] || 0) + 1
    }
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([month, enrolled]) => ({ month, enrolled }))
  }, [trials])

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

  if (!profile || loading) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const maxChan = Math.max(1, ...channels.map(c => c.n))

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />
      <div className="max-w-6xl mx-auto px-6 pt-10 pb-16 space-y-6">
        <div className="rounded-2xl px-7 py-6 border bg-[#EEF3FF] border-[#DEE7FF]">
          <div className="flex items-center gap-3">
            <span className="text-3xl">📣</span>
            <div>
              <h1 className="text-2xl font-bold text-[#062E63]">Marketing</h1>
              <p className="text-xs text-[#2A2035]/55 mt-0.5">How CUBE reaches families, and where enquiries actually come from.</p>
            </div>
          </div>
        </div>

        <GoalSection activeNow={activeNow} joinedByMonth={joinedByMonth} />

        <StrategiesSection />

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


      </div>
    </div>
  )
}
