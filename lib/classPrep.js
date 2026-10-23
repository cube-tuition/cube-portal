/*
 * Class prep — have the materials for each lesson been prepared?
 *
 * The Action Centre's Class prep card lists every lesson from today to six days
 * ahead (a rolling week: a lesson drops off once its day has passed, so a
 * Saturday class is still there on Saturday while next week's show too),
 * grouped by the class's materials owner (classes.materials_owner, set on the
 * Operations page). A lesson is prepared automatically once a booklet is
 * allocated to its class for that week on the curriculum page
 * (class_booklet_assignments; nobody ticks it). Printing is the one manual
 * tick (lesson_prep.printed_at). The morning job pushes each owner
 * tomorrow's lessons with no booklet allocated or not printed.
 *
 * Separately, 24 hours before each lesson, the materials owner is pushed if
 * the week's booklet is still not published (bookletDueNudges, run every 15
 * minutes by /api/reminders/upcoming and claimed in auto_reminders so it goes
 * once per lesson).
 *
 * buildPrepRows / groupPrep / prepNudges / bookletDueNudges are pure
 * (tests/classPrep.test.mjs); loadPrep reads through whichever Supabase
 * client it is given.
 */
import { isOneToOneClass } from './classFormat.js'

export const PREP_DAYS = 7
export const OWNERS = ['Ryan', 'Aiden']

export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const prepWindow = (today) => [today, addDays(today, PREP_DAYS - 1)]

const hhmm = (t) => String(t || '').slice(0, 5)
const firstName = (n) => String(n || '').trim().split(/\s+/)[0]

/*
 * One row per lesson to prepare:
 *   { lessonId, date, start, classId, label, owner, booklet, prepared }
 *   booklet: 'ready' (allocated, PDFs published) | 'unpublished' (allocated, no PDFs) | 'none'
 *   allocated: a booklet is allocated for the week — the lesson is prepared
 *   printed: { by, at } | null
 */
export function buildPrepRows({ lessons = [], classes = [], termNumberById = {}, assignments = [], booklets = [], students = {}, preps = [] }) {
  const cls = Object.fromEntries(classes.map(c => [c.id, c]))
  const bk = Object.fromEntries(booklets.map(b => [b.id, b]))
  const asg = {}
  for (const a of assignments) asg[`${a.class_id}:${a.term_number}:${a.week}`] = a.booklet_id
  const done = Object.fromEntries(preps.map(p => [p.lesson_id, p]))
  return lessons
    .filter(l => l.status !== 'cancelled' && !l.is_makeup && !l.lesson_type && cls[l.class_id])
    .map(l => {
      const c = cls[l.class_id]
      const termNo = termNumberById[c.term_id]
      let booklet = 'none'
      if (termNo && l.week) {
        const id = asg[`${c.id}:${termNo}:${l.week}`]
        booklet = !id ? 'none' : (bk[id]?.file_paths || []).length ? 'ready' : 'unpublished'
      }
      const who = isOneToOneClass(c) ? (students[c.id] || []).map(firstName).filter(Boolean).join(' & ') : ''
      const p = done[l.id] || {}
      return {
        lessonId: l.id, date: l.lesson_date, start: hhmm(l.start_time || c.start_time), classId: c.id,
        label: who ? `${c.class_name} · ${who}` : c.class_name,
        owner: OWNERS.includes(c.materials_owner) ? c.materials_owner : null,
        booklet, allocated: booklet !== 'none',
        printed: p.printed_at ? { by: p.printed_by_name || '', at: p.printed_at } : null,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.label.localeCompare(b.label))
}

/** { Ryan: rows, Aiden: rows, Unassigned: rows } — each in date and time order. */
export function groupPrep(rows) {
  const out = { Ryan: [], Aiden: [], Unassigned: [] }
  for (const r of rows) out[r.owner || 'Unassigned'].push(r)
  return out
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const dayLabel = (iso, today) => {
  if (iso === today) return 'Today'
  if (iso === addDays(today, 1)) return 'Tomorrow'
  const d = new Date(`${iso}T00:00:00Z`)
  return `${DAY[d.getUTCDay()]} ${d.getUTCDate()}`
}
export const fmt12 = (t) => {
  const [h, m] = String(t || '').split(':').map(Number)
  return Number.isFinite(h) ? `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}` : ''
}

/*
 * The morning nudge: tomorrow's lessons with no booklet allocated or not
 * printed yet, one push per owner.
 * Unassigned classes go to both directors. Returns [{ owner, push }].
 */
export function prepNudges(rows, tomorrow) {
  const todo = rows.filter(r => r.date === tomorrow && (!r.allocated || !r.printed))
  const by = {}
  for (const r of todo) for (const o of (r.owner ? [r.owner] : OWNERS)) (by[o] ||= []).push(r)
  return Object.entries(by).map(([owner, list]) => ({
    owner,
    push: {
      title: `📚 ${list.length} class${list.length === 1 ? '' : 'es'} tomorrow not ready yet`,
      body: list.map(r => {
        const missing = [!r.allocated && 'no booklet allocated', r.booklet === 'unpublished' && 'booklet not published', !r.printed && 'not printed'].filter(Boolean)
        return `${r.label}${r.start ? ` · ${fmt12(r.start)}` : ''} — ${missing.join(', ')}`
      }).join('\n'),
      url: '/tutor', tag: `prep-${tomorrow}-${owner}`,
    },
  }))
}

// When a lesson starts, as an instant: its date and time are Sydney local.
export function lessonStartUtc(dateISO, hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number)
  if (!dateISO || !Number.isFinite(h)) return null
  // Sydney's offset on that day (AEDT +11 or AEST +10), read from the clock.
  const probe = new Date(`${dateISO}T12:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hour12: false }).formatToParts(probe)
  const localHour = Number(parts.find(p => p.type === 'hour')?.value)
  const offset = ((localHour - 12) + 24) % 24          // hours ahead of UTC
  return new Date(Date.UTC(...dateISO.split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)), h - offset, m || 0))
}

/*
 * The 24-hour nudge: lessons starting within the next 24 hours whose week's
 * booklet is not published — none allocated, or allocated with no PDFs — one
 * push per lesson to its materials owner (both directors when unassigned),
 * each claimed by key so it is sent once. sentKeys: keys already claimed.
 * Returns [{ key, lessonId, startsAt, owners, push }].
 */
export const bookletNudgeKey = (lessonId) => `booklet:${lessonId}`
export function bookletDueNudges(rows, { now = new Date(), sentKeys = new Set() } = {}) {
  const out = []
  for (const r of rows) {
    if (r.booklet === 'ready') continue
    const key = bookletNudgeKey(r.lessonId)
    if (sentKeys.has(key)) continue
    const startsAt = lessonStartUtc(r.date, r.start)
    if (!startsAt) continue
    const hours = (startsAt - now) / 3600e3
    if (hours <= 0 || hours > 24) continue
    const why = r.booklet === 'none' ? 'no booklet allocated for this week' : 'a booklet is allocated but its PDFs aren’t published'
    out.push({
      key, lessonId: r.lessonId, startsAt, owners: r.owner ? [r.owner] : OWNERS,
      push: {
        title: `📕 ${r.label} — booklet not published`,
        body: `${r.date === new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(now) ? 'Today' : 'Tomorrow'}${r.start ? ` ${fmt12(r.start)}` : ''}: ${why}. Publish it from the builder, or allocate one on the curriculum page.`,
        url: `/tutor/classes/${r.classId}`, tag: key,
      },
    })
  }
  return out
}

/** Read everything the card (or the morning job) needs for [from, to]. */
export async function loadPrep(sb, from, to) {
  const { data: lessons, error } = await sb.from('lessons')
    .select('id, class_id, lesson_date, start_time, week, status, is_makeup, lesson_type')
    .gte('lesson_date', from).lte('lesson_date', to)
  if (error) throw error
  const classIds = [...new Set((lessons || []).map(l => l.class_id).filter(Boolean))]
  if (!classIds.length) return []
  const { data: classes } = await sb.from('classes').select('id, class_name, start_time, materials_owner, term_id, course_id, status').in('id', classIds)
  const live = (classes || []).filter(c => !c.status || c.status === 'active')
  const termIds = [...new Set(live.map(c => c.term_id).filter(Boolean))]
  const lessonIds = (lessons || []).map(l => l.id)
  const oneToOne = live.filter(c => isOneToOneClass(c)).map(c => c.id)
  const results = await Promise.all([
    termIds.length ? sb.from('terms').select('id, term_number').in('id', termIds) : { data: [] },
    sb.from('class_booklet_assignments').select('class_id, booklet_id, term_number, week').in('class_id', classIds),
    sb.from('lesson_prep').select('lesson_id, printed_by_name, printed_at').in('lesson_id', lessonIds),
    oneToOne.length ? sb.from('enrolments').select('class_id, students(full_name)').in('class_id', oneToOne).in('status', ['active', 'trial']) : { data: [] },
  ])
  const failed = results.find(r => r.error)
  if (failed) throw failed.error
  const [{ data: terms }, { data: assignments }, { data: preps }, { data: enr }] = results
  const bookletIds = [...new Set((assignments || []).map(a => a.booklet_id).filter(Boolean))]
  const { data: booklets } = bookletIds.length ? await sb.from('booklets').select('id, file_paths').in('id', bookletIds) : { data: [] }
  const students = {}
  for (const e of enr || []) if (e.students?.full_name) (students[e.class_id] ||= []).push(e.students.full_name)
  return buildPrepRows({
    lessons, classes: live, termNumberById: Object.fromEntries((terms || []).map(t => [t.id, t.term_number])),
    assignments, booklets, students, preps,
  })
}
