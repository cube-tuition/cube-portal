'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchAllTerms, getCurrentTerm, formatTermLabel } from '../../lib/terms'
import { classesForTerm } from '../../lib/classes'
import { classMetricsFor, cashStudentIdsFrom } from '../../lib/termFinance'
import { yearBandFromClassName, LESSONS_PER_TERM } from '../../lib/teacherCost'
import { fmtTimeRange } from '../../lib/format'

/*
 * Tutors — the card view of the Tutors table in the database explorer, laid
 * out like the guardians' Families view: a searchable list on the left, the
 * selected tutor on the right.
 *
 * For the chosen term it shows what each tutor teaches, how many students are
 * in each class, and what each class pays them. Pay is worked out exactly as
 * the accounting Forecast does it (lib/termFinance classMetricsFor): weekly
 * hours × their rate for the class's year band and mode (class or 1:1) ×
 * LESSONS_PER_TERM, plus super for tutors paid by bank. A class is matched to
 * its teacher by the class's teacher name, the same way. Directors who teach
 * are listed too, tagged.
 */

const DAY_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' }
const BAND_LABEL = { '1-6': 'Y1–6', '7-8': 'Y7–8', '9-10': 'Y9–10', '11-12': 'Y11–12', other: 'Other' }
const money = (v) => `$${Math.round(Number(v) || 0).toLocaleString('en-AU')}`
const money2 = (v) => `$${(Number(v) || 0).toFixed(2)}`
/** "2.5 yrs" / "8 mo" since a start date; '' when none. */
const tenure = (iso) => {
  if (!iso) return ''
  const start = new Date(iso), now = new Date()
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) - (now.getDate() < start.getDate() ? 1 : 0)
  if (months < 0) return 'starts soon'
  if (months < 12) return `${months} mo`
  const yrs = Math.floor(months / 6) / 2   // half-year steps: 1, 1.5, 2 …
  return `${yrs} yr${yrs === 1 ? '' : 's'}`
}
const sinceLabel = (iso) => iso ? new Date(iso).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' }) : ''

export default function TutorsView({ statusTab = 'active' }) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [terms, setTerms] = useState([])
  const [termId, setTermId] = useState('')
  const [staff, setStaff] = useState([])          // tutors + directors, with staff_table
  const [rateMatrix, setRateMatrix] = useState([])
  const [courseModes, setCourseModes] = useState({})
  const [termData, setTermData] = useState({ classes: [], invoices: [] })
  const [termLoading, setTermLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  // Staff, rates and course modes — once.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [t, d, r, c, allTerms] = await Promise.all([
          supabase.from('tutors').select('id, full_name, email, phone, university, pay_method, active, tutor_code, system, started_on'),
          supabase.from('directors').select('id, full_name, email, phone, pay_method, started_on'),
          supabase.from('current_tutor_rates').select('tutor_id, year_band, mode, hourly_rate'),
          supabase.from('courses').select('id, delivery_mode'),
          fetchAllTerms(),
        ])
        for (const x of [t, d, r, c]) if (x.error) throw new Error(x.error.message)
        if (!alive) return
        setStaff([
          // Review / test logins (tutors.system) are not real staff.
          ...(t.data || []).filter(x => !x.system).map(x => ({ ...x, staff_table: 'tutors' })),
          ...(d.data || []).map(x => ({ ...x, active: true, staff_table: 'directors' })),
        ].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')))
        setRateMatrix(r.data || [])
        setCourseModes(Object.fromEntries((c.data || []).map(x => [x.id, x.delivery_mode])))
        const ordered = [...(allTerms || [])].sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''))
        setTerms(ordered)
        setTermId(getCurrentTerm(allTerms || [])?.id || ordered[0]?.id || '')
      } catch (e) { if (alive) setErr(e.message || 'Failed to load tutors.') }
      finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [])

  // The chosen term's classes (with enrolments) and invoices (for cash share).
  useEffect(() => {
    if (!termId) return
    let alive = true
    ;(async () => {
      setTermLoading(true)
      const [{ data: cls, error: e1 }, { data: inv, error: e2 }] = await Promise.all([
        classesForTerm(termId, `id, class_name, course_id, teacher, day_of_week, start_time, end_time, room,
            courses(course_price), enrolments(id, student_id, price, status, students(full_name))`)
          .or('status.eq.active,status.is.null'),
        supabase.from('invoices').select('payment_method, student_id, line_items').eq('term_id', termId).neq('status', 'voided'),
      ])
      if (!alive) return
      if (e1 || e2) setErr((e1 || e2).message)
      setTermData({ classes: cls || [], invoices: inv || [] })
      setTermLoading(false)
    })()
    return () => { alive = false }
  }, [termId])

  const metrics = useMemo(() => classMetricsFor(termData.classes, {
    tutors: staff, rateMatrix, courseModes, cashStudentIds: cashStudentIdsFrom(termData.invoices),
  }), [termData, staff, rateMatrix, courseModes])

  // Classes per staff member, plus the ones whose teacher name matched nobody.
  const { byTutor, unmatched } = useMemo(() => {
    const m = {}, un = []
    for (const c of metrics) {
      if (c.tutorId) (m[c.tutorId] ||= []).push(c)
      else un.push(c)
    }
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.class_name || '').localeCompare(b.class_name || '', undefined, { numeric: true }))
    return { byTutor: m, unmatched: un }
  }, [metrics])

  const totalsFor = (id) => {
    const cls = byTutor[id] || []
    return {
      classes: cls.length,
      students: cls.reduce((s, c) => s + c.studentCount, 0),
      trials: cls.reduce((s, c) => s + (c.trialCount || 0), 0),
      pay: cls.reduce((s, c) => s + c.termlyTeacherFee, 0),
      superAmt: cls.reduce((s, c) => s + c.superAmount, 0),
      income: cls.reduce((s, c) => s + c.termIncome, 0),
      profit: cls.reduce((s, c) => s + c.termProfit, 0),
      hours: cls.reduce((s, c) => s + c.lessonHrs, 0),
      missingRate: cls.filter(c => !c.teacherRate).length,
    }
  }

  if (loading) return <div className="flex items-center justify-center h-full"><p className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase">Loading…</p></div>
  if (err && !staff.length) return <div className="flex items-center justify-center h-full"><p className="text-xs text-rose-600">{err}</p></div>

  const q = search.trim().toLowerCase()
  const shown = staff
    .filter(s => s.staff_table === 'directors'
      ? (byTutor[s.id]?.length > 0 && statusTab !== 'inactive')    // directors only when they teach
      : statusTab === 'all' || (statusTab === 'inactive' ? s.active === false : s.active !== false))
    .filter(s => !q || [s.full_name, s.email, s.tutor_code, ...(byTutor[s.id] || []).map(c => c.class_name)]
      .some(v => (v || '').toLowerCase().includes(q)))
  const sel = shown.find(s => s.id === selectedId) || null
  const selClasses = sel ? (byTutor[sel.id] || []) : []
  const selTotals = sel ? totalsFor(sel.id) : null
  const selRates = sel ? rateMatrix.filter(r => r.tutor_id === sel.id) : []
  const setStartedOn = async (person, value) => {
    setStaff(list => list.map(x => (x.id === person.id ? { ...x, started_on: value } : x)))
    const { error } = await supabase.from(person.staff_table).update({ started_on: value }).eq('id', person.id)
    if (error) alert(`Could not save start date: ${error.message}`)
  }
  const bands = ['1-6', '7-8', '9-10', '11-12', 'other']

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-3 md:px-5 py-3 border-b border-[#DEE7FF] bg-[#F8FAFF] shrink-0">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#325099]/50 text-sm">🔍</span>
          <input type="text" placeholder="Search by tutor, email or class…" value={search} onChange={e => { setSearch(e.target.value); setSelectedId(null) }}
            className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-[#DEE7FF] bg-white text-[#2A2035] placeholder-[#2A2035]/40 focus:outline-none focus:border-[#BACBFF] transition" />
        </div>
        <select value={termId} onChange={e => setTermId(e.target.value)}
          className="px-3 py-2 text-xs rounded-xl border border-[#DEE7FF] bg-white text-[#2A2035] focus:outline-none focus:border-[#BACBFF]">
          {terms.map(t => <option key={t.id} value={t.id}>{formatTermLabel(t)}</option>)}
        </select>
        <span className="text-[10px] text-[#325099]/50 font-semibold shrink-0">{shown.length} {q ? 'found' : 'tutors'}{termLoading ? ' · loading…' : ''}</span>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2 max-md:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-0 divide-x max-md:divide-x-0 max-md:divide-y divide-[#DEE7FF]">
        {/* Tutor list */}
        <div className="overflow-y-auto p-3 md:p-4 space-y-2">
          {shown.map(s => {
            const t = totalsFor(s.id)
            return (
              <button key={s.id} onClick={() => setSelectedId(s.id)}
                className={`w-full text-left bg-white rounded-xl border px-4 py-3 transition shadow-sm hover:shadow-md ${selectedId === s.id ? 'border-[#325099] ring-1 ring-[#BACBFF]' : 'border-[#E8EDF8]'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-[#2A2035] truncate min-w-0">{s.full_name}</span>
                  {s.staff_table === 'directors' && <span className="text-[9px] font-semibold bg-[#EDE9FE] text-[#5B21B6] px-1.5 py-0.5 rounded-full shrink-0">Director</span>}
                  {s.active === false && <span className="text-[9px] font-semibold bg-gray-100 text-gray-500 border border-gray-200 px-1.5 py-0.5 rounded-full shrink-0">inactive</span>}
                  {s.pay_method === 'cash' && <span className="text-[9px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded-full shrink-0">💵 cash</span>}
                  {s.started_on && <span className="ml-auto text-[10px] font-semibold text-[#2A2035]/50 shrink-0" title={`With CUBE since ${sinceLabel(s.started_on)}`}>{tenure(s.started_on)} with CUBE</span>}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {t.classes === 0 ? (
                    <span className="text-[10px] text-[#2A2035]/40 italic">No classes this term</span>
                  ) : (byTutor[s.id] || []).map(c => (
                    <span key={c.id} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F4F7FF] text-[#325099] border border-[#E2E9FB]">
                      {c.class_name} · {c.studentCount}{c.trialCount ? `+${c.trialCount}` : ''}
                    </span>
                  ))}
                </div>
              </button>
            )
          })}
          {shown.length === 0 && <p className="text-xs text-[#2A2035]/40 text-center py-10">{q ? <>No tutors match &ldquo;{search}&rdquo;</> : 'No tutors here.'}</p>}
          {unmatched.length > 0 && !q && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-900">
              <p className="font-semibold mb-1">{unmatched.length} class{unmatched.length === 1 ? '' : 'es'} with no matching tutor</p>
              <p className="text-amber-900/70">{unmatched.map(c => `${c.class_name}${c.teacher ? ` (“${c.teacher}”)` : ' (no teacher)'}`).join(' · ')}</p>
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="overflow-y-auto p-4 md:p-5 bg-[#FBFCFF]">
          {!sel ? (
            <div className="flex items-center justify-center h-full text-xs text-[#2A2035]/35">Select a tutor to see their classes and pay</div>
          ) : (
            <div className="space-y-5">
              {/* Contact */}
              <section>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099] font-semibold mb-2">{sel.staff_table === 'directors' ? 'Director' : 'Tutor'}</p>
                <div className="bg-white rounded-xl border border-[#E8EDF8] px-4 py-3">
                  <p className="text-sm font-bold text-[#2A2035]">{sel.full_name}
                    
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] break-all">
                    {sel.email && <a href={`mailto:${sel.email}`} className="text-[#325099] hover:underline">✉ {sel.email}</a>}
                    {sel.phone && <a href={`tel:${sel.phone}`} className="text-[#325099] hover:underline">☎ {sel.phone}</a>}
                    {sel.university && <span className="text-[#2A2035]/55">🎓 {sel.university}</span>}
                    <span className="text-[#2A2035]/55">{sel.pay_method === 'cash' ? '💵 Paid in cash (no super)' : '🏦 Paid by bank (+ super)'}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-[#2A2035]/55">
                    <span>📅 {sel.started_on ? <>With CUBE since <span className="font-semibold text-[#2A2035]">{sinceLabel(sel.started_on)}</span> · {tenure(sel.started_on)}</> : <span className="italic">Start date not recorded</span>}</span>
                    <input type="date" value={sel.started_on || ''} onChange={e => setStartedOn(sel, e.target.value || null)}
                      className="ml-auto border border-[#DEE7FF] rounded-lg px-2 py-0.5 text-[11px] text-[#2A2035] focus:outline-none focus:border-[#325099]" title="Set their first day with CUBE" />
                  </div>
                </div>
              </section>

              {/* Term summary */}
              <section>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099] font-semibold mb-2">{formatTermLabel(terms.find(t => t.id === termId))}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    ['Classes', selTotals.classes],
                    ['Students', `${selTotals.students}${selTotals.trials ? ` +${selTotals.trials} trial` : ''}`],
                    ['Hours / week', selTotals.hours.toFixed(1)],
                    ['Term income', money(selTotals.income)],
                    ['Term pay', money(selTotals.pay + selTotals.superAmt)],
                    ['Term profit', money(selTotals.profit), selTotals.profit < 0 ? 'text-rose-700' : 'text-emerald-700'],
                  ].map(([label, value, cls]) => (
                    <div key={label} className="bg-white rounded-xl border border-[#E8EDF8] px-3 py-2.5">
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-[#325099]/60">{label}</p>
                      <p className={`text-base font-bold tabular-nums ${cls || 'text-[#062E63]'}`}>{value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-[#2A2035]/45 mt-1.5">
                  Profit = what their classes bring in ({money(selTotals.income)}) − {money(selTotals.pay)} pay{selTotals.superAmt > 0 ? ` − ${money(selTotals.superAmt)} super` : ''} · {LESSONS_PER_TERM} lessons a term
                  {selTotals.income > 0 ? ` · ${Math.round(selTotals.profit / selTotals.income * 100)}% margin` : ''}
                </p>
                {selTotals.missingRate > 0 && (
                  <p className="text-[11px] font-semibold text-amber-700 mt-1.5">⚠ {selTotals.missingRate} class{selTotals.missingRate === 1 ? ' has' : 'es have'} no pay rate on file — their pay shows as $0. Add it in <a href="/tutor/payroll/rates" className="underline">Payroll → Rates</a>.</p>
                )}
              </section>

              {/* Classes */}
              <section>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099] font-semibold mb-2">Classes, pay &amp; profit</p>
                {selClasses.length === 0 ? (
                  <p className="text-[11px] text-[#2A2035]/40 italic">Not teaching a class this term.</p>
                ) : (
                  <div className="space-y-1.5">
                    {selClasses.map(c => (
                      <div key={c.id} className="bg-white rounded-xl border border-[#E8EDF8] px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#2A2035] flex-1 min-w-0 truncate">{c.class_name}</span>
                          {c.is1on1 && <span className="text-[9px] font-semibold bg-[#EDE9FE] text-[#5B21B6] px-1.5 py-0.5 rounded-full shrink-0">1:1</span>}
                          <span className={`text-xs font-bold tabular-nums shrink-0 ${c.termProfit < 0 ? 'text-rose-700' : 'text-emerald-700'}`} title="Term profit on this class">{c.teacherRate ? money(c.termProfit) : '—'}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-[#2A2035]/55 tabular-nums">
                          <span>Income {money(c.termIncome)}</span>
                          <span>Pay {c.teacherRate ? money(c.totalTeacherCost) : '—'}{c.superAmount ? ' incl. super' : ''}</span>
                          {c.teacherRate && c.termIncome > 0 && <span>{Math.round(c.termProfit / c.termIncome * 100)}% margin</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#2A2035]/55">
                          <span>{[DAY_SHORT[c.day_of_week] || c.day_of_week, fmtTimeRange(c.start_time, c.end_time)].filter(Boolean).join(' ')}{c.room ? ` · ${c.room}` : ''}</span>
                          <span>
                            {c.is1on1
                              ? (c.studentName || (c.studentCount ? `${c.studentCount} student${c.studentCount === 1 ? '' : 's'}` : 'no student yet'))
                              : `${c.studentCount} student${c.studentCount === 1 ? '' : 's'}`}
                            {c.trialCount ? ` + ${c.trialCount} trial${c.trialCount === 1 ? '' : 's'}` : ''}
                          </span>
                          <span>{c.lessonHrs.toFixed(1)} h/wk</span>
                          {c.teacherRate
                            ? <span>{money2(c.teacherRate)}/h ({BAND_LABEL[yearBandFromClassName(c.class_name)]}, {c.is1on1 ? '1:1' : 'class'}) = {money2(c.weeklyTeacherFee)}/wk{c.superAmount ? ` + super` : ''}</span>
                            : <span className="text-amber-700 font-semibold">no rate for {BAND_LABEL[yearBandFromClassName(c.class_name)]} {c.is1on1 ? '1:1' : 'class'}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Rates */}
              <section>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099] font-semibold mb-2">Hourly rates</p>
                {selRates.length === 0 ? (
                  <p className="text-[11px] text-[#2A2035]/40 italic">No rates on file.</p>
                ) : (
                  <div className="bg-white rounded-xl border border-[#E8EDF8] overflow-hidden">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-[#F8FAFF] text-[9px] uppercase tracking-wide text-[#325099]/60">
                          <th className="text-left font-semibold px-3 py-1.5">Years</th>
                          <th className="text-right font-semibold px-3 py-1.5">Class</th>
                          <th className="text-right font-semibold px-3 py-1.5">1:1</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F0F4FF]">
                        {bands.filter(b => selRates.some(r => r.year_band === b)).map(b => {
                          const rate = (mode) => selRates.find(r => r.year_band === b && r.mode === mode)?.hourly_rate
                          return (
                            <tr key={b}>
                              <td className="px-3 py-1.5 font-semibold text-[#2A2035]">{BAND_LABEL[b]}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{rate('class') != null ? money2(rate('class')) : '—'}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{rate('tutor') != null ? money2(rate('tutor')) : '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
