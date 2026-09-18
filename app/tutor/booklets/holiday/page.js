'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import { fetchAllTerms, formatTermRange } from '../../../../lib/terms'
import { T_HOLIDAY_BOOKLETS, T_CLASSES, T_LESSONS, T_BOOKLETS } from '../../../../lib/tables'
import { subjectFromCourseCode, yearFromCourseCode } from '../../../../lib/courses'
import { statusStyle } from '../../../../lib/resourceSubjects'
import { SUBJECT_FAMILIES, SCOPE_LABEL } from '../../../../lib/qbank'
import TutorNav from '../../../../components/TutorNav'

/*
 * Holiday Courses — /tutor/booklets/holiday?subject=Maths
 *
 * A holiday course is not a term: it runs for a handful of consecutive days in
 * one school-holiday period, with a workbook planned for each day, so it never
 * fitted the term curriculum's term/week grid.
 *
 * A course here is a CLASS created in a holiday period, exactly as the database
 * explorer lists it — not a (year, subject) pair. Offering a blank grid for
 * every year and subject asked which of a hundred empty courses to plan; the
 * classes table already knows which ones CUBE is running, who teaches them and
 * when, so this page plans those and nothing else.
 *
 * Its days are the sessions scheduled for that class, dates and all. A course
 * that runs three mornings shows three days, on the mornings it runs — not a
 * default five — and a workbook is filed against the lesson, so moving a
 * session takes its workbook with it.
 */

// Subject-hub scoping comes from lib/qbank, the same list the term curriculum
// and the question bank read.
const SUBJECT_FAMILY = SUBJECT_FAMILIES

// A holiday period is a term row numbered above the four teaching terms — the
// same marker the calendar uses to tell holidays from terms.
const isHolidayTerm = (t) => Number(t?.term_number) > 10
// "Term 3–4 Holidays 2026" → "Term 3–4 Holidays"; the dates sit underneath.
const periodName = (t) => String(t?.name || '').replace(/\s*\d{4}\s*$/, '').trim() || 'Holidays'
// A class still being run; a cancelled one keeps its row but not its plan.
const isLiveClass = (c) => (c?.status || 'active') === 'active'

// "2026-09-17" → "Thu 17 Sep". Parsed as a local calendar date: these are date
// columns, and treating them as UTC slides them a day in Sydney.
function sessionDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('en-AU',
    { weekday: 'short', day: 'numeric', month: 'short' })
}
// "09:00:00" → "9:00am"
function sessionTime(t) {
  const [h, min] = String(t || '').split(':').map(Number)
  if (!Number.isFinite(h)) return ''
  const suffix = h < 12 ? 'am' : 'pm'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(min || 0).padStart(2, '0')}${suffix}`
}

export default function HolidayCoursesPage() {
  return <Suspense><HolidayCoursesInner /></Suspense>
}

function HolidayCoursesInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeParam = searchParams.get('subject')
  const scope = SUBJECT_FAMILY[scopeParam] ? scopeParam : null

  const [staff, setStaff] = useState(null)
  const [periods, setPeriods] = useState([])     // holiday terms that have classes
  const [rows, setRows] = useState([])           // holiday_booklets
  const [sessions, setSessions] = useState([])   // lessons of those classes
  const [master, setMaster] = useState([])       // the master workbook database
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // { cls, lesson, n, row|null }

  const canEdit = staff && ['admin', 'director'].includes(staff.role)

  const load = useCallback(async () => {
    const allTerms = await fetchAllTerms()
    const holidayTerms = (allTerms || []).filter(isHolidayTerm)
      // Newest first: planning is nearly always for the period coming up.
      .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))
    if (!holidayTerms.length) { setPeriods([]); setLoading(false); return }

    const { data: classes } = await supabase.from(T_CLASSES)
      .select('id, class_name, teacher, start_time, end_time, status, term_id, courses(course_code, course_name)')
      .in('term_id', holidayTerms.map((t) => t.id))
    const live = (classes || []).filter(isLiveClass)

    // The days of each course, straight off its schedule.
    const [{ data: lessons }, { data: booklets }] = await Promise.all([
      live.length
        ? supabase.from(T_LESSONS).select('id, class_id, lesson_date, start_time, end_time, status')
            .in('class_id', live.map((c) => c.id)).order('lesson_date')
        : Promise.resolve({ data: [] }),
      supabase.from(T_HOLIDAY_BOOKLETS).select('*'),
    ])
    // The master workbook database, for the picker and for showing a linked
    // workbook's live name and status rather than a copy taken at the time.
    const { data: master } = await supabase.from(T_BOOKLETS)
      .select('id, booklet_name, year, subject, topic, status, is_exam')
      .order('year').order('subject').order('booklet_name')
    setMaster(master || [])
    setSessions(lessons || [])
    setPeriods(holidayTerms
      .map((t) => ({ ...t, classes: live.filter((c) => c.term_id === t.id) }))
      .filter((t) => t.classes.length))
    setRows(booklets || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setStaff({ ...profile, role })
      load()
    })
  }, [router, load])

  // A hub link scopes the page to its subject family; the class's course code
  // names the subject, the same rule the term curriculum's class tabs use.
  const inScope = (cls) => !scope
    || SUBJECT_FAMILY[scope].includes(subjectFromCourseCode(cls.courses?.course_code))
  const visible = periods
    .map((p) => ({ ...p, classes: p.classes.filter(inScope) }))
    .filter((p) => p.classes.length)

  const daysFor = (cls) => sessions
    .filter((l) => l.class_id === cls.id)
    .sort((a, b) => String(a.lesson_date).localeCompare(String(b.lesson_date)))
  const bookletFor = (lesson) => rows.find((r) => r.lesson_id === lesson.id)
  /*
   * What a planned day displays: the master database's own row. Nothing is
   * copied across, so renaming a workbook or marking it Complete shows here.
   */
  const planned = (row) => {
    const wb = master.find((b) => b.id === row?.booklet_id)
    return {
      name: wb?.booklet_name || 'Workbook',
      topic: wb?.topic || '',
      status: wb?.status || 'Not Started',
      missing: !wb,   // linked to a workbook since deleted from the database
    }
  }

  const save = async (form) => {
    const payload = {
      lesson_id: editing.lesson.id,
      booklet_id: form.booklet_id,
      notes: (form.notes || '').trim() || null,
      updated_at: new Date().toISOString(),
    }
    if (editing.row) await supabase.from(T_HOLIDAY_BOOKLETS).update(payload).eq('id', editing.row.id)
    else await supabase.from(T_HOLIDAY_BOOKLETS).insert({ ...payload, created_by: staff?.full_name || null })
    setEditing(null); load()
  }

  const remove = async (row) => {
    if (!window.confirm(`Remove “${planned(row).name}” from this day?`)) return
    await supabase.from(T_HOLIDAY_BOOKLETS).delete().eq('id', row.id)
    setEditing(null); load()
  }

  if (!staff) return null

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={staff.full_name} isAdmin={canEdit} />

      <div className="bg-white border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-6">
          <h1 className="text-2xl font-bold text-[#062E63]">
            Holiday Courses{scope ? ` — ${SCOPE_LABEL[scope]}` : ''}
          </h1>
          <p className="text-sm text-[#2A2035]/50 mt-0.5">
            One workbook per day of each holiday class ·{' '}
            <Link href={`/tutor/booklets${scope ? `?subject=${scope}` : ''}`} className="text-[#325099] hover:underline">
              back to the term curriculum
            </Link>
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 md:px-10 py-6">
        {loading ? (
          <p className="text-sm text-[#2A2035]/40 animate-pulse py-20 text-center">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-[#DEE7FF] py-16 text-center">
            <p className="text-sm font-semibold text-[#2A2035]">
              No holiday courses{scope ? ` for ${SCOPE_LABEL[scope]}` : ''} yet.
            </p>
            <p className="text-xs text-[#2A2035]/50 mt-1 max-w-md mx-auto">
              A holiday course is a class created in a holiday period. Add one in the{' '}
              <Link href="/tutor/database" className="text-[#325099] hover:underline">database explorer</Link>
              {' '}and it appears here, ready to plan day by day.
            </p>
          </div>
        ) : visible.map((period) => (
          <div key={period.id} className="mb-9">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-[#EEF4FF] text-[#325099]">
                {periodName(period)}
              </span>
              <span className="text-[11px] text-[#2A2035]/40">{formatTermRange(period)}</span>
              <span className="text-[10px] text-[#2A2035]/30 font-medium">
                {period.classes.length} course{period.classes.length === 1 ? '' : 's'}
              </span>
              <div className="flex-1 h-px bg-[#E8EDF8]" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {period.classes.map((cls) => {
                const days = daysFor(cls)
                const filled = days.filter((l) => bookletFor(l)).length
                return (
                  <div key={cls.id} className="flex flex-col min-w-0">
                    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl mb-3 bg-white border border-[#E8EDF8]">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#062E63] truncate">{cls.class_name}</p>
                        <p className="text-[10px] text-[#2A2035]/45 truncate">
                          {cls.courses?.course_code || '—'}
                          {cls.teacher ? ` · ${cls.teacher}` : ''}
                        </p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white bg-[#325099] shrink-0">
                        {filled}/{days.length}
                      </span>
                    </div>

                    {days.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[#DEE7FF] px-3 py-5 text-center">
                        <p className="text-[11px] text-[#2A2035]/45">No sessions scheduled yet.</p>
                        <p className="text-[10px] text-[#2A2035]/35 mt-0.5">Add them to the class in the database explorer.</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {days.map((lesson, i) => {
                          const row = bookletFor(lesson)
                          // The day's label is its real date, so the plan reads
                          // the same as the timetable it is planned against.
                          const when = `${sessionDate(lesson.lesson_date)}${lesson.start_time ? ` · ${sessionTime(lesson.start_time)}` : ''}`
                          if (row) {
                            const p = planned(row)
                            const st = statusStyle(p.status)
                            return (
                              <div key={lesson.id} className="bg-white rounded-xl border border-[#E8EDF8] shadow-sm overflow-hidden">
                                <div className="px-3 pt-2.5 pb-2">
                                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#325099]">Day {i + 1}</span>
                                    <span className="text-[9px] text-[#2A2035]/45">{when}</span>
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                                      style={{ background: st.bg, color: st.fg }}>{p.status}</span>
                                  </div>
                                  <p className="text-[12px] font-bold text-[#062E63] leading-snug">{p.name}</p>
                                  {p.topic && <p className="text-[10px] text-[#2A2035]/50 mt-0.5">{p.topic}</p>}
                                  {p.missing && (
                                    <p className="text-[10px] text-[#B45309] mt-0.5">
                                      The workbook this day pointed at is no longer in the master database.
                                    </p>
                                  )}
                                  {row.notes && <p className="text-[10px] text-[#2A2035]/40 mt-1 line-clamp-2">{row.notes}</p>}
                                </div>
                                {canEdit && (
                                  <div className="px-3 pb-2.5 flex gap-2.5">
                                    <button onClick={() => setEditing({ cls, lesson, n: i + 1, row })}
                                      className="text-[10px] font-semibold text-[#325099] hover:underline">Edit</button>
                                    <button onClick={() => remove(row)}
                                      className="text-[10px] font-semibold text-[#2A2035]/30 hover:text-rose-500">Remove</button>
                                  </div>
                                )}
                              </div>
                            )
                          }
                          return (
                            <button key={lesson.id} disabled={!canEdit}
                              onClick={() => setEditing({ cls, lesson, n: i + 1, row: null })}
                              className={`rounded-xl border border-dashed border-[#DEE7FF] px-3 py-3 text-left transition ${
                                canEdit ? 'hover:border-[#325099] hover:bg-white' : 'cursor-default'}`}>
                              <span className="text-[9px] font-bold uppercase tracking-widest text-[#2A2035]/25">Day {i + 1}</span>
                              <span className="text-[9px] text-[#2A2035]/35 ml-1.5">{when}</span>
                              {canEdit && <span className="block text-[11px] text-[#2A2035]/35 mt-0.5">+ Add workbook</span>}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <DayModal
          master={master}
          defaultYear={yearFromCourseCode(editing.cls.courses?.course_code)}
          defaultSubject={subjectFromCourseCode(editing.cls.courses?.course_code)}
          day={editing.n}
          when={`${sessionDate(editing.lesson.lesson_date)}${editing.lesson.start_time ? ` · ${sessionTime(editing.lesson.start_time)}` : ''}`}
          courseName={editing.cls.class_name}
          row={editing.row}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/*
 * The one editor: what a day of the course is running.
 *
 * Two ways to answer. Pick the workbook from the master database — the usual
 * case, and the one that keeps the day's name and status true as the workbook
 * is written — or, when it does not exist yet, type the name it will have.
 */
/*
 * The one editor: which workbook a day of the course runs.
 *
 * The master database is the only source. A day used to be able to carry a
 * typed name instead, which went stale the moment the real workbook was
 * renamed or finished — so a day now points at a workbook or holds nothing.
 */
function DayModal({ day, when, courseName, row, master = [], defaultYear, defaultSubject, onSave, onClose }) {
  const [bookletId, setBookletId] = useState(row?.booklet_id || '')
  const [notes, setNotes] = useState(row?.notes || '')
  const [search, setSearch] = useState('')
  // The class's own year and subject to begin with, since that is nearly always
  // what a holiday course runs; searching looks across the whole database.
  const [scoped, setScoped] = useState(true)
  const [saving, setSaving] = useState(false)

  const q = search.trim().toLowerCase()
  const options = master
    .filter((b) => !b.is_exam)
    .filter((b) => !scoped || !defaultYear
      || (Number(b.year) === Number(defaultYear) && (!defaultSubject || b.subject === defaultSubject)))
    .filter((b) => !q || `${b.booklet_name} ${b.topic || ''}`.toLowerCase().includes(q))
    .slice(0, 60)
  const chosen = master.find((b) => b.id === bookletId)

  const submit = async () => {
    setSaving(true)
    try { await onSave({ booklet_id: bookletId, notes }) } finally { setSaving(false) }
  }

  const INP = 'w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#325099]'
  const LBL = 'text-[11px] font-semibold text-[#2A2035]/50 block mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-lg font-bold text-[#062E63]">{row ? 'Edit' : 'Add'} Day {day}</h2>
          <p className="text-xs text-[#2A2035]/50">{courseName}{when ? ` · ${when}` : ''}</p>
        </div>

        <div>
          <label className={LBL}>Workbook</label>
          <input autoFocus className={INP} value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the master database…" />
        </div>
        {defaultYear != null && (
          <label className="flex items-center gap-2 text-[11px] text-[#2A2035]/55 cursor-pointer">
            <input type="checkbox" checked={scoped} onChange={(e) => setScoped(e.target.checked)} />
            Only Year {defaultYear}{defaultSubject ? ` ${defaultSubject}` : ''}
          </label>
        )}
        <div className="border border-[#E8EDF8] rounded-xl divide-y divide-[#F0F4FF] max-h-64 overflow-y-auto">
          {options.length === 0 ? (
            <p className="text-xs text-[#2A2035]/40 px-3 py-6 text-center">
              No workbooks match{scoped ? ' — try unticking the year filter' : ''}.
            </p>
          ) : options.map((b) => (
            <button key={b.id} type="button" onClick={() => setBookletId(b.id)}
              className={`w-full text-left px-3 py-2 transition ${
                bookletId === b.id ? 'bg-[#EEF4FF]' : 'hover:bg-[#F8FAFF]'}`}>
              <p className="text-xs font-semibold text-[#062E63] truncate">{b.booklet_name}</p>
              <p className="text-[10px] text-[#2A2035]/45 truncate">
                Year {b.year} {b.subject}{b.topic ? ` · ${b.topic}` : ''} · {b.status}
              </p>
            </button>
          ))}
        </div>
        {chosen && <p className="text-[11px] text-[#325099] font-semibold">Selected: {chosen.booklet_name}</p>}

        <div>
          <label className={LBL}>Notes</label>
          <textarea className={`${INP} h-20 resize-none`} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the teacher needs to know about this day." />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button onClick={submit} disabled={saving || !bookletId}
            className="px-5 py-2.5 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl border border-[#DEE7FF] text-sm font-semibold text-[#2A2035]/60 hover:bg-[#F8FAFF] transition">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
