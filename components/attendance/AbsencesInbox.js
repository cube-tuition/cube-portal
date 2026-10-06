'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { authedFetch } from '../../lib/authedFetch'
import { fetchAllTerms } from '../../lib/terms'
import { fmtTime, fmtTimeRange, isoDate } from '../../lib/format'
import { bookGuestMakeup, bookOneToOneMakeup, cancelMakeup } from '../../lib/makeups'

/*
 * Absences — the working inbox on /tutor/admin/monitoring/attendance.
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
const NOTE_ICON = { note: '📝', contact: '📞', stage: '➜', system: '⚙️' }
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
          className="w-full md:w-56 md:ml-auto border border-[#DEE7FF] rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-[#325099]" />
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
                    <span className="ml-auto text-[11px] text-[#2A2035]/45 tabular-nums shrink-0">
                      {fmtDay(c.session_date)}{c.stage !== 'closed' && ` · ${age === 0 ? 'today' : `${age}d ago`}`}
                    </span>
                  </div>
                  <p className="text-xs text-[#2A2035]/60 truncate">
                    Absent from {classLabel(cl)}
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
              <p className="text-xs text-[#2A2035]/60">Absent {fmtDay(c.session_date)} · {classLabel(cl)}</p>
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
                {[...(c.makeup_lesson_id ? [] : [['makeup', '📅 Book makeup']]), ['credit', '💳 Credit / cancel'], ['close', '✓ Close']].map(([m, label]) => (
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
              {mode === 'close' && <CloseForm onClose={(outcome, note) => setStage(
                { stage: 'closed', outcome, closed_at: new Date().toISOString() },
                `Closed as “${MANUAL_CLOSE.find(o => o.id === outcome)?.label}”${note ? ` — ${note}` : ''}.`,
              )} busy={busy} />}
            </section>
          ) : (
            <section className="flex flex-wrap gap-2">
              {c.cancellation_id ? (
                <button type="button" disabled={busy} onClick={undoCredit}
                  className={`${btn} bg-white text-[#B91C1C] border-[#FCA5A5]`}>↩ Undo {c.outcome === 'credited' ? 'credit' : 'cancellation'} and reopen</button>
              ) : (
                <button type="button" disabled={busy}
                  onClick={() => setStage({ stage: c.makeup_lesson_id ? 'booked' : 'new', outcome: null, closed_at: null }, 'Reopened.')}
                  className={`${btn} bg-white text-[#325099] border-[#DEE7FF]`}>↩ Reopen</button>
              )}
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
                  <p className="text-[#2A2035]/55">{c.source === 'manual' ? 'Logged by hand.' : c.source === 'backfill' ? 'Case created from earlier attendance.' : 'Marked absent on the roll.'}</p>
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
    return <p className="text-xs text-[#B91C1C]">This absence has no lesson row to cancel against, so it can&rsquo;t be credited here.</p>
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
// Any session of the same course from today to the end of the absence's term
// (any time in the term). If that term has finished, the next term's sessions
// — the makeup carries over.
function MakeupPicker({ c, student, cls, onBooked }) {
  const [kind, setKind] = useState('class')        // 'class' | 'oneToOne'
  const [opts, setOpts] = useState(null)           // [{ lesson, cls, enrolled }]
  const [windowNote, setWindowNote] = useState('')
  const [pick, setPick] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [tutors, setTutors] = useState([])
  const [one, setOne] = useState({ date: '', start: toTimeInput(cls?.start_time), end: toTimeInput(cls?.end_time), room: cls?.room || '', tutorId: '' })

  useEffect(() => {
    let alive = true
    ;(async () => {
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
      const sib = cls?.course_id
        ? (await supabase.from('classes').select('id, class_name, day_of_week, start_time, end_time, room, term_id').eq('course_id', cls.course_id)).data || []
        : (cls ? [cls] : [])
      const sibIds = sib.map(s => s.id)
      const [{ data: lessons }, { data: mine }, { data: enr }] = await Promise.all([
        sibIds.length
          ? supabase.from('lessons').select('id, class_id, lesson_date, start_time, end_time, week, status')
              .in('class_id', sibIds).gte('lesson_date', today).lte('lesson_date', to)
              .eq('is_makeup', false).neq('status', 'cancelled').order('lesson_date').order('start_time')
          : { data: [] },
        supabase.from('enrolments').select('class_id').eq('student_id', c.student_id).in('status', ['active', 'trial']),
        sibIds.length ? supabase.from('enrolments').select('class_id').in('class_id', sibIds).in('status', ['active', 'trial']) : { data: [] },
      ])
      const own_ = new Set((mine || []).map(e => e.class_id))
      const counts = {}
      for (const e of enr || []) counts[e.class_id] = (counts[e.class_id] || 0) + 1
      const byId = Object.fromEntries(sib.map(s => [s.id, s]))
      const list = (lessons || [])
        .filter(l => !own_.has(l.class_id))   // their own class would double-book them
        .map(l => ({ lesson: l, cls: byId[l.class_id], enrolled: counts[l.class_id] || 0 }))
      if (!alive) return
      setOpts(list); setWindowNote(note)
    })()
    supabase.from('tutors').select('id, full_name').eq('active', true).order('full_name')
      .then(({ data }) => { if (alive) setTutors(data || []) })
    return () => { alive = false }
  }, [c.session_date, c.student_id, cls])

  const source = { id: c.lesson_id, class_id: c.class_id, lesson_date: c.session_date }
  const noSource = !c.lesson_id

  const bookClass = async () => {
    if (!pick) return
    setBusy(true); setMsg(null)
    const { error } = await bookGuestMakeup({
      student: { id: c.student_id, full_name: student?.full_name || 'This student' },
      source,
      target: { ...pick.lesson, classes: { class_name: pick.cls?.class_name, room: pick.cls?.room } },
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

  if (noSource) return <p className="text-xs text-[#B91C1C]">This absence has no lesson row, so a makeup can&rsquo;t be linked to it.</p>

  const field = 'border border-[#DEE7FF] rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#325099] bg-white'
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
                  : `No other ${cls?.class_name || ''} session left in the term. Use a 1:1 makeup instead.`}
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto divide-y divide-[#EEF2FB] rounded-lg border border-[#EEF2FB] bg-white">
                {opts.map(o => (
                  <label key={o.lesson.id} className={`flex items-center gap-2 px-2.5 py-2 text-xs cursor-pointer ${pick?.lesson.id === o.lesson.id ? 'bg-[#EEF4FF]' : 'hover:bg-[#F8FAFF]'}`}>
                    <input type="radio" name="makeup-session" checked={pick?.lesson.id === o.lesson.id} onChange={() => setPick(o)} />
                    <span className="font-semibold text-[#062E63] w-24 shrink-0">{fmtDay(o.lesson.lesson_date)}</span>
                    <span className="flex-1 min-w-0 truncate text-[#2A2035]">
                      {o.cls?.class_name} · {fmtTimeRange(o.lesson.start_time || o.cls?.start_time, o.lesson.end_time || o.cls?.end_time)}
                    </span>
                    <span className="text-[10px] text-[#2A2035]/45 shrink-0">{o.enrolled} enrolled</span>
                  </label>
                ))}
              </div>
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
