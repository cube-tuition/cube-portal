/**
 * lib/topicSync.js — one topic list, kept in two tables.
 *
 * The workbook Master Database (`topics`) and the Question Bank
 * (`qbank_topics`) each hold a topic list for a year and subject, and they are
 * meant to be the SAME list: a workbook on "Linear Relationships" and the bank's
 * "Linear Relationships" questions are the same topic seen from two screens.
 * They used to drift, because each page wrote only its own table.
 *
 * Every add / rename / delete now goes through here, so both sides move
 * together, and the caller shows the user what else will change before it does.
 *
 * The two tables join on (year, subject, name), not on an id — they were built
 * separately and neither carries a key into the other. That is also why a rename
 * has to rewrite `booklets.topic`, which stores the topic as a plain string.
 */
import { supabase } from './supabase'
import { T_QBANK_SUBJECTS, T_QBANK_TOPICS, T_QBANK_SUBTOPICS, T_QBANK_SKILLS } from './tables'

const clean = (s) => String(s ?? '').trim()

/** The qbank_subjects row for a year + subject, or null if the bank has none. */
async function qbankSubject(year, subject) {
  const { data } = await supabase.from(T_QBANK_SUBJECTS)
    .select('id').eq('year_level', year).eq('name', subject).maybeSingle()
  return data ?? null
}

/** The two topic rows — either may be null when only one side has the topic. */
export async function findPair(year, subject, name) {
  const n = clean(name)
  const [{ data: master }, subj] = await Promise.all([
    supabase.from('topics').select('id, name').eq('year', year).eq('subject', subject).eq('name', n).maybeSingle(),
    qbankSubject(year, subject),
  ])
  let qbank = null
  if (subj) {
    const { data } = await supabase.from(T_QBANK_TOPICS)
      .select('id, name, sort_order').eq('subject_id', subj.id).eq('name', n).maybeSingle()
    qbank = data ?? null
  }
  return { master: master ?? null, qbank, subjectId: subj?.id ?? null }
}

/**
 * What is attached to this topic on each side. Used both to word the
 * confirmation and to refuse a delete that would take questions with it.
 */
export async function topicImpact(year, subject, name) {
  const pair = await findPair(year, subject, name)
  const out = { ...pair, questions: 0, subtopics: 0, skills: 0, booklets: 0 }
  const jobs = [
    supabase.from('booklets').select('id', { count: 'exact', head: true })
      .eq('year', year).eq('subject', subject).eq('topic', clean(name))
      .then(({ count }) => { out.booklets = count ?? 0 }),
  ]
  if (pair.qbank) {
    jobs.push(
      supabase.from('qbank_questions').select('id', { count: 'exact', head: true })
        .eq('topic_id', pair.qbank.id).then(({ count }) => { out.questions = count ?? 0 }),
      supabase.from(T_QBANK_SUBTOPICS).select('id', { count: 'exact', head: true })
        .eq('topic_id', pair.qbank.id).then(({ count }) => { out.subtopics = count ?? 0 }),
      supabase.from(T_QBANK_SKILLS).select('id', { count: 'exact', head: true })
        .eq('topic_id', pair.qbank.id).then(({ count }) => { out.skills = count ?? 0 }),
    )
  }
  await Promise.all(jobs)
  return out
}

/** True when deleting would destroy work rather than just tidy a list. */
export const deleteBlocked = (impact) => impact.questions > 0 || impact.booklets > 0

/** Add the topic to whichever side does not have it yet. */
export async function mirrorAdd(year, subject, name) {
  const n = clean(name)
  if (!n) return { error: 'A topic needs a name.' }
  const pair = await findPair(year, subject, n)
  if (!pair.master) {
    const { error } = await supabase.from('topics').insert({ year, subject, name: n })
    if (error) return { error: error.message }
  }
  if (!pair.qbank && pair.subjectId) {
    const { count } = await supabase.from(T_QBANK_TOPICS)
      .select('id', { count: 'exact', head: true }).eq('subject_id', pair.subjectId)
    const { error } = await supabase.from(T_QBANK_TOPICS)
      .insert({ subject_id: pair.subjectId, name: n, sort_order: count ?? 0 })
    if (error) return { error: error.message }
  }
  return { ok: true }
}

/**
 * Rename on both sides, and rewrite the booklets that name the topic as a
 * string. If the new name already exists on one side, that side is left alone
 * rather than creating a duplicate — merging topics is a separate, destructive
 * operation and is not something a rename should do silently.
 */
export async function mirrorRename(year, subject, from, to) {
  const a = clean(from); const b = clean(to)
  if (!b) return { error: 'A topic needs a name.' }
  if (a === b) return { ok: true }
  const [src, dst] = await Promise.all([findPair(year, subject, a), findPair(year, subject, b)])
  if (src.master && !dst.master) {
    const { error } = await supabase.from('topics').update({ name: b }).eq('id', src.master.id)
    if (error) return { error: error.message }
  }
  if (src.qbank && !dst.qbank) {
    const { error } = await supabase.from(T_QBANK_TOPICS).update({ name: b }).eq('id', src.qbank.id)
    if (error) return { error: error.message }
  }
  await supabase.from('booklets').update({ topic: b })
    .eq('year', year).eq('subject', subject).eq('topic', a)
  return { ok: true }
}

/** Delete from both sides. Callers must check deleteBlocked() first. */
export async function mirrorDelete(year, subject, name) {
  const n = clean(name)
  const pair = await findPair(year, subject, n)
  if (pair.master) {
    const { error } = await supabase.from('topics').delete().eq('id', pair.master.id)
    if (error) return { error: error.message }
  }
  if (pair.qbank) {
    const { error } = await supabase.from(T_QBANK_TOPICS).delete().eq('id', pair.qbank.id)
    if (error) return { error: error.message }
  }
  return { ok: true }
}
