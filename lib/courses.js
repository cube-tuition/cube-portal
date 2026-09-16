import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { T_COURSES } from './tables'

/*
 * The courses CUBE actually runs, as the source of the curriculum's tabs.
 *
 * The year and subject tabs used to be hard-coded lists, so they drifted from
 * the courses table: a year the college teaches (Year 4) had no curriculum,
 * while streams it does not run still offered empty grids. They are now read
 * off `courses` — the rows created in the database explorer — so adding a
 * course there is all it takes for its curriculum to appear.
 *
 * Retired courses keep their tab. An inactive row is one CUBE has stopped
 * enrolling, not one whose material should become unreachable — and whole
 * cohorts sit inactive between rollovers.
 */

// Subject named by a course code: "9.MC" → Maths, "11.M3C" → Ext 1 Maths.
// Senior maths splits into streams by the digit; juniors have one of each.
export function subjectFromCourseCode(code) {
  const parts = String(code || '').split('.')
  const yr = parseInt(parts[0], 10)
  const suffix = parts[1] || ''
  if (!suffix || !Number.isFinite(yr)) return null
  if (yr >= 11) {
    if (suffix.startsWith('M1')) return 'Standard Maths'
    if (suffix.startsWith('M2')) return 'Adv Maths'
    if (suffix.startsWith('M3')) return 'Ext 1 Maths'
    if (suffix.startsWith('M4')) return 'Ext 2 Maths'
    if (suffix.startsWith('E'))  return 'English'
    if (suffix.startsWith('C'))  return 'Chemistry'
    if (suffix.startsWith('P'))  return 'Physics'
    if (suffix.startsWith('S'))  return 'Science'
    return null
  }
  if (suffix.startsWith('M')) return 'Maths'
  if (suffix.startsWith('E')) return 'English'
  if (suffix.startsWith('S')) return 'Science'
  return null
}

// Year a course code names, or null for the codes that carry no year
// (HW help, speaking development — real courses, but not curriculum ones).
export function yearFromCourseCode(code) {
  const yr = parseInt(String(code || '').split('.')[0], 10)
  return Number.isFinite(yr) ? yr : null
}

// Subjects read left to right the way a timetable does, with anything
// unrecognised kept (alphabetically) rather than dropped.
const SUBJECT_ORDER = ['Maths', 'Standard Maths', 'Adv Maths', 'Ext 1 Maths', 'Ext 2 Maths',
  'English', 'Chemistry', 'Physics', 'Science']
const subjectRank = (s) => {
  const i = SUBJECT_ORDER.indexOf(s)
  return i === -1 ? SUBJECT_ORDER.length : i
}

/** Group course rows into { years: [...], subjectsByYear: { year: [subject] } }. */
export function curriculumFromCourses(courses) {
  const byYear = {}
  for (const c of courses || []) {
    const year = yearFromCourseCode(c.course_code)
    const subject = subjectFromCourseCode(c.course_code)
    if (year == null || !subject) continue
    ;(byYear[year] ||= new Set()).add(subject)
  }
  const subjectsByYear = {}
  Object.entries(byYear).forEach(([y, set]) => {
    subjectsByYear[y] = [...set].sort((a, b) => subjectRank(a) - subjectRank(b) || a.localeCompare(b))
  })
  return {
    years: Object.keys(subjectsByYear).map(Number).sort((a, b) => a - b),
    subjectsByYear,
  }
}

// What the curriculum falls back to while the courses load, or if the table
// cannot be read: the lists the pages carried before, so a fetch failure costs
// a couple of tabs rather than the whole page.
const FALLBACK = {
  years: [5, 6, 7, 8, 9, 10, 11, 12],
  subjectsByYear: {
    11: ['Standard Maths', 'Adv Maths', 'Ext 1 Maths', 'English', 'Chemistry'],
    12: ['Standard Maths', 'Adv Maths', 'Ext 1 Maths', 'Ext 2 Maths', 'English', 'Chemistry'],
  },
}
const fallbackSubjects = (year) => FALLBACK.subjectsByYear[year] || ['Maths', 'English']

/**
 * The curriculum's years and subjects, from the courses table.
 * `subjectsFor(year)` answers for one year, falling back while loading.
 */
export function useCourseCurriculum() {
  const [data, setData] = useState(null)

  useEffect(() => {
    let dead = false
    supabase.from(T_COURSES).select('course_code').then(({ data: rows, error }) => {
      if (dead) return
      setData(error || !rows?.length ? null : curriculumFromCourses(rows))
    })
    return () => { dead = true }
  }, [])

  const years = data?.years?.length ? data.years : FALLBACK.years
  const subjectsFor = (year) => data?.subjectsByYear?.[year] || (data ? [] : fallbackSubjects(year))
  return { years, subjectsFor, loaded: !!data }
}
