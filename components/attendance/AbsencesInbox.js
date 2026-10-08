'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { authedFetch } from '../../lib/authedFetch'
import { fetchAllTerms, getCurrentTerm, getRunningTerm } from '../../lib/terms'
import { enrolledClassesForTerm } from '../../lib/classes'
import { fmtTime, fmtTimeRange, isoDate } from '../../lib/format'
import { isOneToOneClass, CLASS_CAPACITY } from '../../lib/classFormat'
import { bookGuestMakeup, bookOneToOneMakeup, cancelMakeup } from '../../lib/makeups'
import SearchSelectPopover from '../SearchSelectPopover'
import { buildAbsenceEmailHtml, defaultAbsenceContent, fillAbsenceVars } from '../../lib/absenceEmail'

/*
 * Absences — the working inbox on /tutor/admin/monitoring/attendance/absences,
 * a subpage of Attendance.
 *
 * One case per student × missed session (absence_cases). Cases open
 * themselves when a tutor marks a student absent, and the database keeps them
 * in step with what happens next (migrations/20261006_absence_cases.sql): a
 * makeup booked here or from the lessons sidebar moves a case to "Makeup
 * booked"; the student turning up to it closes the case; missing it reopens
 * it; a credit or cancellation closes it. What is left for a person is the
 * follow-up in between — who was contacted, what they said — which the notes
 * log keeps, stamped with who and when.
 */

const STAGES = [
  { id: 'new',       label: 'Needs action',   hint: 'Absent — nobody has followed up yet.' },
  { id: 'contacted', label: 'Awaiting reply', hint: 'The family has been contacted.' },
  { id: 'booked',    label: 'Makeup booked',  hint: 'Closes itself once the student attends the makeup.' },
  { id: 'closed',    label: 'Closed',         hint: 'The most recent 200 closed cases.' },
]
const STAGE_CHIP = {
  new:       'bg-[#FEE2E2] text-[#B91C1C]',
  contacted: 'bg-[#FEF3C7] text-[#92400E]',
  booked:    'bg-[#DBEAFE] text-[#1E40AF]',
  closed:    'bg-[#E5E7EB] text-[#374151]',
}
const OUTCOMES = {
  makeup:    { label: 'Made up',              cls: 'bg-[#D1FAE5] text-[#065F46]' },
  credited:  { label: 'Credited',             cls: 'bg-[#EDE9FE] text-[#5B21B6]' },
  no_makeup: { label: 'No makeup',            cls: 'bg-[#E5E7EB] text-[#374151]' },
  carried:   { label: 'Carried to next term', cls: 'bg-[#FEF3C7] text-[#92400E]' },
}
// What a person can close a case as by hand. Credits go through the credit
// form (it changes the invoice), so they are not offered here.
const MANUAL_CLOSE = [
  { id: 'makeup',    label: 'Made up some other way' },
  { id: 'no_makeup', label: 'No makeup needed / declined' },
  { id: 'carried',   label: 'Carried to next term' },
]
const NOTE_ICON = { note: '📝', contact: '📞', stage: '➜', system: '⚙️', email: '✉️' }
const DAY_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' }

const fmtDay = (d) => {
  if (!d) return ''
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) }
  catch { return String(d) }
}
const fmtStamp = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
// A class time as an <input type="time"> value ("17:00"), or '' if unreadable.
const toTimeInput = (t) => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}
const daysSince = (dateIso) => Math.max(0, Math.round((new Date(isoDate(new Date()) + 'T00:00:00') - new Date(dateIso + 'T00:00:00')) / 86400000))
const classLabel = (c) => !c ? 'Unknown class'
  : [c.class_name, [DAY_SHORT[c.day_of_week] || c.day_of_week, fmtTime(c.start_time)].filter(Boolean).join(' ')].filter(Boolean).join(' · ')

async function chunkedIn(table, cols, col, ids, size = 100) {
  const out = []
  for (let i = 0; i < ids.length; i += size) {
    const { data, error } = await supabase.from(table).select(cols).in(col, ids.slice(i, i + size))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

const fmtDayLong = (d) => {
  if (!d) return ''
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }) }
  catch { return String(d) }
}
// One line describing a session, for the picker and the family's email.
const sessionLine = (lesson, cls) => [
  fmtDayLong(lesson.lesson_date),
  cls?.class_name,
  fmtTimeRange(lesson.start_time || cls?.start_time, lesson.end_time || cls?.end_time),
  lesson.room || cls?.room,
].filter(Boolean).join(' · ')

/*
 * Sessions a student could make an absence up in: any session of the same
 * course from today to the end of the absence's term (any time in the term);
 * once that term has finished, the next teaching term's. 1:1 classes are left
 * out — a makeup is never a seat in someone else's 1:1.
 *
 * Each session carries its seat count as it will stand on the day: the class's
 * enrolments, plus makeup guests already booked into that session, less the
 * students already known to be away from it. Full = CLASS_CAPACITY taken.
 */
async function loadMakeupSessions(c, cls) {
  const today = isoDate(new Date())
  const terms = await fetchAllTerms()
  const own = terms.find(t => c.session_date >= t.start_date && c.session_date <= t.end_date)
  let to = own?.end_date
  let note = ''
  if (!to || to < today) {
    const next = terms.filter(t => t.end_date >= today && !/holiday/i.test(t.name || ''))
      .sort((a, b) => a.start_date.localeCompare(b.start_date))[0]
    to = next?.end_date || today
    note = own ? `${own.name} has finished — showing ${next?.name || 'upcoming'} sessions.` : ''
  }
  if (!cls?.course_id) return { list: [], note }
  const [{ data: sib }, { data: courses }, { data: mine }] = await Promise.all([
    supabase.from('classes').select('id, class_name, day_of_week, start_time, end_time, room, term_id, course_id').eq('course_id', cls.course_id),
    supabase.from('courses').select('id, delivery_mode'),
    supabase.from('enrolments').select('class_id').eq('student_id', c.student_id).in('status', ['active', 'trial']),
  ])
  const modes = Object.fromEntries((courses || []).map(x => [x.id, x.delivery_mode]))
  const groups = (sib || []).filter(x => !isOneToOneClass(x, modes))
  const ids = groups.map(x => x.id)
  if (!ids.length) return { list: [], note }
  const [{ data: lessons }, { data: enr }, { data: guests }, { data: away }] = await Promise.all([
    supabase.from('lessons').select('id, class_id, lesson_date, start_time, end_time, room, week, status')
      .in('class_id', ids).gte('lesson_date', today).lte('lesson_date', to)
      .eq('is_makeup', false).neq('status', 'cancelled').order('lesson_date').order('start_time'),
    supabase.from('enrolments').select('class_id').in('class_id', ids).in('status', ['active', 'trial']),
    supabase.from('lessons').select('class_id, lesson_date').in('class_id', ids).eq('is_makeup', true)
      .not('makeup_student_id', 'is', null).gte('lesson_date', today).lte('lesson_date', to),
    supabase.from('absence_cases').select('class_id, session_date').in('class_id', ids)
      .gte('session_date', today).lte('session_date', to),
  ])
  const ownClasses = new Set((mine || []).map(e => e.class_id))
  const tally = (rows, key) => { const m = {}; for (const r of rows || []) { const k = key(r); m[k] = (m[k] || 0) + 1 } return m }
  const enrolled = tally(enr, r => r.class_id)
  const guestAt = tally(guests, r => `${r.class_id}|${r.lesson_date}`)
  const awayAt = tally(away, r => `${r.class_id}|${r.session_date}`)
  const byId = Object.fromEntries(groups.map(x => [x.id, x]))
  const list = (lessons || [])
    .filter(l => !ownClasses.has(l.class_id))   // their own class would double-book them
    .map(l => {
      const k = `${l.class_id}|${l.lesson_date}`
      const taken = (enrolled[l.class_id] || 0) + (guestAt[k] || 0) - (awayAt[k] || 0)
      return { lesson: l, cls: byId[l.class_id], taken, away: awayAt[k] || 0, guests: guestAt[k] || 0, full: taken >= CLASS_CAPACITY }
    })
  return { list, note }
}

export default function AbsencesInbox({ staff }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState({ cases: [], students: {}, classes: {}, makeups: {}, notes: {}, guardians: {} })
  const [tab, setTab] = useState('new')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [bulkOutcome, setBulkOutcome] = useState('no_makeup')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [logging, setLogging] = useState(false)
  const reload = () => setReloadKey(k => k + 1)

  useEffect(() => {
    let alive = true
    ;(async () => {
      await Promise.resolve()
      if (!alive) return
      setLoading(true); setError(null)
      try {
        // Settle booked makeups whose date has passed before reading.
        await supabase.rpc('reconcile_absence_cases')
        const [{ data: open, error: e1 }, { data: closed, error: e2 }] = await Promise.all([
          supabase.from('absence_cases').select('*').neq('stage', 'closed').order('session_date', { ascending: false }),
          supabase.from('absence_cases').select('*').eq('stage', 'closed')
            .order('closed_at', { ascending: false, nullsFirst: false }).limit(200),
        ])
        if (e1 || e2) throw (e1 || e2)
        const cases = [...(open || []), ...(closed || [])]
        const sids = [...new Set(cases.map(c => c.student_id))]
        const caseIds = cases.map(c => c.id)
        const mlIds = [...new Set(cases.map(c => c.makeup_lesson_id).filter(Boolean))]
        const [studs, notes, guards, mls] = await Promise.all([
          chunkedIn('students', 'id, full_name, year, status', 'id', sids),
          chunkedIn('absence_case_notes', '*', 'case_id', caseIds),
          chunkedIn('guardians', 'student_id, full_name, email, phone', 'student_id', sids),
          mlIds.length ? chunkedIn('lessons', 'id, class_id, lesson_date, start_time, end_time, scheduled_teacher_id', 'id', mlIds) : [],
        ])
        // Classes by id — the missed sessions' and the makeups' (a guest makeup
        // sits in another class). Keyed strictly by id, so no term scoping.
        const classIds = [...new Set([...cases.map(c => c.class_id), ...mls.map(l => l.class_id)])]
        const cls = await chunkedIn('classes', 'id, class_name, day_of_week, start_time, end_time, room, course_id, term_id', 'id', classIds)
        if (!alive) return
        const notesBy = {}
        for (const n of notes) (notesBy[n.case_id] ||= []).push(n)
        for (const k of Object.keys(notesBy)) notesBy[k].sort((a, b) => b.created_at.localeCompare(a.created_at))
        const guardBy = {}
        for (const g of guards) (guardBy[g.student_id] ||= []).push(g)
        setData({
          cases,
          students: Object.fromEntries(studs.map(s => [s.id, s])),
          classes: Object.fromEntries(cls.map(c => [c.id, c])),
          makeups: Object.fromEntries(mls.map(l => [l.id, l])),
          notes: notesBy,
          guardians: guardBy,
        })
        setSelected(new Set())
      } catch (e) {
        if (alive) setError(e.message || 'Could not load absences.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [reloadKey])

  const counts = useMemo(() => {
    const c = { new: 0, contacted: 0, booked: 0, closed: 0 }
    for (const x of data.cases) c[x.stage] = (c[x.stage] || 0) + 1
    return c
  }, [data.cases])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.cases
      .filter(c => c.stage === tab)
      .filter(c => !q || [data.students[c.student_id]?.full_name, data.classes[c.class_id]?.class_name]
        .some(v => (v || '').toLowerCase().includes(q)))
      // Oldest absence first while it is open — it has waited longest.
      .sort((a, b) => tab === 'closed' ? 0 : a.session_date.localeCompare(b.session_date))
  }, [data, tab, search])

  const openCase = data.cases.find(c => c.id === openId) || null

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const bulkClose = async () => {
    if (!selected.size) return
    const label = MANUAL_CLOSE.find(o => o.id === bulkOutcome)?.label || bulkOutcome
    if (!window.confirm(`Close ${selected.size} case${selected.size === 1 ? '' : 's'} as “${label}”?`)) return
    setBulkBusy(true)
    try {
      const ids = [...selected]
      const { error: e } = await supabase.from('absence_cases')
        .update({ stage: 'closed', outcome: bulkOutcome, closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in('id', ids)
      if (e) throw e
      await supabase.from('absence_case_notes').insert(ids.map(id => ({
        case_id: id, kind: 'stage', body: `Closed as “${label}” (with ${ids.length - 1} other${ids.length === 2 ? '' : 's'}).`,
        author_id: staff?.id || null, author_name: staff?.full_name || null,
      })))
      reload()
    } catch (e) { alert('Could not close: ' + e.message) }
    finally { setBulkBusy(false) }
  }

  return (
    <div>
      {/* Stage tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {STAGES.map(s => (
          <button key={s.id} type="button" onClick={() => { setTab(s.id); setSelected(new Set()) }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${tab === s.id
              ? 'bg-[#062E63] text-white border-[#062E63]'
              : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#BACBFF]'}`}>
            {s.label}
            <span className={`ml-1.5 tabular-nums ${tab === s.id ? 'text-white/70' : 'text-[#2A2035]/40'}`}>{counts[s.id] || 0}</span>
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student or class"
          className="flex-1 md:flex-none md:w-56 md:ml-auto border border-[#DEE7FF] rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-[#325099]" />
        <button type="button" onClick={() => setLogging(true)}
          className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#062E63] text-white hover:bg-[#325099] transition shrink-0">+ Log absence</button>
      </div>
      <p className="text-[11px] text-[#2A2035]/45 mb-3">{STAGES.find(s => s.id === tab)?.hint}</p>

      {/* Bulk close bar */}
      {tab !== 'closed' && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-[#062E63] text-white text-xs">
          <span className="font-semibold">{selected.size} selected</span>
          <span className="text-white/60">close as</span>
          <select value={bulkOutcome} onChange={e => setBulkOutcome(e.target.value)}
            className="rounded-lg px-2 py-1 text-[#2A2035] bg-white text-xs">
            {MANUAL_CLOSE.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button type="button" onClick={bulkClose} disabled={bulkBusy}
            className="px-3 py-1 rounded-lg bg-white text-[#062E63] font-bold disabled:opacity-50">{bulkBusy ? 'Closing…' : 'Close'}</button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-white/70 hover:text-white">Clear</button>
        </div>
      )}

      {error && <p className="text-xs font-semibold text-[#B91C1C] mb-3">{error}</p>}
      {loading ? (
        <p className="text-sm text-[#2A2035]/40 animate-pulse py-10 text-center">Loading absences…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-[#2A2035]/40 italic py-10 text-center bg-white rounded-2xl border border-[#F0F4FF]">
          {search ? 'No case matches that search.' : tab === 'new' ? 'Nothing needs action — every absence is being followed up.' : 'No cases here.'}
        </p>
      ) : (
        <div className="bg-white rounded-2xl border border-[#F0F4FF] divide-y divide-[#F4F7FF] overflow-hidden">
          {tab !== 'closed' && (
            <label className="flex items-center gap-2 px-4 py-2 text-[11px] text-[#2A2035]/50 bg-[#FBFCFF]">
              <input type="checkbox" checked={shown.length > 0 && shown.every(c => selected.has(c.id))}
                onChange={e => setSelected(e.target.checked ? new Set(shown.map(c => c.id)) : new Set())} />
              Select all {shown.length}
            </label>
          )}
          {shown.map(c => {
            const st = data.students[c.student_id]
            const cl = data.classes[c.class_id]
            const last = data.notes[c.id]?.[0]
            const ml = c.makeup_lesson_id ? data.makeups[c.makeup_lesson_id] : null
            const age = daysSince(c.session_date)
            return (
              <div key={c.id} className={`flex items-start gap-3 px-4 py-3 hover:bg-[#F8FAFF] transition ${openId === c.id ? 'bg-[#F4F7FF]' : ''}`}>
                {tab !== 'closed' && (
                  <input type="checkbox" className="mt-1" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label="Select case" />
                )}
                <button type="button" onClick={() => setOpenId(c.id)} className="flex-1 min-w-0 text-left">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold text-[#062E63]">{st?.full_name || 'Unknown student'}</span>
                    {st?.year != null && <span className="text-[11px] text-[#2A2035]/40">Y{st.year}</span>}
                    {c.stage === 'closed' && c.outcome && (
                      <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${OUTCOMES[c.outcome]?.cls}`}>{OUTCOMES[c.outcome]?.label}</span>
                    )}
                    {c.notice_given && (
                      <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#E0F2FE] text-[#075985]">Notice given</span>
                    )}
                    <span className="ml-auto text-[11px] text-[#2A2035]/45 tabular-nums shrink-0">
                      {fmtDay(c.session_date)}{c.stage !== 'closed' && (c.session_date > isoDate(new Date()) ? ' · upcoming' : ` · ${age === 0 ? 'today' : `${age}d ago`}`)}
                    </span>
                  </div>
                  <p className="text-xs text-[#2A2035]/60 truncate">
                    {c.session_date > isoDate(new Date()) ? 'Will miss' : 'Absent from'} {classLabel(cl)}
                    {ml && <> · <span className="text-[#1E40AF] font-semibold">makeup {fmtDay(ml.lesson_date)}{ml.class_id !== c.class_id ? ` in ${data.classes[ml.class_id]?.class_name || 'another class'}` : ' (1:1)'}</span></>}
                  </p>
                  {last && (
                    <p className="text-[11px] text-[#2A2035]/45 truncate mt-0.5">
                      {NOTE_ICON[last.kind]} {last.body}{last.author_name ? ` — ${last.author_name.split(' ')[0]}` : ''}
                    </p>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {logging && (
        <LogAbsenceModal staff={staff} onClose={() => setLogging(false)}
          onLogged={(ids) => { setLogging(false); setTab('new'); setOpenId(ids.length === 1 ? ids[0] : null); reload() }}
          onPartial={reload} />
      )}

      {openCase && (
        <CasePanel
          key={openCase.id}
          c={openCase}
          data={data}
          staff={staff}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      )}
    </div>
  )
}

// ── Case panel ───────────────────────────────────────────────────────────────
function CasePanel({ c, data, staff, onClose, onChanged }) {
  const st = data.students[c.student_id]
  const cl = data.classes[c.class_id]
  const ml = c.makeup_lesson_id ? data.makeups[c.makeup_lesson_id] : null
  const notes = data.notes[c.id] || []
  const guardians = data.guardians[c.student_id] || []
  const [mode, setMode] = useState(null)           // 'makeup' | 'credit' | 'close' | null
  const [noteText, setNoteText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const author = { author_id: staff?.id || null, author_name: staff?.full_name || null }
  // After any action the form closes and the list reloads.
  const done = () => { setMode(null); onChanged() }
  const makeupUpcoming = ml && ml.lesson_date >= isoDate(new Date())

  const addNote = async (kind, body) =>
    supabase.from('absence_case_notes').insert({ case_id: c.id, kind, body, ...author })

  const setStage = async (patch, note) => {
    setBusy(true); setMsg(null)
    try {
      const { error } = await supabase.from('absence_cases').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', c.id)
      if (error) throw error
      if (note) await addNote('stage', note)
      done()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const saveNote = async (asContact) => {
    const body = noteText.trim()
    if (!body) return
    setBusy(true); setMsg(null)
    try {
      const { error } = await addNote(asContact ? 'contact' : 'note', body)
      if (error) throw error
      // Logging a contact on a case nobody has touched moves it on.
      if (asContact && c.stage === 'new') {
        await supabase.from('absence_cases').update({ stage: 'contacted', updated_at: new Date().toISOString() }).eq('id', c.id)
      }
      setNoteText('')
      done()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const undoCredit = async () => {
    if (!window.confirm('Undo this credit? The credit is removed (and added back onto the invoice if it was taken off one), and the case reopens.')) return
    setBusy(true); setMsg(null)
    try {
      const res = await authedFetch('/api/undo-cancellation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancellation_id: c.cancellation_id }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Undo failed')
      done()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const unbook = async () => {
    if (!window.confirm(`Cancel the makeup on ${fmtDay(ml.lesson_date)}? The makeup lesson is removed and the absence goes back to Needs action.`)) return
    setBusy(true); setMsg(null)
    const { error } = await cancelMakeup({
      studentId: c.student_id, makeupLesson: ml,
      source: { class_id: c.class_id, lesson_date: c.session_date },
    })
    setBusy(false)
    if (error) setMsg(error); else done()
  }

  const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold border transition disabled:opacity-50'
  const isClosed = c.stage === 'closed'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <aside className="relative w-full md:w-[460px] h-full bg-white shadow-2xl overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="sticky top-0 bg-white border-b border-[#F0F4FF] px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3 z-10">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-[#062E63]">{st?.full_name || 'Unknown student'}
                {st?.year != null && <span className="text-xs font-normal text-[#2A2035]/45"> · Year {st.year}</span>}</p>
              <p className="text-xs text-[#2A2035]/60">{c.session_date > isoDate(new Date()) ? 'Will miss' : 'Absent'} {fmtDay(c.session_date)} · {classLabel(cl)}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg leading-none px-1">✕</button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${STAGE_CHIP[c.stage]}`}>
              {STAGES.find(s => s.id === c.stage)?.label}
            </span>
            {isClosed && c.outcome && (
              <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${OUTCOMES[c.outcome]?.cls}`}>{OUTCOMES[c.outcome]?.label}</span>
            )}
            {c.notice_given && (
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#E0F2FE] text-[#075985]">Notice given</span>
            )}
            {ml && (
              <span className="text-[11px] text-[#1E40AF]">
                Makeup {fmtDay(ml.lesson_date)} {fmtTimeRange(ml.start_time, ml.end_time)}
                {ml.class_id !== c.class_id ? ` · ${classLabel(data.classes[ml.class_id])}` : ' · 1:1'}
              </span>
            )}
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Who to contact */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#325099]/60 mb-1.5">Parent / guardian</p>
            {guardians.length === 0 ? (
              <p className="text-xs text-[#2A2035]/40 italic">No guardian on file.</p>
            ) : guardians.map((g, i) => (
              <div key={i} className="text-xs text-[#2A2035] flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="font-semibold">{g.full_name || 'Guardian'}</span>
                {g.phone && <a href={`tel:${g.phone}`} className="text-[#325099] hover:underline">{g.phone}</a>}
                {g.email && <a href={`mailto:${g.email}`} className="text-[#325099] hover:underline">{g.email}</a>}
              </div>
            ))}
          </section>

          {/* Log a contact / add a note */}
          <section>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={2}
              placeholder={isClosed ? 'Add a note…' : 'What happened? e.g. “Called mum — will confirm Thursday”'}
              className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#325099] resize-y" />
            <div className="flex flex-wrap gap-2 mt-2">
              {!isClosed && (
                <button type="button" disabled={busy || !noteText.trim()} onClick={() => saveNote(true)}
                  className={`${btn} bg-[#325099] text-white border-[#325099] hover:bg-[#062E63]`}>
                  📞 Log contact{c.stage === 'new' ? ' → awaiting reply' : ''}
                </button>
              )}
              <button type="button" disabled={busy || !noteText.trim()} onClick={() => saveNote(false)}
                className={`${btn} bg-white text-[#325099] border-[#DEE7FF] hover:border-[#BACBFF]`}>📝 Add note</button>
            </div>
          </section>

          {/* Actions */}
          {!isClosed ? (
            <section className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#325099]/60">Settle it</p>
              <div className="flex flex-wrap gap-2">
                {[...(c.makeup_lesson_id ? [] : [['makeup', '📅 Book makeup']]), ['email', '✉️ Email family'], ['credit', '💳 Credit / cancel'], ['close', '✓ Close']].map(([m, label]) => (
                  <button key={m} type="button" onClick={() => setMode(mode === m ? null : m)}
                    className={`${btn} ${mode === m ? 'bg-[#EEF4FF] border-[#BACBFF] text-[#062E63]' : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#BACBFF]'}`}>{label}</button>
                ))}
                {makeupUpcoming && (
                  <button type="button" disabled={busy} onClick={unbook}
                    className={`${btn} bg-white text-[#B91C1C] border-[#FCA5A5]`}>✕ Cancel the booked makeup</button>
                )}
                {c.stage === 'contacted' && (
                  <button type="button" disabled={busy} onClick={() => setStage({ stage: 'new' }, 'Moved back to Needs action.')}
                    className={`${btn} bg-white text-[#2A2035]/60 border-[#E5E7EB]`}>↩ Needs action</button>
                )}
              </div>
              {mode === 'makeup' && <MakeupPicker c={c} student={st} cls={cl} onBooked={done} />}
              {mode === 'credit' && <CreditForm c={c} student={st} onDone={done} />}
              {mode === 'email' && <EmailForm c={c} student={st} cls={cl} ml={ml} mlCls={ml ? data.classes[ml.class_id] : null}
                guardians={guardians} onSent={done} />}
              {mode === 'close' && <CloseForm onClose={(outcome, note) => setStage(
                { stage: 'closed', outcome, closed_at: new Date().toISOString() },
                `Closed as “${MANUAL_CLOSE.find(o => o.id === outcome)?.label}”${note ? ` — ${note}` : ''}.`,
              )} busy={busy} />}
            </section>
          ) : (
            <section className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setMode(mode === 'email' ? null : 'email')}
                className={`${btn} bg-white text-[#325099] border-[#DEE7FF]`}>✉️ Email family</button>
              {c.cancellation_id ? (
                <button type="button" disabled={busy} onClick={undoCredit}
                  className={`${btn} bg-white text-[#B91C1C] border-[#FCA5A5]`}>↩ Undo {c.outcome === 'credited' ? 'credit' : 'cancellation'} and reopen</button>
              ) : (
                <button type="button" disabled={busy}
                  onClick={() => setStage({ stage: c.makeup_lesson_id ? 'booked' : 'new', outcome: null, closed_at: null }, 'Reopened.')}
                  className={`${btn} bg-white text-[#325099] border-[#DEE7FF]`}>↩ Reopen</button>
              )}
              {mode === 'email' && <div className="w-full"><EmailForm c={c} student={st} cls={cl} ml={ml} mlCls={ml ? data.classes[ml.class_id] : null}
                guardians={guardians} onSent={done} /></div>}
            </section>
          )}
          {msg && <p className="text-xs font-semibold text-[#B91C1C]">{msg}</p>}

          {/* Timeline */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#325099]/60 mb-2">History</p>
            <ol className="space-y-2.5">
              {notes.map(n => (
                <li key={n.id} className="flex gap-2 text-xs">
                  <span className="shrink-0 w-4 text-center">{NOTE_ICON[n.kind]}</span>
                  <div className="min-w-0">
                    <p className={n.kind === 'system' ? 'text-[#2A2035]/55' : 'text-[#2A2035]'}>{n.body}</p>
                    <p className="text-[10px] text-[#2A2035]/40">{[n.author_name, fmtStamp(n.created_at)].filter(Boolean).join(' · ')}</p>
                  </div>
                </li>
              ))}
              <li className="flex gap-2 text-xs">
                <span className="shrink-0 w-4 text-center">•</span>
                <div>
                  <p className="text-[#2A2035]/55">{c.source === 'manual' ? (c.notice_given ? 'Logged ahead — the family gave notice.' : 'Logged by hand.') : c.source === 'backfill' ? 'Case created from earlier attendance.' : 'Marked absent on the roll.'}</p>
                  <p className="text-[10px] text-[#2A2035]/40">{fmtStamp(c.created_at)}</p>
                </div>
              </li>
            </ol>
          </section>
        </div>
      </aside>
    </div>
  )
}

function CloseForm({ onClose, busy }) {
  const [outcome, setOutcome] = useState('no_makeup')
  const [note, setNote] = useState('')
  return (
    <div className="rounded-xl border border-[#DEE7FF] bg-[#FBFCFF] p-3 space-y-2">
      {MANUAL_CLOSE.map(o => (
        <label key={o.id} className="flex items-center gap-2 text-xs text-[#2A2035]">
          <input type="radio" name="close-outcome" checked={outcome === o.id} onChange={() => setOutcome(o.id)} />{o.label}
        </label>
      ))}
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
        className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
      <button type="button" disabled={busy} onClick={() => onClose(outcome, note.trim())}
        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#062E63] text-white disabled:opacity-50">Close case</button>
    </div>
  )
}

// Credit (or cancel without credit) through the same route the lessons
// sidebar uses: it marks the session cancelled, takes the credit off the
// family's open invoice (or holds it for next term) and records the
// cancellation — whose trigger then closes this case.
function CreditForm({ c, student, onDone }) {
  const [type, setType] = useState('credit')
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    let alive = true
    supabase.from('enrolments').select('price').eq('student_id', c.student_id).eq('class_id', c.class_id).limit(1)
      .then(({ data }) => {
        const p = data?.[0]?.price
        if (alive) setAmount(p ? Math.round((Number(p) / 10) * 100) / 100 : 0)
      })
    return () => { alive = false }
  }, [c.student_id, c.class_id])

  if (!c.lesson_id) {
    return <p className="text-xs text-[#B91C1C]">This absence has no lesson row yet (next term’s lessons may not be created), so it can&rsquo;t be credited until it does.</p>
  }

  const submit = async () => {
    const what = type === 'credit' ? `credit ${student?.full_name || 'this student'} $${(amount || 0).toFixed(2)}` : 'close this absence without a credit'
    if (!window.confirm(`Are you sure you want to ${what}?`)) return
    setBusy(true); setMsg(null)
    try {
      const res = await authedFetch('/api/cancel-lesson', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lesson_id: c.lesson_id, student_id: c.student_id, type, reason: reason.trim() || null }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Credit failed')
      onDone()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-[#DEE7FF] bg-[#FBFCFF] p-3 space-y-2">
      <label className="flex items-center gap-2 text-xs text-[#2A2035]">
        <input type="radio" checked={type === 'credit'} onChange={() => setType('credit')} />
        Credit {amount == null ? '…' : amount ? <strong>${amount.toFixed(2)}</strong> : <span className="text-[#B91C1C]">(no enrolment price — $0)</span>}
        <span className="text-[10px] text-[#2A2035]/45">1/10 of the term fee, off the open invoice or held for next term</span>
      </label>
      <label className="flex items-center gap-2 text-xs text-[#2A2035]">
        <input type="radio" checked={type === 'non_credit'} onChange={() => setType('non_credit')} />
        Cancel without credit
      </label>
      <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)"
        className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
      <button type="button" disabled={busy || amount == null} onClick={submit}
        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#5B21B6] text-white disabled:opacity-50">
        {busy ? 'Saving…' : type === 'credit' ? 'Apply credit' : 'Cancel without credit'}
      </button>
      {msg && <p className="text-xs font-semibold text-[#B91C1C]">{msg}</p>}
    </div>
  )
}

// ── Makeup picker ─────────────────────────────────────────────────────────────
function MakeupPicker({ c, student, cls, onBooked }) {
  const [kind, setKind] = useState('class')        // 'class' | 'oneToOne'
  const [opts, setOpts] = useState(null)           // loadMakeupSessions().list
  const [windowNote, setWindowNote] = useState('')
  const [showFull, setShowFull] = useState(false)
  const [pick, setPick] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [tutors, setTutors] = useState([])
  const [one, setOne] = useState({ date: '', start: toTimeInput(cls?.start_time), end: toTimeInput(cls?.end_time), room: cls?.room || '', tutorId: '' })

  useEffect(() => {
    let alive = true
    loadMakeupSessions(c, cls).then(({ list, note }) => { if (alive) { setOpts(list); setWindowNote(note) } })
    supabase.from('tutors').select('id, full_name').eq('active', true).order('full_name')
      .then(({ data }) => { if (alive) setTutors(data || []) })
    return () => { alive = false }
  }, [c, cls])

  const source = { id: c.lesson_id, class_id: c.class_id, lesson_date: c.session_date }

  const bookClass = async () => {
    if (!pick) return
    if (pick.full && !window.confirm(`${pick.cls?.class_name} on ${fmtDay(pick.lesson.lesson_date)} is already full (${pick.taken}/${CLASS_CAPACITY}). Book them in anyway?`)) return
    setBusy(true); setMsg(null)
    const { error } = await bookGuestMakeup({
      student: { id: c.student_id, full_name: student?.full_name || 'This student' },
      source,
      target: { ...pick.lesson, classes: { class_name: pick.cls?.class_name, room: pick.lesson.room || pick.cls?.room } },
    })
    setBusy(false)
    if (error) setMsg(error); else onBooked()
  }
  const bookOne = async () => {
    if (!one.date) return
    setBusy(true); setMsg(null)
    const { error } = await bookOneToOneMakeup({
      student: { id: c.student_id, full_name: student?.full_name || 'This student' },
      source, date: one.date, start: one.start, end: one.end, room: one.room, tutorId: one.tutorId,
    })
    setBusy(false)
    if (error) setMsg(error); else onBooked()
  }

  if (!c.lesson_id) return <p className="text-xs text-[#B91C1C]">This absence has no lesson row yet (next term’s lessons may not be created), so a makeup can&rsquo;t be linked to it.</p>

  const field = 'border border-[#DEE7FF] rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#325099] bg-white'
  const open = (opts || []).filter(o => !o.full)
  const suggested = new Set(open.slice(0, 3).map(o => o.lesson.id))
  const visible = (opts || []).filter(o => showFull || !o.full)
  const fullCount = (opts || []).length - open.length
  return (
    <div className="rounded-xl border border-[#DEE7FF] bg-[#FBFCFF] p-3 space-y-2.5">
      <div className="flex gap-1.5">
        {[['class', 'Join another class'], ['oneToOne', '1:1 makeup']].map(([k, label]) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${kind === k ? 'bg-[#062E63] text-white border-[#062E63]' : 'bg-white text-[#325099] border-[#DEE7FF]'}`}>{label}</button>
        ))}
      </div>

      {kind === 'class' ? (
        opts == null ? <p className="text-xs text-[#2A2035]/40 animate-pulse">Finding sessions…</p> : (
          <>
            {windowNote && <p className="text-[11px] text-[#92400E]">{windowNote}</p>}
            {opts.length === 0 ? (
              <p className="text-xs text-[#2A2035]/50 italic">
                {windowNote
                  ? 'No sessions found — next term’s lessons may not have been created yet. Use a 1:1 makeup, or come back once they are.'
                  : `No other ${cls?.class_name || ''} group session left in the term. Use a 1:1 makeup instead.`}
              </p>
            ) : (
              <>
                <div className="max-h-64 overflow-y-auto divide-y divide-[#EEF2FB] rounded-lg border border-[#EEF2FB] bg-white">
                  {visible.map(o => (
                    <label key={o.lesson.id} className={`flex items-center gap-2 px-2.5 py-2 text-xs cursor-pointer ${pick?.lesson.id === o.lesson.id ? 'bg-[#EEF4FF]' : 'hover:bg-[#F8FAFF]'} ${o.full ? 'opacity-60' : ''}`}>
                      <input type="radio" name="makeup-session" checked={pick?.lesson.id === o.lesson.id} onChange={() => setPick(o)} />
                      <span className="font-semibold text-[#062E63] w-24 shrink-0">{fmtDay(o.lesson.lesson_date)}</span>
                      <span className="flex-1 min-w-0 truncate text-[#2A2035]">
                        {o.cls?.class_name} · {fmtTimeRange(o.lesson.start_time || o.cls?.start_time, o.lesson.end_time || o.cls?.end_time)}
                        {suggested.has(o.lesson.id) && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-[#065F46] bg-[#D1FAE5] px-1.5 py-0.5 rounded-full">Suggested</span>}
                      </span>
                      <span className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full shrink-0 ${o.full ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#EEF4FF] text-[#325099]'}`}
                        title={`${o.taken} of ${CLASS_CAPACITY} seats taken on the day${o.guests ? ` · ${o.guests} makeup guest${o.guests === 1 ? '' : 's'}` : ''}${o.away ? ` · ${o.away} away` : ''}`}>
                        {o.full ? 'Full' : `${o.taken}/${CLASS_CAPACITY}`}
                      </span>
                    </label>
                  ))}
                </div>
                {fullCount > 0 && (
                  <label className="flex items-center gap-1.5 text-[11px] text-[#2A2035]/55">
                    <input type="checkbox" checked={showFull} onChange={e => setShowFull(e.target.checked)} />
                    Show {fullCount} full session{fullCount === 1 ? '' : 's'}
                  </label>
                )}
              </>
            )}
            <button type="button" disabled={busy || !pick} onClick={bookClass}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#1E40AF] text-white disabled:opacity-50">{busy ? 'Booking…' : 'Book into this session'}</button>
          </>
        )
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input type="date" value={one.date} onChange={e => setOne(v => ({ ...v, date: e.target.value }))} className={field} />
            <input type="time" value={one.start} onChange={e => setOne(v => ({ ...v, start: e.target.value }))} className={field} />
            <input type="time" value={one.end} onChange={e => setOne(v => ({ ...v, end: e.target.value }))} className={field} />
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={one.tutorId} onChange={e => setOne(v => ({ ...v, tutorId: e.target.value }))} className={`${field} flex-1 min-w-0`}>
              <option value="">Tutor…</option>
              {tutors.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
            <input value={one.room} onChange={e => setOne(v => ({ ...v, room: e.target.value }))} placeholder="Room" className={`${field} w-24`} />
          </div>
          <button type="button" disabled={busy || !one.date} onClick={bookOne}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#1E40AF] text-white disabled:opacity-50">{busy ? 'Booking…' : 'Book 1:1 makeup'}</button>
        </div>
      )}
      {msg && <p className="text-xs font-semibold text-[#B91C1C] whitespace-pre-line">{msg}</p>}
    </div>
  )
}

// ── Email the family ─────────────────────────────────────────────────────────
// Makeup options (sessions with space, ticked), the booked makeup, or a plain
// message. Subject and text are editable; the preview is the email exactly.
// The send route logs it on the case and moves a fresh case to awaiting reply.
function EmailForm({ c, student, cls, ml, mlCls, guardians, onSent }) {
  const ahead = c.session_date >= isoDate(new Date())
  const [kind, setKind] = useState(ml ? 'confirmed' : 'options')
  const [content, setContent] = useState(() => defaultAbsenceContent(ml ? 'confirmed' : 'options', { ahead }))
  const emails = guardians.filter(g => g.email)
  const [to, setTo] = useState(() => new Set(emails.map(g => g.email)))
  const [sessions, setSessions] = useState(null)
  const [chosen, setChosen] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    let alive = true
    loadMakeupSessions(c, cls).then(({ list }) => {
      if (!alive) return
      const open = list.filter(o => !o.full)
      setSessions(open)
      setChosen(new Set(open.slice(0, 3).map(o => o.lesson.id)))
    })
    return () => { alive = false }
  }, [c, cls])

  const switchKind = (k) => { setKind(k); setContent(defaultAbsenceContent(k, { ahead })) }
  const vars = {
    parentName: (emails.find(g => to.has(g.email))?.full_name || '').split(' ')[0],
    studentName: (student?.full_name || '').split(' ')[0],
    className: cls?.class_name,
    date: fmtDayLong(c.session_date),
  }
  const items = kind === 'options'
    ? (sessions || []).filter(o => chosen.has(o.lesson.id)).map(o => sessionLine(o.lesson, o.cls))
    : kind === 'confirmed' && ml ? [sessionLine(ml, mlCls || cls) + (ml.class_id === c.class_id ? ' (1:1)' : '')] : []
  const html = buildAbsenceEmailHtml(vars, content, items)

  const send = async (test) => {
    if (!to.size) { setMsg('Choose who to send it to.'); return }
    if (kind === 'options' && !items.length) { setMsg('Tick at least one session to offer.'); return }
    if (!test && !window.confirm(`Send “${fillAbsenceVars(content.subject, vars)}” to ${[...to].join(', ')}?`)) return
    setBusy(true); setMsg(null)
    try {
      const res = await authedFetch('/api/send-absence-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: c.id, to: [...to], vars, content, items, test }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Send failed')
      if (test) setMsg('Test sent to staff — the family did not receive it.')
      else onSent()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const field = 'w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#325099] bg-white'
  if (!emails.length) return <p className="text-xs text-[#B91C1C]">No guardian email on file for {student?.full_name || 'this student'}.</p>
  return (
    <div className="rounded-xl border border-[#DEE7FF] bg-[#FBFCFF] p-3 space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {[['options', 'Makeup options'], ...(ml ? [['confirmed', 'Makeup booked']] : []), ['message', 'Message']].map(([k, label]) => (
          <button key={k} type="button" onClick={() => switchKind(k)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${kind === k ? 'bg-[#062E63] text-white border-[#062E63]' : 'bg-white text-[#325099] border-[#DEE7FF]'}`}>{label}</button>
        ))}
      </div>
      <div className="space-y-1">
        {emails.map(g => (
          <label key={g.email} className="flex items-center gap-2 text-xs text-[#2A2035]">
            <input type="checkbox" checked={to.has(g.email)} onChange={() => setTo(prev => {
              const n = new Set(prev); if (n.has(g.email)) n.delete(g.email); else n.add(g.email); return n
            })} />
            {g.full_name || 'Guardian'} <span className="text-[#2A2035]/45">{g.email}</span>
          </label>
        ))}
      </div>
      {kind === 'options' && (
        sessions == null ? <p className="text-xs text-[#2A2035]/40 animate-pulse">Finding sessions…</p>
          : sessions.length === 0 ? <p className="text-xs text-[#92400E]">No group session with space to offer. Send a message instead, or book a 1:1.</p>
          : (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-[#EEF2FB] bg-white divide-y divide-[#EEF2FB]">
              {sessions.map(o => (
                <label key={o.lesson.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-[#F8FAFF]">
                  <input type="checkbox" checked={chosen.has(o.lesson.id)} onChange={() => setChosen(prev => {
                    const n = new Set(prev); if (n.has(o.lesson.id)) n.delete(o.lesson.id); else n.add(o.lesson.id); return n
                  })} />
                  <span className="flex-1 min-w-0 truncate">{sessionLine(o.lesson, o.cls)}</span>
                  <span className="text-[10px] text-[#2A2035]/45 shrink-0">{o.taken}/{CLASS_CAPACITY}</span>
                </label>
              ))}
            </div>
          )
      )}
      <input value={content.subject} onChange={e => setContent(v => ({ ...v, subject: e.target.value }))} className={field} aria-label="Subject" />
      <textarea value={content.body} onChange={e => setContent(v => ({ ...v, body: e.target.value }))} rows={6} className={`${field} resize-y`} aria-label="Message" />
      <p className="text-[10px] text-[#2A2035]/40">{'{{student_name}} {{parent_name}} {{class_name}} {{date}}'} fill in automatically · **bold**</p>
      <details className="rounded-lg border border-[#EEF2FB] bg-white">
        <summary className="px-2.5 py-1.5 text-[11px] font-semibold text-[#325099] cursor-pointer">Preview</summary>
        <iframe title="Email preview" srcDoc={html} className="w-full h-[420px] border-0 rounded-b-lg" />
      </details>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => send(false)}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#062E63] text-white disabled:opacity-50">{busy ? 'Sending…' : '✉️ Send'}</button>
        <button type="button" disabled={busy} onClick={() => send(true)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-[#325099] border border-[#DEE7FF] disabled:opacity-50">Send test to staff</button>
      </div>
      {msg && <p className={`text-xs font-semibold ${/^Test sent/.test(msg) ? 'text-[#065F46]' : 'text-[#B91C1C]'}`}>{msg}</p>}
    </div>
  )
}

// ── Log absences ahead of time ───────────────────────────────────────────────
// A family says their child will miss lessons: open the cases now, with what
// they said. One modal can log several — the same student across a week, or
// a few students at once — one row per absence. The tutor's roll then shows
// each student as away ("parent told us"), and each case is ready for a
// makeup or an email before the day.
// The trigger for a SearchSelectPopover — the same button the trials and
// database pages open their searchable dropdowns from.
function PickButton({ value, placeholder, onOpen, disabled = false }) {
  return (
    <button type="button" disabled={disabled}
      onClick={e => onOpen(e.currentTarget.getBoundingClientRect())}
      className="w-full text-left border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm bg-white hover:border-[#325099] focus:outline-none focus:border-[#325099] flex items-center justify-between gap-2 disabled:opacity-50">
      <span className={`truncate ${value ? 'text-[#2A2035] font-semibold' : 'text-[#2A2035]/40'}`}>{value || placeholder}</span>
      <span className="text-[#2A2035]/30 shrink-0">▾</span>
    </button>
  )
}

let _rowSeq = 0
const blankRow = () => ({ key: `r${++_rowSeq}`, student: null, classes: null, classId: '', sessions: null, date: '' })

// The student's classes in the term running now and the next teaching term
// (during the holidays that is the holiday courses and next term).
async function loadStudentClasses(studentId) {
  const terms = await fetchAllTerms()
  const termIds = [...new Set([getRunningTerm(terms)?.id, getCurrentTerm(terms)?.id].filter(Boolean))]
  const rows = []
  for (const tid of termIds) {
    const { data } = await enrolledClassesForTerm(studentId, tid, 'id, class_name, day_of_week, start_time, term_id')
      .in('status', ['active', 'trial'])
    rows.push(...(data || []).map(r => r.classes))
  }
  return [...new Map(rows.map(r => [r.id, r])).values()]
}
async function loadClassSessions(classId) {
  const { data } = await supabase.from('lessons').select('id, lesson_date, start_time').eq('class_id', classId)
    .eq('is_makeup', false).neq('status', 'cancelled').gte('lesson_date', isoDate(new Date()))
    .order('lesson_date').limit(20)
  return data || []
}

function LogAbsenceModal({ staff, onClose, onLogged, onPartial }) {
  const [students, setStudents] = useState(null)
  const [rows, setRows] = useState(() => [blankRow()])
  const [picker, setPicker] = useState(null)       // { rowKey, kind: 'student' | 'class' | 'session', rect }
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    let alive = true
    supabase.from('students').select('id, full_name, year, status').in('status', ['active', 'trial']).order('full_name')
      .then(({ data }) => { if (alive) setStudents(data || []) })
    return () => { alive = false }
  }, [])

  const patchRow = (key, patch) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)))

  const pickClass = async (key, classId) => {
    patchRow(key, { classId: String(classId), sessions: null, date: '' })
    const sessions = await loadClassSessions(classId)
    patchRow(key, { sessions, date: sessions[0]?.lesson_date || '' })
  }
  const pickStudent = async (key, id) => {
    const st = (students || []).find(x => x.id === id)
    if (!st) return
    patchRow(key, { student: st, classes: null, classId: '', sessions: null, date: '' })
    const classes = await loadStudentClasses(st.id)
    patchRow(key, { classes })
    if (classes.length === 1) pickClass(key, classes[0].id)
  }

  // Another row: same student and class as the last one, on their next lesson
  // after it — "away all week" is a couple of clicks. Change any of it.
  const addRow = () => {
    const last = rows[rows.length - 1]
    if (!last?.student) { setRows(rs => [...rs, blankRow()]); return }
    const taken = new Set(rows.filter(r => r.classId === last.classId).map(r => r.date))
    const next = (last.sessions || []).find(l => l.lesson_date > (last.date || '') && !taken.has(l.lesson_date))
    setRows(rs => [...rs, { ...blankRow(), student: last.student, classes: last.classes, classId: last.classId, sessions: last.sessions, date: next?.lesson_date || '' }])
  }
  const removeRow = (key) => setRows(rs => (rs.length > 1 ? rs.filter(r => r.key !== key) : rs))

  const complete = rows.filter(r => r.student && r.classId && r.date)
  const ready = rows.length > 0 && complete.length === rows.length

  const save = async () => {
    if (!ready) return
    const seen = new Set()
    for (const r of rows) {
      const k = `${r.student.id}|${r.classId}|${r.date}`
      if (seen.has(k)) { setMsg(`${r.student.full_name} on ${fmtDay(r.date)} is listed twice.`); return }
      seen.add(k)
    }
    setBusy(true); setMsg(null)
    const made = [], failed = []
    for (const r of rows) {
      const lesson = (r.sessions || []).find(l => l.lesson_date === r.date)
      const { data, error } = await supabase.from('absence_cases').insert({
        student_id: r.student.id, class_id: Number(r.classId), session_date: r.date,
        lesson_id: lesson?.id || null, source: 'manual',
        notice_given: r.date >= isoDate(new Date()),
      }).select('id').single()
      if (error) {
        failed.push({ row: r, why: /duplicate|unique/i.test(error.message) ? 'already logged' : error.message })
        continue
      }
      await supabase.from('absence_case_notes').insert({
        case_id: data.id, kind: 'contact',
        body: note.trim() || 'Family let us know they will be away.',
        author_id: staff?.id || null, author_name: staff?.full_name || null,
      })
      made.push({ id: data.id, key: r.key })
    }
    setBusy(false)
    if (!failed.length) { onLogged(made.map(m => m.id)); return }
    // Keep only the rows that didn't save, and say why.
    const madeKeys = new Set(made.map(m => m.key))
    setRows(rs => rs.filter(r => !madeKeys.has(r.key)))
    setMsg(`${made.length ? `Logged ${made.length}. ` : ''}Not logged: ${failed.map(f => `${f.row.student.full_name} ${fmtDay(f.row.date)} (${f.why})`).join('; ')}.`)
    if (made.length) onPartial?.()
  }

  const field = 'w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#325099] bg-white'
  const pr = picker ? rows.find(r => r.key === picker.rowKey) : null
  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl p-5 space-y-3 max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex items-start">
          <div className="flex-1">
            <p className="text-base font-bold text-[#062E63]">Log absences</p>
            <p className="text-[11px] text-[#2A2035]/50">The family told us ahead — open the cases now. One row per missed lesson.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg leading-none px-1">✕</button>
        </div>

        {students == null ? <p className="text-xs text-[#2A2035]/40 animate-pulse">Loading students…</p> : (
          <div className="space-y-2.5">
            {rows.map((r, idx) => {
              const cls = (r.classes || []).find(k => String(k.id) === r.classId)
              return (
                <div key={r.key} className="rounded-xl border border-[#DEE7FF] bg-[#FBFCFF] p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[#325099]/60 flex-1">Absence {idx + 1}</span>
                    {rows.length > 1 && (
                      <button type="button" onClick={() => removeRow(r.key)} aria-label={`Remove absence ${idx + 1}`}
                        className="text-[11px] text-[#2A2035]/40 hover:text-[#B91C1C]">✕ Remove</button>
                    )}
                  </div>
                  <PickButton value={r.student?.full_name} placeholder="Select student…"
                    onOpen={rect => setPicker({ rowKey: r.key, kind: 'student', rect })} />
                  {r.student && (
                    r.classes == null ? <p className="text-xs text-[#2A2035]/40 animate-pulse">Loading classes…</p>
                      : r.classes.length === 0 ? <p className="text-xs text-[#B91C1C]">No current classes for {r.student.full_name}.</p>
                      : <PickButton value={cls && classLabel(cls)} placeholder="Which class?"
                          onOpen={rect => setPicker({ rowKey: r.key, kind: 'class', rect })} />
                  )}
                  {r.student && r.classId && (
                    r.sessions == null ? <p className="text-xs text-[#2A2035]/40 animate-pulse">Loading lessons…</p>
                      : r.sessions.length ? (
                        <PickButton value={r.date && fmtDayLong(r.date)} placeholder="Which lesson?"
                          onOpen={rect => setPicker({ rowKey: r.key, kind: 'session', rect })} />
                      ) : (
                        <div>
                          <input type="date" value={r.date} onChange={e => patchRow(r.key, { date: e.target.value })} className={field} />
                          <p className="text-[10px] text-[#92400E] mt-1">No upcoming lessons found for this class (next term’s may not be created yet) — pick the date. Makeups and credits unlock once the lesson exists.</p>
                        </div>
                      )
                  )}
                </div>
              )
            })}
            <button type="button" onClick={addRow}
              className="w-full px-3 py-2 rounded-xl border border-dashed border-[#BACBFF] text-xs font-semibold text-[#325099] hover:bg-[#F4F7FF]">
              + Add another absence
            </button>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="What did the family say? e.g. “Mum texted — away for a school camp” (added to every absence logged here)"
              className={`${field} resize-y`} />
          </div>
        )}

        {picker && pr && (
          <SearchSelectPopover
            anchor={picker.rect}
            placeholder={picker.kind === 'student' ? 'Search student…' : picker.kind === 'class' ? 'Search class…' : 'Search date…'}
            options={picker.kind === 'student'
              ? (students || []).map(x => ({ value: x.id, label: x.full_name, sub: [x.year != null && `Year ${x.year}`, x.status === 'trial' && 'trial'].filter(Boolean).join(' · ') }))
              : picker.kind === 'class'
                ? (pr.classes || []).map(k => ({ value: k.id, label: classLabel(k) }))
                : (pr.sessions || []).map(l => ({ value: l.lesson_date, label: fmtDayLong(l.lesson_date), sub: fmtTime(l.start_time) }))}
            currentValue={picker.kind === 'student' ? pr.student?.id : picker.kind === 'class' ? pr.classId : pr.date}
            onClose={() => setPicker(null)}
            onSelect={v => {
              const { kind, rowKey } = picker
              setPicker(null)
              if (kind === 'student') { if (v !== pr.student?.id) pickStudent(rowKey, v) }
              else if (kind === 'class') { if (String(v) !== pr.classId) pickClass(rowKey, v) }
              else patchRow(rowKey, { date: v })
            }}
          />
        )}

        {msg && <p className="text-xs font-semibold text-[#B91C1C]">{msg}</p>}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#DEE7FF] text-[#2A2035]/60">Cancel</button>
          <button type="button" disabled={busy || !ready} onClick={save}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#062E63] text-white disabled:opacity-50">
            {busy ? 'Saving…' : `Log ${rows.length} absence${rows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
