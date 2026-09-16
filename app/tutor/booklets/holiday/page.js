'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import { fetchAllTerms, formatTermRange } from '../../../../lib/terms'
import { T_HOLIDAY_BOOKLETS } from '../../../../lib/tables'
import { statusStyle, BOOKLET_STATUS } from '../../../../lib/resourceSubjects'
import { useCourseCurriculum } from '../../../../lib/courses'
import TutorNav from '../../../../components/TutorNav'

/*
 * Holiday Courses — /tutor/booklets/holiday?subject=Maths
 *
 * A holiday course is not a term: it runs for a handful of consecutive days in
 * one school-holiday period, with a workbook planned for each day. That does
 * not fit the term curriculum's term/week grid, so the material lives in its
 * own table (holiday_booklets) and is planned here instead.
 *
 * The grid reads holiday period across the top and day down the side, so a
 * year's whole holiday programme — this January's, last spring's — is visible
 * side by side while you plan the next one.
 */

const SUBJECT_FAMILY = {
  Maths: ['Maths', 'Standard Maths', 'Adv Maths', 'Ext 1 Maths', 'Ext 2 Maths'],
  English: ['English'],
  Chemistry: ['Chemistry'],
}
const SCOPE_LABEL = { Maths: 'Mathematics', English: 'English', Chemistry: 'Chemistry' }
// Years and subjects come from the courses table, same as the term curriculum,
// so both pages offer exactly the courses the database explorer lists.

// A holiday period is a term row numbered above the four teaching terms — the
// same marker the calendar uses to tell holidays from terms.
const isHolidayTerm = (t) => Number(t?.term_number) > 10
// "Term 3–4 Holidays 2026" → "Term 3–4 Holidays"; the year sits underneath.
const periodName = (t) => String(t?.name || '').replace(/\s*\d{4}\s*$/, '').trim() || 'Holidays'

const DEFAULT_DAYS = 5
const MAX_DAYS = 12

// useSearchParams needs a boundary for the static build, exactly as the term
// curriculum page does.
export default function HolidayCoursesPage() {
  return <Suspense><HolidayCoursesInner /></Suspense>
}

function HolidayCoursesInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeParam = searchParams.get('subject')
  const scope = SUBJECT_FAMILY[scopeParam] ? scopeParam : null

  const [staff, setStaff] = useState(null)
  const [terms, setTerms] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeYear, setActiveYear] = useState(8)
  const [activeSub, setActiveSub] = useState('Maths')
  const [editing, setEditing] = useState(null)   // { termId, day, row|null }

  const canEdit = staff && ['admin', 'director'].includes(staff.role)

  const load = useCallback(async () => {
    const [{ data }, allTerms] = await Promise.all([
      supabase.from(T_HOLIDAY_BOOKLETS).select('*').order('day'),
      fetchAllTerms(),
    ])
    setRows(data || [])
    // Newest period first: planning is nearly always for the one coming up.
    setTerms((allTerms || []).filter(isHolidayTerm)
      .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date))))
    setLoading(false)
  }, [])

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setStaff({ ...profile, role })
      load()
    })
  }, [router, load])

  const { years: courseYears, subjectsFor: courseSubjectsFor } = useCourseCurriculum()
  const subjectsForYear = (year) => {
    const all = courseSubjectsFor(year)
    return scope ? all.filter((s) => SUBJECT_FAMILY[scope].includes(s)) : all
  }
  const visibleYears = courseYears.filter((y) => subjectsForYear(y).length > 0)
  const subjects = subjectsForYear(activeYear)
  /*
   * The subject actually shown. Derived rather than corrected in an effect:
   * switching to a year (or a hub) that doesn't carry the chosen subject would
   * otherwise render one frame against a subject that has no tab.
   */
  const subject = subjects.includes(activeSub) ? activeSub : (subjects[0] || '')

  // The rows on screen: this year + subject, keyed by period and day.
  const cell = {}
  rows.filter((r) => Number(r.year) === Number(activeYear) && r.subject === subject)
    .forEach((r) => { cell[`${r.term_id}-${r.day}`] = r })

  // Days shown: the default course length, stretched to fit anything already
  // planned past it, so a longer course doesn't hide its own last days.
  const longestPlanned = Math.max(0, ...Object.values(cell).map((r) => Number(r.day) || 0))
  const dayCount = Math.min(MAX_DAYS, Math.max(DEFAULT_DAYS, longestPlanned))
  const [extraDays, setExtraDays] = useState(0)
  const days = Array.from({ length: Math.min(MAX_DAYS, dayCount + extraDays) }, (_, i) => i + 1)

  const save = async (form) => {
    const payload = {
      term_id: editing.termId, year: Number(activeYear), subject, day: Number(editing.day),
      booklet_name: (form.booklet_name || '').trim() || 'Untitled',
      topic: (form.topic || '').trim() || null,
      status: form.status || 'Not Started',
      notes: (form.notes || '').trim() || null,
      updated_at: new Date().toISOString(),
    }
    if (editing.row) {
      await supabase.from(T_HOLIDAY_BOOKLETS).update(payload).eq('id', editing.row.id)
    } else {
      await supabase.from(T_HOLIDAY_BOOKLETS).insert({ ...payload, created_by: staff?.full_name || null })
    }
    setEditing(null); load()
  }

  const remove = async (row) => {
    if (!window.confirm(`Remove “${row.booklet_name}” from this day?`)) return
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
            One workbook per day of a holiday course ·{' '}
            <Link href={`/tutor/booklets${scope ? `?subject=${scope}` : ''}`} className="text-[#325099] hover:underline">
              back to the term curriculum
            </Link>
          </p>
        </div>

        {/* Year tabs */}
        <div className="max-w-7xl mx-auto px-6 md:px-10 flex gap-1 overflow-x-auto">
          {visibleYears.map((y) => (
            <button key={y} onClick={() => { setActiveYear(y); setExtraDays(0) }}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
                y === activeYear ? 'border-[#325099] text-[#062E63]' : 'border-transparent text-[#2A2035]/45 hover:text-[#325099]'}`}>
              Year {y}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 md:px-10 py-6">
        {/* Subject tabs */}
        {subjects.length > 1 && (
          <div className="flex gap-1.5 mb-5 flex-wrap">
            {subjects.map((s) => (
              <button key={s} onClick={() => { setActiveSub(s); setExtraDays(0) }}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                  s === subject ? 'bg-[#325099] text-white border-[#325099]' : 'bg-white text-[#2A2035]/60 border-[#DEE7FF] hover:border-[#325099]'}`}>
                {s}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-[#2A2035]/40 animate-pulse py-20 text-center">Loading…</p>
        ) : terms.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-[#DEE7FF] py-16 text-center">
            <p className="text-sm font-semibold text-[#2A2035]">No holiday periods yet.</p>
            <p className="text-xs text-[#2A2035]/50 mt-1">
              Holiday courses are planned against a holiday period. Add one in Settings → Terms, then it appears here.
            </p>
          </div>
        ) : (
          <>
            <div className={`grid gap-4 ${terms.length === 1 ? '' : terms.length === 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
              {terms.map((t) => {
                const filled = days.filter((d) => cell[`${t.id}-${d}`]).length
                return (
                  <div key={t.id} className="flex flex-col min-w-0">
                    <div className="flex items-center justify-between px-3 py-2 rounded-xl mb-3 bg-[#EEF4FF]">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#325099] truncate">{periodName(t)}</p>
                        <p className="text-[10px] text-[#2A2035]/45">{formatTermRange(t)}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white bg-[#325099] shrink-0">
                        {filled}/{days.length}
                      </span>
                    </div>

                    <div className="flex flex-col gap-2">
                      {days.map((d) => {
                        const row = cell[`${t.id}-${d}`]
                        if (row) {
                          const st = statusStyle(row.status)
                          return (
                            <div key={d} className="bg-white rounded-xl border border-[#E8EDF8] shadow-sm overflow-hidden">
                              <div className="px-3 pt-2.5 pb-2">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className="text-[9px] font-bold uppercase tracking-widest text-[#325099]">Day {d}</span>
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                                    style={{ background: st.bg, color: st.fg }}>{row.status}</span>
                                </div>
                                <p className="text-[12px] font-bold text-[#062E63] leading-snug">{row.booklet_name}</p>
                                {row.topic && <p className="text-[10px] text-[#2A2035]/50 mt-0.5">{row.topic}</p>}
                                {row.notes && <p className="text-[10px] text-[#2A2035]/40 mt-1 line-clamp-2">{row.notes}</p>}
                              </div>
                              {canEdit && (
                                <div className="px-3 pb-2.5 flex gap-2.5">
                                  <button onClick={() => setEditing({ termId: t.id, day: d, row })}
                                    className="text-[10px] font-semibold text-[#325099] hover:underline">Edit</button>
                                  <button onClick={() => remove(row)}
                                    className="text-[10px] font-semibold text-[#2A2035]/30 hover:text-rose-500">Remove</button>
                                </div>
                              )}
                            </div>
                          )
                        }
                        return (
                          <button key={d} disabled={!canEdit}
                            onClick={() => setEditing({ termId: t.id, day: d, row: null })}
                            className={`rounded-xl border border-dashed border-[#DEE7FF] px-3 py-3 text-left transition ${
                              canEdit ? 'hover:border-[#325099] hover:bg-white' : 'cursor-default'}`}>
                            <span className="text-[9px] font-bold uppercase tracking-widest text-[#2A2035]/25">Day {d}</span>
                            {canEdit && <span className="block text-[11px] text-[#2A2035]/35 mt-0.5">+ Add workbook</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {canEdit && days.length < MAX_DAYS && (
              <button onClick={() => setExtraDays((n) => n + 1)}
                className="mt-4 text-xs font-semibold text-[#325099] hover:underline">
                + Add a day to every period
              </button>
            )}
          </>
        )}
      </div>

      {editing && (
        <DayModal
          day={editing.day}
          period={periodName(terms.find((t) => t.id === editing.termId))}
          row={editing.row}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/* The one editor: a day's workbook, created or edited in place. */
function DayModal({ day, period, row, onSave, onClose }) {
  const [form, setForm] = useState({
    booklet_name: row?.booklet_name || '',
    topic: row?.topic || '',
    status: row?.status || 'Not Started',
    notes: row?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const submit = async () => { setSaving(true); try { await onSave(form) } finally { setSaving(false) } }
  const INP = 'w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#325099]'
  const LBL = 'text-[11px] font-semibold text-[#2A2035]/50 block mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-lg font-bold text-[#062E63]">{row ? 'Edit' : 'Add'} Day {day}</h2>
          <p className="text-xs text-[#2A2035]/50">{period}</p>
        </div>
        <div>
          <label className={LBL}>Workbook name</label>
          <input autoFocus className={INP} value={form.booklet_name} onChange={set('booklet_name')} placeholder="e.g. Algebra Intensive — Day 1" />
        </div>
        <div>
          <label className={LBL}>Topic</label>
          <input className={INP} value={form.topic} onChange={set('topic')} placeholder="e.g. Linear Relationships" />
        </div>
        <div>
          <label className={LBL}>Status</label>
          <select className={INP} value={form.status} onChange={set('status')}>
            {Object.keys(BOOKLET_STATUS).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={LBL}>Notes</label>
          <textarea className={`${INP} h-20 resize-none`} value={form.notes} onChange={set('notes')} placeholder="Anything the author needs to know." />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button onClick={submit} disabled={saving || !form.booklet_name.trim()}
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
