'use client'
import { useMemo, useState } from 'react'

/*
 * Draft enrolments — the timetable draft's rosters as a table, one row per
 * enrolment (student × class), sorted year → class → student.
 *
 * It reads and writes the same draft the grid above does: changing a row's
 * class moves the student between cards, ✕ takes them out, "+ Add" puts them
 * in. None of it touches real enrolments until "Apply to live", and the
 * planning fields (confirmed with parent / teacher, notes) never do — they
 * live on the draft only (timetable_drafts.enrolment_meta).
 *
 * Day, times and teacher belong to the class, not the enrolment, so editing
 * them on any row changes the class card and every row of that class.
 *
 * Live enrolments the draft no longer has are listed struck through, so the
 * table shows exactly what Apply to live will disenrol. A student moved to
 * another class of the same course is one row ("moved from …"), not a
 * removal plus an addition.
 */

const CELL = 'px-2.5 py-1.5 align-middle'
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const INLINE = 'border border-transparent hover:border-[#DEE7FF] rounded-lg px-1 py-0.5 bg-transparent text-[#325099] focus:outline-none focus:border-[#325099] focus:bg-white'
const toMins = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null }
const fromMins = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
const yearNum = (y) => { const n = parseInt(y, 10); return Number.isFinite(n) ? n : 99 }

export default function DraftEnrolmentTable({
  draftId, entries, liveList, hiddenIds, studentsById, allStudents,
  meta, onMeta, onAdd, onRemove, onMove,
  isOffCourse, enrolledSummary, courseName, whenOf, teacherOf,
  tutors = [], teacherIdOf, timeToInput, onEditClass,
}) {
  // Moving the start keeps the class's length, as dragging a card does.
  const setStart = (e, value) => {
    const s0 = toMins(timeToInput(e.start_time)), e0 = toMins(timeToInput(e.end_time)), s1 = toMins(value)
    const patch = { start_time: value }
    if (s0 != null && e0 != null && s1 != null && e0 > s0) patch.end_time = fromMins(Math.min(s1 + (e0 - s0), 23 * 60 + 59))
    onEditClass(e.id, patch)
  }
  const CLASS_WIDE = 'Changes the whole class — its card and every student in it'

  const [query, setQuery]   = useState('')
  const [year, setYear]     = useState('')
  const [show, setShow]     = useState('all')   // all | changes | parent | teacher
  const [addQuery, setAddQuery] = useState('')
  const [addSid, setAddSid] = useState('')
  const [addClass, setAddClass] = useState('')

  const classLabel = (e) => [e.class_name || courseName(e.course_id) || 'Class', whenOf(e)].filter(Boolean).join(' · ')
  const classOptions = useMemo(
    () => [...entries].filter(e => e.id).sort((a, b) => (a.class_name || '').localeCompare(b.class_name || '', undefined, { numeric: true })),
    [entries],
  )

  const rows = useMemo(() => {
    const liveById = new Map(liveList.map(c => [String(c.id), c]))
    const draftById = new Map(entries.map(e => [String(e.id), e]))
    const inDraft = (classId, sid) => (draftById.get(String(classId))?.student_ids || []).includes(sid)
    // Same-course placements in the draft, for recognising a move.
    const draftCourse = new Set()
    for (const e of entries) if (e.course_id) for (const sid of (e.student_ids || [])) draftCourse.add(`${e.course_id}|${sid}`)

    const out = []
    for (const e of entries) {
      for (const sid of (e.student_ids || [])) {
        const live = liveById.get(String(e.id))
        let change = null
        if (!live?.student_ids?.includes(sid)) {
          // Left a live class of the same course → it's a move, say from where.
          const from = e.course_id && liveList.find(c =>
            c.course_id === e.course_id && String(c.id) !== String(e.id)
            && (c.student_ids || []).includes(sid) && !inDraft(c.id, sid))
          change = from ? { kind: 'moved', from } : { kind: 'new' }
        }
        out.push({ key: `${e.id}|${sid}`, sid, entry: e, change, off: isOffCourse(sid, e.course_id, e.id) })
      }
    }
    for (const c of liveList) {
      for (const sid of (c.student_ids || [])) {
        if (inDraft(c.id, sid)) continue
        if (c.course_id && draftCourse.has(`${c.course_id}|${sid}`)) continue   // shown as a move
        const still = draftById.get(String(c.id))
        out.push({ key: `${c.id}|${sid}`, sid, entry: still || c, removed: true, classGone: !still })
      }
    }
    const nameOf = (sid) => studentsById[sid]?.full_name || ''
    return out.sort((a, b) =>
      yearNum(studentsById[a.sid]?.year) - yearNum(studentsById[b.sid]?.year)
      || (a.entry.class_name || '').localeCompare(b.entry.class_name || '', undefined, { numeric: true })
      || nameOf(a.sid).localeCompare(nameOf(b.sid)))
  }, [entries, liveList, studentsById, isOffCourse])

  const years = useMemo(
    () => [...new Set(rows.map(r => studentsById[r.sid]?.year).filter(Boolean))].sort((a, b) => yearNum(a) - yearNum(b)),
    [rows, studentsById],
  )

  const q = query.trim().toLowerCase()
  const shown = rows.filter(r => {
    const st = studentsById[r.sid]
    if (year && String(st?.year) !== String(year)) return false
    const m = meta[r.key] || {}
    if (show === 'changes' && !r.change && !r.removed) return false
    if (show === 'parent' && (r.removed || m.parent)) return false
    if (show === 'teacher' && (r.removed || m.teacher)) return false
    if (!q) return true
    return [st?.full_name, r.entry.class_name, courseName(r.entry.course_id), m.note]
      .some(v => (v || '').toLowerCase().includes(q))
  })

  // Shade alternate classes grey / white so each class's students read as a
  // block. Rows are sorted year → class, so a class's rows are contiguous.
  const band = []
  shown.forEach((r, i) => band.push(i && String(r.entry.id) !== String(shown[i - 1].entry.id) ? band[i - 1] + 1 : (band[i - 1] || 0)))

  const placed = rows.filter(r => !r.removed)
  const parentDone  = placed.filter(r => meta[r.key]?.parent).length
  const teacherDone = placed.filter(r => meta[r.key]?.teacher).length
  const removedCount = rows.length - placed.length
  const classCount = new Set(placed.map(r => String(r.entry.id))).size

  const ACTIVE = new Set(['active', 'trial'])
  const aq = addQuery.trim().toLowerCase()
  const addMatches = aq && !addSid
    ? allStudents.filter(s => ACTIVE.has(s.status || 'active') && (s.full_name || '').toLowerCase().includes(aq)).slice(0, 10)
    : []
  const addTarget = entries.find(e => String(e.id) === String(addClass))
  const addDup = addTarget && addSid && (addTarget.student_ids || []).includes(addSid)
  const submitAdd = () => {
    if (!addSid || !addTarget || addDup) return
    onAdd(addTarget.id, addSid)
    setAddSid(''); setAddQuery('')
  }

  return (
    <section className="mt-6 bg-white rounded-2xl border border-[#DEE7FF] shadow-sm">
      <div className="px-4 pt-4 pb-3 border-b border-[#EEF2FB] flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-base font-bold text-[#062E63]">Draft enrolments</p>
          <p className="text-xs text-[#325099]/60 mt-0.5">
            {placed.length} enrolment{placed.length === 1 ? '' : 's'} across {classCount} class{classCount === 1 ? '' : 'es'}
            {' · '}<span className={parentDone === placed.length && placed.length ? 'text-emerald-700 font-semibold' : ''}>parent ✓ {parentDone}/{placed.length}</span>
            {' · '}<span className={teacherDone === placed.length && placed.length ? 'text-emerald-700 font-semibold' : ''}>teacher ✓ {teacherDone}/{placed.length}</span>
            {removedCount > 0 && <> · <span className="text-red-600">{removedCount} to be removed</span></>}
            <span className="text-[#325099]/40"> · this draft only — real enrolments change on “Apply to live”</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search student, class, note…"
            className="border border-[#DEE7FF] rounded-full px-3 py-1.5 w-52 focus:outline-none focus:border-[#325099]" />
          <select value={year} onChange={e => setYear(e.target.value)}
            className="border border-[#DEE7FF] rounded-full px-3 py-1.5 bg-white text-[#325099] font-semibold focus:outline-none">
            <option value="">All years</option>
            {years.map(y => <option key={y} value={y}>Year {y}</option>)}
          </select>
          <select value={show} onChange={e => setShow(e.target.value)}
            className="border border-[#DEE7FF] rounded-full px-3 py-1.5 bg-white text-[#325099] font-semibold focus:outline-none">
            <option value="all">All rows</option>
            <option value="changes">Changes only</option>
            <option value="parent">Not confirmed with parent</option>
            <option value="teacher">Not confirmed with teacher</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-[#325099]/50 border-b border-[#EEF2FB]">
              <th className={`${CELL} w-10`}>Yr</th>
              <th className={CELL}>Student</th>
              <th className={CELL}>Class</th>
              <th className={CELL}>Course</th>
              <th className={CELL}>Day / time</th>
              <th className={CELL}>Teacher</th>
              <th className={CELL}>Change</th>
              <th className={`${CELL} text-center`} title="Confirmed with parent">Parent ✓</th>
              <th className={`${CELL} text-center`} title="Confirmed with teacher">Teacher ✓</th>
              <th className={`${CELL} min-w-[12rem]`}>Notes</th>
              <th className={`${CELL} w-8`} />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-6 text-center text-[#325099]/40 italic">
                {rows.length ? 'No rows match these filters.' : 'No students in this draft yet.'}
              </td></tr>
            )}
            {shown.map((r, i) => {
              const st = studentsById[r.sid]
              const m = meta[r.key] || {}
              const prev = shown[i - 1]
              const newYear = i > 0 && yearNum(studentsById[prev.sid]?.year) !== yearNum(st?.year)
              return (
                <tr key={r.key}
                  className={`border-b border-[#F3F6FD] ${newYear ? 'border-t-2 border-t-[#DEE7FF]' : ''} ${r.removed ? 'bg-red-50/60 text-[#325099]/45' : band[i] % 2 ? 'bg-[#F1F4FA] hover:bg-[#E8EDF7]' : 'bg-white hover:bg-[#F8FAFF]'}`}>
                  <td className={`${CELL} font-semibold text-[#325099]/70`}>{st?.year || '—'}</td>
                  <td className={`${CELL} font-semibold whitespace-nowrap ${r.removed ? 'line-through' : 'text-[#062E63]'}`}>
                    {st?.full_name || 'Unknown student'}
                    {st?.status === 'trial' && <span className="ml-1 text-[10px] font-semibold text-amber-600 no-underline">trial</span>}
                  </td>
                  <td className={CELL}>
                    {r.removed ? (
                      <span className="line-through">{r.entry.class_name || 'Class'}</span>
                    ) : (
                      <select value={String(r.entry.id)} onChange={e => onMove(r.sid, r.entry.id, e.target.value)}
                        title="Move to another class"
                        className="border border-transparent hover:border-[#DEE7FF] rounded-lg px-1 py-0.5 bg-transparent text-[#325099] max-w-[12rem] focus:outline-none focus:border-[#325099]">
                        {classOptions.map(c => (
                          <option key={c.id} value={String(c.id)}
                            disabled={String(c.id) !== String(r.entry.id) && (c.student_ids || []).includes(r.sid)}>
                            {classLabel(c)}{hiddenIds.has(c.id) ? ' (hidden)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className={`${CELL} whitespace-nowrap ${r.removed ? 'line-through' : ''}`}>{courseName(r.entry.course_id) || '—'}</td>
                  {r.removed ? (
                    <>
                      <td className={`${CELL} whitespace-nowrap line-through`}>{whenOf(r.entry) || '—'}</td>
                      <td className={`${CELL} line-through`}>{teacherOf(r.entry) || '—'}</td>
                    </>
                  ) : (
                    <>
                      <td className={`${CELL} whitespace-nowrap`} title={CLASS_WIDE}>
                        <select value={r.entry.day_of_week || ''} onChange={e => onEditClass(r.entry.id, { day_of_week: e.target.value || null })}
                          className={`${INLINE} w-[4.2rem]`}>
                          <option value="">—</option>
                          {DAYS.map(d => <option key={d} value={d}>{d.slice(0, 3)}</option>)}
                        </select>
                        <input type="time" value={timeToInput(r.entry.start_time)} onChange={e => e.target.value && setStart(r.entry, e.target.value)}
                          className={`${INLINE} w-[6.2rem]`} />
                        <span className="text-[#325099]/40">–</span>
                        <input type="time" value={timeToInput(r.entry.end_time)} onChange={e => e.target.value && onEditClass(r.entry.id, { end_time: e.target.value })}
                          className={`${INLINE} w-[6.2rem]`} />
                      </td>
                      <td className={CELL} title={CLASS_WIDE}>
                        {(() => {
                          const tid = teacherIdOf(r.entry)
                          return (
                            <select value={tid || (r.entry.teacher ? '_raw' : '')}
                              onChange={e => {
                                if (e.target.value === '_raw') return
                                onEditClass(r.entry.id, { teacher: tutors.find(t => String(t.id) === e.target.value)?.full_name || null })
                              }}
                              className={`${INLINE} max-w-[9rem]`}>
                              <option value="">— none —</option>
                              {!tid && r.entry.teacher && <option value="_raw">{r.entry.teacher}</option>}
                              {tutors.map(t => <option key={t.id} value={String(t.id)}>{t.full_name}</option>)}
                            </select>
                          )
                        })()}
                      </td>
                    </>
                  )}
                  <td className={`${CELL} whitespace-nowrap`}>
                    {r.removed && (
                      <span className="text-red-600 font-semibold" title="Apply to live will disenrol them from this class">
                        ✕ {r.classGone ? 'class removed' : 'removed'}
                      </span>
                    )}
                    {r.change?.kind === 'new' && <span className="text-emerald-700 font-semibold">✦ new</span>}
                    {r.change?.kind === 'moved' && (
                      <span className="text-[#325099] font-semibold" title={`From ${classLabel(r.change.from)}`}>
                        ↔ from {whenOf(r.change.from) || r.change.from.class_name}
                      </span>
                    )}
                    {!r.removed && !r.change && <span className="text-[#325099]/30">—</span>}
                    {r.off && (
                      <span className="ml-1.5 px-1.5 py-px rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold cursor-help"
                        title={`Not enrolled in this course — ${enrolledSummary(r.sid)}`}>⚠ not enrolled</span>
                    )}
                  </td>
                  <td className={`${CELL} text-center`}>
                    {!r.removed && (
                      <input type="checkbox" checked={!!m.parent} onChange={e => onMeta(r.key, { parent: e.target.checked })}
                        className="w-4 h-4 accent-emerald-600 cursor-pointer" title="Confirmed with parent" />
                    )}
                  </td>
                  <td className={`${CELL} text-center`}>
                    {!r.removed && (
                      <input type="checkbox" checked={!!m.teacher} onChange={e => onMeta(r.key, { teacher: e.target.checked })}
                        className="w-4 h-4 accent-emerald-600 cursor-pointer" title="Confirmed with teacher" />
                    )}
                  </td>
                  <td className={CELL}>
                    <input
                      key={`${draftId}|${r.key}|${m.note || ''}`}
                      defaultValue={m.note || ''}
                      onBlur={e => { if ((e.target.value || '') !== (m.note || '')) onMeta(r.key, { note: e.target.value }) }}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                      placeholder="—"
                      className="w-full border border-transparent hover:border-[#DEE7FF] rounded-lg px-1.5 py-0.5 bg-transparent text-[#062E63] placeholder:text-[#325099]/25 focus:outline-none focus:border-[#325099] focus:bg-white"
                    />
                  </td>
                  <td className={`${CELL} text-center`}>
                    {r.removed ? (
                      !r.classGone && (
                        <button onClick={() => onAdd(r.entry.id, r.sid)} title="Put them back in this class"
                          className="text-[#325099]/60 hover:text-[#325099] font-bold">↺</button>
                      )
                    ) : (
                      <button onClick={() => onRemove(r.entry.id, r.sid)} title="Remove from this class (draft only)"
                        className="text-red-300 hover:text-red-600">✕</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Add an enrolment to the draft */}
      <div className="px-4 py-3 border-t border-[#EEF2FB] flex items-center gap-2 flex-wrap text-xs">
        <span className="font-semibold text-[#062E63]">+ Add enrolment</span>
        <div className="relative">
          <input
            value={addQuery}
            onChange={e => { setAddQuery(e.target.value); setAddSid('') }}
            placeholder="Student name…"
            className={`border rounded-lg px-2.5 py-1.5 w-52 focus:outline-none focus:border-[#325099] ${addSid ? 'border-emerald-300 bg-emerald-50/40' : 'border-[#DEE7FF]'}`}
          />
          {addMatches.length > 0 && (
            <div className="absolute z-20 bottom-full mb-1 left-0 w-64 bg-white border border-[#DEE7FF] rounded-xl shadow-lg max-h-56 overflow-y-auto">
              {addMatches.map(s => (
                <button key={s.id} onClick={() => { setAddSid(s.id); setAddQuery(s.full_name || '') }}
                  className="w-full text-left px-3 py-1.5 text-[#325099] hover:bg-[#F0F4FF]">
                  {s.full_name}{s.year ? ` · ${s.year}` : ''}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="text-[#325099]/40">into</span>
        <select value={addClass} onChange={e => setAddClass(e.target.value)}
          className="border border-[#DEE7FF] rounded-lg px-2 py-1.5 bg-white text-[#325099] max-w-[16rem] focus:outline-none focus:border-[#325099]">
          <option value="">Choose a class…</option>
          {classOptions.map(c => <option key={c.id} value={String(c.id)}>{classLabel(c)}</option>)}
        </select>
        <button onClick={submitAdd} disabled={!addSid || !addTarget || addDup}
          className="font-semibold rounded-lg px-3 py-1.5 bg-[#325099] text-white hover:bg-[#062E63] disabled:opacity-40">Add</button>
        {addDup && <span className="text-[#325099]/50">Already in that class.</span>}
        {!addDup && addSid && addTarget && isOffCourse(addSid, addTarget.course_id, addTarget.id) && (
          <span className="text-amber-700" title={enrolledSummary(addSid)}>⚠ not enrolled in this course — {enrolledSummary(addSid)}</span>
        )}
      </div>
    </section>
  )
}
