/*
 * Booklet improvement checklists.
 *
 * Two tickable lists live on every booklet, separate from its free-text notes:
 *   fixes       — errors to correct (typos, wrong answers)
 *   suggestions — ideas for improving the booklet
 *
 * Entries come from two places: a tutor's report on the lesson page (one entry
 * per list per lesson, rewritten in place when they re-save), and staff typing
 * straight onto the booklet. Ticked entries stay on the list, struck through,
 * so the record of what was raised and dealt with is never lost.
 *
 * All mutations go through the SQL functions in
 * migrations/20260801b_booklet_checklists.sql — several classes can use the same
 * booklet on the same evening, and a client-side read-modify-write would let one
 * tutor's report silently overwrite another's.
 */
import { supabase } from './supabase'

export const LISTS = [
  { key: 'fixes',       label: 'Fixes',       blurb: 'Errors to correct' },
  { key: 'suggestions', label: 'Suggestions', blurb: 'Ideas for improvement' },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 'YYYY-MM-DD' → '1 Aug 2026'. Parsed by hand rather than via Date so the label
// can't drift a day either way on a timezone boundary.
export function fmtItemDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return ''
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Build an entry. `lessonId` null ⇒ a staff-authored item. */
export function makeItem({ text, lessonId = null, className = null, date = null, author = null }) {
  const today = new Date().toISOString().slice(0, 10)
  return {
    id: newId(),
    text: String(text || '').trim(),
    done: false, done_at: null, done_by: null,
    source: lessonId ? 'lesson' : 'staff',
    lesson_id: lessonId ?? null,
    class_name: className || null,
    date: date || today,
    author: author || null,
    created_at: new Date().toISOString(),
  }
}

/** Open items first (newest last), then ticked ones. */
export function sortItems(items) {
  return [...(items || [])].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
}

export const openCount = (items) => (items || []).filter(i => !i.done).length

/** Total open across both lists — what the booklet cards badge. */
export const openTotal = (b) => openCount(b?.fixes) + openCount(b?.suggestions)

// ── Mutations ───────────────────────────────────────────────────────────────
// Each returns the resulting array for that list.

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data || []
}

/** Submit ONE item from a lesson. Each call appends a new entry, so a tutor
 *  reporting several problems sends them one at a time. */
export function addLessonItem({ bookletId, list, lessonId, text, className, date, author }) {
  return rpc('booklet_checklist_add', {
    p_booklet_id: bookletId, p_list: list,
    p_item: makeItem({ text, lessonId, className, date, author }),
  })
}

export function addStaffItem({ bookletId, list, text, author }) {
  return rpc('booklet_checklist_add', {
    p_booklet_id: bookletId, p_list: list,
    p_item: makeItem({ text, author }),
  })
}

export function setItemDone({ bookletId, list, itemId, done, by }) {
  return rpc('booklet_checklist_set_done', {
    p_booklet_id: bookletId, p_list: list, p_item_id: itemId, p_done: done, p_by: by || null,
  })
}

/**
 * Remove an item. Pass `lessonId` from the lesson page — a tutor may only remove
 * an item that lesson submitted, and only while it is still open. Omit it on the
 * booklet screen, where staff may remove staff-authored items. The rule is
 * enforced in SQL, not here.
 */
export function removeItem({ bookletId, list, itemId, lessonId = null }) {
  return rpc('booklet_checklist_remove_item', {
    p_booklet_id: bookletId, p_list: list, p_item_id: itemId, p_lesson_id: lessonId,
  })
}

/** The entries a given lesson contributed to a list, oldest first. */
export function itemsForLesson(items, lessonId) {
  if (!lessonId) return []
  return (items || []).filter(i => String(i.lesson_id) === String(lessonId))
}
