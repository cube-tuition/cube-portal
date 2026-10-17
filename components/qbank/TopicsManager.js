'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getAuthProfile } from '../../lib/getProfile'
import TutorNav from '../TutorNav'
import {
  T_QBANK_SUBJECTS, T_QBANK_TOPICS, T_QBANK_SUBTOPICS, T_QBANK_SKILLS,
} from '../../lib/tables'
import { SUBJECT_FAMILIES, SCOPE_LABEL, familyOfSubject, stageOfYear, STAGE_LABEL, subjectYearLabel } from '../../lib/qbank'
import { topicImpact, mirrorAdd, mirrorRename, mirrorDelete } from '../../lib/topicSync'
import TopicSyncModal from '../TopicSyncModal'
import { MATHS_STAGES, mathsStageOf, mathsStageLabel, groupRowsByName } from '../../lib/mathsStages'

/*
 * Topics — the years & courses, topics, subtopics and skills that questions
 * and workbooks are filed under (formerly "Categories" in the question bank).
 * Each subject's Resources hub has its own page (/tutor/resources/<subject>/
 * topics) scoped to that subject; /tutor/qbank/categories forwards there.
 */

const YEARS = [5, 6, 7, 8, 9, 10, 11, 12]

// scope: a SUBJECT_FAMILIES key (the subject column shows only that family),
// or null for every subject. backHref/backLabel: where the "←" link goes.
export default function TopicsManager({ scope: scopeProp = null, backHref = '/tutor/qbank', backLabel = 'Question bank' }) {
  const router = useRouter()
  const scope = SUBJECT_FAMILIES[scopeProp] ? scopeProp : null
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)

  const [subjects, setSubjects] = useState([])
  const [topics, setTopics] = useState([])
  const [subtopics, setSubtopics] = useState([])
  const [skills, setSkills] = useState([])
  const [subjectId, setSubjectId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [subtopicId, setSubtopicId] = useState('')

  // new-row inputs
  const [addingSubject, setAddingSubject] = useState(false)
  const [newSubYear, setNewSubYear] = useState(7)
  const [newSubName, setNewSubName] = useState('')
  const [newTopic, setNewTopic] = useState('')
  // { action, name, newName, impact } while a topic edit waits on the modal.
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [newSubtopic, setNewSubtopic] = useState('')
  const [subEdit, setSubEdit] = useState(null)   // { key, ids, text } while a subtopic is edited in place
  const [newSkill, setNewSkill] = useState('')

  const reload = useCallback(async () => {
    const [s, t, sub, k] = await Promise.all([
      supabase.from(T_QBANK_SUBJECTS).select('*').order('year_level').order('sort_order').order('name'),
      supabase.from(T_QBANK_TOPICS).select('*').order('sort_order').order('name'),
      supabase.from(T_QBANK_SUBTOPICS).select('*').order('sort_order').order('name'),
      supabase.from(T_QBANK_SKILLS).select('*').order('sort_order').order('name'),
    ])
    setSubjects(s.data || []); setTopics(t.data || []); setSubtopics(sub.data || []); setSkills(k.data || [])
  }, [])

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true); reload()
    })
  }, [router, reload])

  // A Maths stage (Years 5–6, 7–8, 9–10) is one entry: its years share one
  // topic list. subjectId is then 'stage:<n>' and the stage's year rows are its
  // members; every topic and subtopic edit is made in each member year.
  const activeStage = MATHS_STAGES.find((st) => `stage:${st.stage}` === subjectId) || null
  const memberSubjects = activeStage
    ? subjects.filter((s) => s.name === 'Maths' && activeStage.years.includes(Number(s.year_level))).sort((a, b) => a.year_level - b.year_level)
    : subjects.filter((s) => s.id === subjectId)
  const yearOfSubject = Object.fromEntries(subjects.map((s) => [s.id, s.year_level]))
  const yearOfTopic = Object.fromEntries(topics.map((t) => [t.id, yearOfSubject[t.subject_id]]))
  // Topics and subtopics are shown as ITEMS — one per name across the member
  // years (simply one row each outside a stage). topicId / subtopicId hold an
  // item's key; item.rows are the year rows behind it.
  const topicItems = groupRowsByName(topics.filter((t) => memberSubjects.some((m) => m.id === t.subject_id)), (t) => yearOfSubject[t.subject_id])
  const topicItem = topicItems.find((i) => i.key === topicId) || null
  const subtopicItems = topicItem
    ? groupRowsByName(subtopics.filter((st) => topicItem.rows.some((t) => t.id === st.topic_id)), (st) => yearOfTopic[st.topic_id])
    : []
  // "Y7 only" while a stage's two years don't yet agree on an item.
  const onlyIn = (item) => (activeStage && item.years.length < memberSubjects.length ? `Y${item.years.join(' & ')} only` : null)
  // Skills are shared across a whole stage, not owned by one year: editing the
  // list from Year 8 edits the same list Years 7 and 9-12 see. The heading above
  // the column says so, because the change is invisible otherwise.
  const activeSubject = memberSubjects[0] || null
  // Chemistry files by the syllabus's own words: modules and inquiry questions
  // (the same topic / subtopic rows underneath).
  const isChem = (scope || (activeSubject && familyOfSubject(activeSubject.name))) === 'Chemistry'
  const L = isChem
    ? { Topics: 'Modules', topic: 'module', Subtopics: 'Inquiry Questions', subtopic: 'inquiry question' }
    : { Topics: 'Topics', topic: 'topic', Subtopics: 'Subtopics', subtopic: 'subtopic' }
  const skillScope = activeSubject
    ? { family: familyOfSubject(activeSubject.name), stage: stageOfYear(activeSubject.year_level) }
    : null
  const skillsForSubject = skillScope
    ? skills.filter((s) => s.family === skillScope.family && s.stage === skillScope.stage)
    : []
  // One row per (year, stream), sorted, with no year sub-headings: scoped to a
  // family the heading and the row said the same thing, so the column read
  // "Year 5 / Maths, Year 6 / Maths, ..." all the way down.
  const subjectRows = subjects
    .filter((s) => !scope || SUBJECT_FAMILIES[scope].includes(s.name))
    .sort((a, b) => a.year_level - b.year_level || a.name.localeCompare(b.name))
  // The column's entries: Maths Years 5–10 collapse into their stages.
  const yearEntries = []
  for (const s of subjectRows) {
    const st = mathsStageOf(s)
    if (!st) { yearEntries.push({ key: s.id, subject: s }); continue }
    if (!yearEntries.some((e) => e.key === `stage:${st.stage}`)) yearEntries.push({ key: `stage:${st.stage}`, stage: st })
  }

  // ── Mutations ───────────────────────────────────────────────────────────────
  const addSubject = async () => {
    // Scoped to a family, the stream is almost always just the family itself, so
    // a blank name means "the ordinary course for that year" — pick a year, press
    // add. A name is only typed for a senior stream ("Ext 1 Maths").
    const name = newSubName.trim() || (scope || '')
    if (!name) return
    const { error } = await supabase.from(T_QBANK_SUBJECTS)
      .insert({ year_level: Number(newSubYear), name })
    if (error) { alert(error.message); return }
    setNewSubName(''); setAddingSubject(false); reload()
  }
  // Topics are shared with the workbook Master Database, so every topic edit is
  // proposed to the user first and then written to both sides by lib/topicSync.
  // Subjects, subtopics and skills belong to the bank alone and are unaffected.
  // A stage edit is the same edit in each of its years; the confirmation adds
  // up what is attached across them. mirrorAdd skips a year that already has
  // the topic and rename/delete skip a year that doesn't, so each year can
  // simply be given the edit.
  const proposeTopic = async (action, name, newName) => {
    if (!memberSubjects.length || !name) return
    setPending({ action, name, newName, impact: null })
    const per = await Promise.all(memberSubjects.map((m) => topicImpact(m.year_level, m.name, name)))
    const sum = (k) => per.reduce((n, x) => n + (x[k] || 0), 0)
    const impact = {
      master: per.find((x) => x.master)?.master || null, qbank: per.find((x) => x.qbank)?.qbank || null,
      questions: sum('questions'), subtopics: sum('subtopics'), skills: sum('skills'), booklets: sum('booklets'),
    }
    setPending({ action, name, newName, impact })
  }
  const confirmTopic = async () => {
    const { action, name, newName } = pending
    setBusy(true); setErr('')
    let res = { ok: true }
    for (const m of memberSubjects) {
      res = action === 'add'    ? await mirrorAdd(m.year_level, m.name, name)
          : action === 'rename' ? await mirrorRename(m.year_level, m.name, name, newName)
          :                       await mirrorDelete(m.year_level, m.name, name)
      if (res.error) break
    }
    setBusy(false)
    if (res.error) { setErr(res.error); return }
    if (action === 'add') setNewTopic('')
    if (topicItem && topicItem.name === name) {
      if (action === 'delete') { setTopicId(''); setSubtopicId('') }
      if (action === 'rename') setTopicId(String(newName).trim().toLowerCase())
    }
    setPending(null); reload()
  }

  const addTopic = async () => {
    if (!newTopic.trim() || !subjectId) return
    await proposeTopic('add', newTopic.trim())
  }
  const addSubtopic = async () => {
    if (!newSubtopic.trim() || !topicItem) return
    // Into the topic in every year of the item (both years of a stage).
    await supabase.from(T_QBANK_SUBTOPICS).insert(topicItem.rows.map((t) => ({ topic_id: t.id, name: cleanMultiline(newSubtopic), sort_order: subtopicItems.length })))
    setNewSubtopic(''); reload()
  }
  const addSkill = async () => {
    if (!newSkill.trim() || !skillScope) return
    // subject_id/topic_id/subtopic_id stay null — a stage's list belongs to no
    // single year. A duplicate name in the same list is refused by the database.
    const { error } = await supabase.from(T_QBANK_SKILLS).insert({
      family: skillScope.family, stage: skillScope.stage,
      subject_id: null, topic_id: null, subtopic_id: null,
      name: newSkill.trim(), sort_order: skillsForSubject.length,
    })
    if (error) { alert(/duplicate|unique/i.test(error.message)
      ? `"${newSkill.trim()}" is already in this stage's skill list.` : error.message); return }
    setNewSkill(''); reload()
  }

  // Subtopics (Chemistry's inquiry questions) are often a syllabus dot point
  // with an indented list under it, so their text keeps line breaks and indents:
  // Shift+Enter starts a new line, Tab indents the line, Shift+Tab outdents it.
  const INDENT = '    '
  const multilineKeys = (e, value, setValue, onSubmit) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); return }
    if (e.key !== 'Tab') return
    e.preventDefault()
    const ta = e.currentTarget
    const { selectionStart: a, selectionEnd: b } = ta
    const lineStart = value.lastIndexOf('\n', a - 1) + 1
    let next, caret
    if (e.shiftKey) {
      const lead = value.slice(lineStart).match(/^ {1,4}|^\t/)?.[0] || ''
      next = value.slice(0, lineStart) + value.slice(lineStart + lead.length)
      caret = Math.max(lineStart, a - lead.length)
    } else {
      next = value.slice(0, lineStart) + INDENT + value.slice(lineStart)
      caret = a + INDENT.length
    }
    setValue(next)
    requestAnimationFrame(() => { ta.selectionStart = caret; ta.selectionEnd = caret + (b - a) })
  }
  const cleanMultiline = (t) => String(t || '').replace(/^\s*\n/, '').trimEnd()
  const saveSubEdit = async () => {
    const name = cleanMultiline(subEdit?.text)
    if (!subEdit || !name.trim()) { setSubEdit(null); return }
    await supabase.from(T_QBANK_SUBTOPICS).update({ name }).in('id', subEdit.ids)
    setSubEdit(null); reload()
  }
  const linesOf = (t) => Math.min(10, Math.max(1, String(t || '').split('\n').length))

  const rename = async (table, id, name) => {
    if (name == null) return
    if (table === T_QBANK_TOPICS) {
      const old = topics.find((t) => t.id === id)?.name
      if (old && old !== name.trim()) await proposeTopic('rename', old, name.trim())
      return
    }
    await supabase.from(table).update({ name }).eq('id', id); reload()
  }
  const remove = async (table, id, label) => {
    if (table === T_QBANK_TOPICS) { await proposeTopic('delete', label); return }
    // Questions are never deleted with their taxonomy: topic_id, subtopic_id and
    // skill_id are all ON DELETE SET NULL, so the question stays in the bank and
    // simply loses that tag. Only the rows below it in the list go with it.
    const inside = table === T_QBANK_SUBJECTS ? ` This also removes its ${L.Topics.toLowerCase()}, ${L.Subtopics.toLowerCase()} and skills.`
                 : table === T_QBANK_SUBTOPICS ? ' This also removes the skills under it.'
                 : ''
    if (!confirm(`Delete "${label}"?${inside} Questions are kept — they stay in the bank with no ${L.topic} allocated, ready to be re-tagged.`)) return
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) { alert(error.message); return }
    if (table === T_QBANK_SUBJECTS && id === subjectId) { setSubjectId(''); setTopicId(''); setSubtopicId('') }
    if (table === T_QBANK_TOPICS && id === topicId) { setTopicId(''); setSubtopicId('') }
    if (table === T_QBANK_SUBTOPICS && id === subtopicId) setSubtopicId('')
    reload()
  }
  // Reorder an item list (topics / subtopics): every row behind each item takes
  // the item's new position, so a stage's years keep the same order.
  const moveItem = async (table, items, item, dir) => {
    const i = items.findIndex((x) => x.key === item.key)
    const j = i + dir
    if (i < 0 || j < 0 || j >= items.length) return
    const next = [...items]; [next[i], next[j]] = [next[j], next[i]]
    await Promise.all(next.flatMap((it, k) => it.rows.filter((r) => r.sort_order !== k)
      .map((r) => supabase.from(table).update({ sort_order: k }).eq('id', r.id))))
    reload()
  }
  const removeSubtopicItem = async (item) => {
    if (!confirm(`Delete "${item.name.split('\n')[0]}"${item.rows.length > 1 ? ` from Years ${item.years.join(' and ')}` : ''}? This also removes the skills under it. Questions are kept — they stay in the bank with no ${L.subtopic} allocated, ready to be re-tagged.`)) return
    const { error } = await supabase.from(T_QBANK_SUBTOPICS).delete().in('id', item.rows.map((r) => r.id))
    if (error) { alert(error.message); return }
    if (subtopicId === item.key) setSubtopicId('')
    reload()
  }
  const move = async (table, list, item, dir) => {
    const idx = list.findIndex((x) => x.id === item.id)
    const swap = list[idx + dir]
    if (!swap) return
    await Promise.all([
      supabase.from(table).update({ sort_order: swap.sort_order ?? 0 }).eq('id', item.id),
      supabase.from(table).update({ sort_order: item.sort_order ?? 0 }).eq('id', swap.id),
    ])
    reload()
  }

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const Row = ({ children }) => (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#F8FAFF] group">{children}</div>
  )
  const editBtn = 'text-[11px] text-[#2A2035]/30 hover:text-[#325099] md:opacity-0 md:group-hover:opacity-100 max-md:text-[#2A2035]/45 max-md:min-w-8 max-md:py-2'

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-7xl mx-auto px-4 pt-5 md:px-6 md:pt-8 pb-16">
        <Link href={backHref} className="text-xs text-[#325099] hover:underline">← {backLabel}</Link>
        <h1 className="text-2xl font-bold text-[#062E63] mt-1">Topics{scope ? ` — ${SCOPE_LABEL[scope]}` : ''}</h1>
        <p className="text-xs text-[#2A2035]/50 mt-0.5 mb-4">What questions and workbooks are filed under — shared by the question bank and the workbook Master Database.</p>

        {/* Years and modules are short labels; inquiry questions are whole syllabus
            dot points, so they get the wide column, with skills under them. */}
        <div className="grid gap-4 max-md:mt-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2.4fr)]">
          {/* Subjects */}
          <div className="bg-white rounded-2xl border border-[#F0F4FF] p-4">
            <h2 className="text-sm font-bold text-[#062E63]">Years &amp; courses</h2>
            <p className="text-[11px] text-[#2A2035]/45 mb-2">One row per year and course{yearEntries.some((e) => e.stage) ? ' — Maths Years 5–10 by stage, each stage one shared list' : ''}.</p>
            <button onClick={() => { setNewSubName(''); setAddingSubject(true) }}
              className="w-full mb-3 px-3 py-1.5 max-md:py-2.5 rounded-lg border border-dashed border-[#BACBFF] text-xs font-semibold text-[#325099] hover:bg-[#F5F8FF] transition">
              + Add year or course
            </button>
            <div className="max-h-[60vh] overflow-y-auto">
              {yearEntries.length === 0 && <p className="text-xs text-[#2A2035]/30 italic px-3 py-3">No years yet.</p>}
              {yearEntries.map((e) => e.stage ? (
                <Row key={e.key}>
                  <button onClick={() => { setSubjectId(e.key); setTopicId(''); setSubtopicId('') }}
                    className={`flex-1 min-w-0 break-words text-left text-sm max-md:py-1 ${subjectId === e.key ? 'font-bold text-[#325099]' : 'text-[#2A2035]'}`}>
                    {mathsStageLabel(e.stage)}
                    {!scope && <span className="text-[11px] text-[#2A2035]/35 ml-1.5">Maths</span>}
                  </button>
                </Row>
              ) : (
                <Row key={e.key}>
                  <button onClick={() => { setSubjectId(e.key); setTopicId(''); setSubtopicId('') }}
                    className={`flex-1 min-w-0 break-words text-left text-sm max-md:py-1 ${subjectId === e.key ? 'font-bold text-[#325099]' : 'text-[#2A2035]'}`}>
                    {subjectYearLabel(e.subject, familyOfSubject(e.subject.name))}
                    {!scope && <span className="text-[11px] text-[#2A2035]/35 ml-1.5">{familyOfSubject(e.subject.name)}</span>}
                  </button>
                  <button className={editBtn} onClick={() => rename(T_QBANK_SUBJECTS, e.subject.id, prompt('Rename subject', e.subject.name))}>edit</button>
                  <button className={editBtn} onClick={() => remove(T_QBANK_SUBJECTS, e.subject.id, e.subject.name)}>✕</button>
                </Row>
              ))}
            </div>
          </div>

          {/* Topics */}
          <div className="bg-white rounded-2xl border border-[#F0F4FF] p-4">
            <h2 className="text-sm font-bold text-[#062E63] mb-2">{L.Topics}</h2>
            {!subjectId ? (
              <p className="text-xs text-[#2A2035]/40 italic px-3 py-6">Select a subject →</p>
            ) : (
              <>
                <div className="flex gap-1.5 mb-3">
                  <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addTopic()} placeholder={`New ${L.topic}…`}
                    className="flex-1 min-w-0 border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
                  <button onClick={addTopic} className="px-2.5 max-md:min-w-10 rounded-lg bg-[#325099] text-white text-xs font-semibold">+</button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  {topicItems.length === 0 && <p className="text-xs text-[#2A2035]/30 italic px-3 py-3">No {L.Topics.toLowerCase()} yet.</p>}
                  {topicItems.map((t) => (
                    <Row key={t.key}>
                      <button onClick={() => { setTopicId(t.key); setSubtopicId('') }}
                        className={`flex-1 min-w-0 break-words text-left text-sm max-md:py-1 ${topicId === t.key ? 'font-bold text-[#325099]' : 'text-[#2A2035]'}`}>
                        {t.name}
                        {onlyIn(t) && <span className="ml-1.5 text-[10px] font-semibold text-[#B45309] bg-amber-50 border border-amber-200 rounded-full px-1.5 py-px align-middle">{onlyIn(t)}</span>}
                      </button>
                      <button className={editBtn} onClick={() => moveItem(T_QBANK_TOPICS, topicItems, t, -1)}>↑</button>
                      <button className={editBtn} onClick={() => moveItem(T_QBANK_TOPICS, topicItems, t, 1)}>↓</button>
                      <button className={editBtn} onClick={() => { const n = prompt(`Rename ${L.topic}`, t.name); if (n != null && n.trim() && n.trim() !== t.name) proposeTopic('rename', t.name, n.trim()) }}>edit</button>
                      <button className={editBtn} onClick={() => proposeTopic('delete', t.name)}>✕</button>
                    </Row>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="space-y-4 min-w-0">
          {/* Subtopics */}
          <div className="bg-white rounded-2xl border border-[#F0F4FF] p-4">
            <h2 className="text-sm font-bold text-[#062E63] mb-2">{L.Subtopics}</h2>
            {!topicId ? (
              <p className="text-xs text-[#2A2035]/40 italic px-3 py-6">Select a {L.topic} →</p>
            ) : (
              <>
                <div className="flex gap-1.5 mb-1 items-start">
                  <textarea value={newSubtopic} onChange={(e) => setNewSubtopic(e.target.value)} rows={linesOf(newSubtopic)}
                    onKeyDown={(e) => multilineKeys(e, newSubtopic, setNewSubtopic, addSubtopic)} placeholder={`New ${L.subtopic}…`}
                    className="flex-1 min-w-0 border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs leading-5 resize-y focus:outline-none focus:border-[#325099] whitespace-pre-wrap" />
                  <button onClick={addSubtopic} className="px-2.5 py-1.5 max-md:min-w-10 rounded-lg bg-[#325099] text-white text-xs font-semibold">+</button>
                </div>
                <p className="text-[10px] text-[#2A2035]/40 mb-3 px-0.5">Shift+Enter for a new line · Tab to indent</p>
                {isChem && subtopicItems.some((i) => i.rows.some((st) => st.syllabus_dotpoint_id)) && (
                  <p className="text-[11px] text-[#325099] bg-[#F5F8FF] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 mb-3">
                    Copied from the official syllabus — every dot point is already here, so there’s no need to type them in.
                  </p>
                )}
                <div className="max-h-[60vh] overflow-y-auto">
                  {subtopicItems.length === 0 && <p className="text-xs text-[#2A2035]/30 italic px-3 py-3">No {L.Subtopics.toLowerCase()} yet.</p>}
                  {subtopicItems.map((st) => subEdit?.key === st.key ? (
                    <div key={st.key} className="px-1 py-2">
                      <textarea autoFocus value={subEdit.text} rows={linesOf(subEdit.text)}
                        onChange={(e) => setSubEdit((x) => ({ ...x, text: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Escape') { setSubEdit(null); return } multilineKeys(e, subEdit.text, (v) => setSubEdit((x) => ({ ...x, text: v })), saveSubEdit) }}
                        className="w-full border border-[#325099] rounded-lg px-2 py-1.5 text-xs leading-5 resize-y focus:outline-none whitespace-pre-wrap" />
                      <div className="flex items-center gap-2 mt-1">
                        <button onClick={saveSubEdit} className="px-2.5 py-1 rounded-lg bg-[#325099] text-white text-[11px] font-semibold">Save</button>
                        <button onClick={() => setSubEdit(null)} className="px-2 py-1 text-[11px] text-[#2A2035]/50 hover:text-[#2A2035]">Cancel</button>
                        <span className="text-[10px] text-[#2A2035]/40 ml-auto">Shift+Enter new line · Tab indent</span>
                      </div>
                    </div>
                  ) : (
                    <Row key={st.key}>
                      <button onClick={() => setSubtopicId(st.key)}
                        className={`flex-1 min-w-0 break-words whitespace-pre-wrap text-left text-sm max-md:py-1 ${subtopicId === st.key ? 'font-bold text-[#325099]' : 'text-[#2A2035]'}`}>
                        {st.name}
                        {onlyIn(st) && <span className="ml-1.5 text-[10px] font-semibold text-[#B45309] bg-amber-50 border border-amber-200 rounded-full px-1.5 py-px align-middle whitespace-nowrap">{onlyIn(st)}</span>}
                      </button>
                      <button className={editBtn} onClick={() => moveItem(T_QBANK_SUBTOPICS, subtopicItems, st, -1)}>↑</button>
                      <button className={editBtn} onClick={() => moveItem(T_QBANK_SUBTOPICS, subtopicItems, st, 1)}>↓</button>
                      <button className={editBtn} onClick={() => setSubEdit({ key: st.key, ids: st.rows.map((r) => r.id), text: st.name })}>edit</button>
                      <button className={editBtn} onClick={() => removeSubtopicItem(st)}>✕</button>
                    </Row>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Skills — one shared list per stage, independent of topics/subtopics */}
          <div className="bg-white rounded-2xl border border-[#F0F4FF] p-4">
            <h2 className="text-sm font-bold text-[#062E63]">Skills</h2>
            <p className="text-[11px] text-[#2A2035]/45 mb-2">
              {skillScope
                ? <>Shared by every year in <span className="font-semibold text-[#325099]">{skillScope.family} · {STAGE_LABEL[skillScope.stage]}</span> — editing here changes it for all of them.</>
                : 'One list per subject per stage, shared by every year in it.'}
            </p>
            {!subjectId ? (
              <p className="text-xs text-[#2A2035]/40 italic px-3 py-6">Select a subject →</p>
            ) : (
              <>
                <div className="flex gap-1.5 mb-3">
                  <input value={newSkill} onChange={(e) => setNewSkill(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addSkill()} placeholder="New skill…"
                    className="flex-1 min-w-0 border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
                  <button onClick={addSkill} className="px-2.5 max-md:min-w-10 rounded-lg bg-[#325099] text-white text-xs font-semibold">+</button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  {skillsForSubject.length === 0 && <p className="text-xs text-[#2A2035]/30 italic px-3 py-3">No skills yet.</p>}
                  {skillsForSubject.map((s) => (
                    <Row key={s.id}>
                      <span className="flex-1 min-w-0 break-words text-sm text-[#2A2035]">{s.name}</span>
                      <button className={editBtn} onClick={() => move(T_QBANK_SKILLS, skillsForSubject, s, -1)}>↑</button>
                      <button className={editBtn} onClick={() => move(T_QBANK_SKILLS, skillsForSubject, s, 1)}>↓</button>
                      <button className={editBtn} onClick={() => rename(T_QBANK_SKILLS, s.id, prompt('Rename skill', s.name))}>edit</button>
                      <button className={editBtn} onClick={() => remove(T_QBANK_SKILLS, s.id, s.name)}>✕</button>
                    </Row>
                  ))}
                </div>
              </>
            )}
          </div>
          </div>
        </div>
      </div>

      {addingSubject && (
        <div className="fixed inset-0 z-50 flex items-end md:items-start justify-center bg-[#0B1020]/60 backdrop-blur-sm md:py-24"
          onClick={() => setAddingSubject(false)}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl border border-[#E5ECFF] w-full md:max-w-sm md:mx-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:pb-5 max-h-[90dvh] overflow-y-auto shadow-xl space-y-3"
            onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-bold text-[#062E63]">Add a year or course</h2>
            <div>
              <label className="text-[11px] font-semibold text-[#2A2035]/50 block mb-1">Year</label>
              <select value={newSubYear} onChange={(e) => setNewSubYear(e.target.value)} autoFocus
                className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#325099]">
                {YEARS.map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[#2A2035]/50 block mb-1">
                Course {scope && <span className="font-normal text-[#2A2035]/40">— leave blank for ordinary {scope}</span>}
              </label>
              <input value={newSubName} onChange={(e) => setNewSubName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addSubject(); if (e.key === 'Escape') setAddingSubject(false) }}
                placeholder={scope ? `${scope} — or a stream like Ext 1 Maths` : 'Subject name'}
                className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#325099]" />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={addSubject}
                className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition">
                Add
              </button>
              <button onClick={() => setAddingSubject(false)}
                className="px-4 py-2 rounded-xl border border-[#DEE7FF] text-sm font-semibold text-[#2A2035]/60 hover:bg-[#F8FAFF] transition">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pending && activeSubject && (
        <TopicSyncModal from="qbank" year={activeSubject.year_level} subject={activeSubject.name}
          whereLabel={activeStage ? `${mathsStageLabel(activeStage)} Maths — both years` : undefined}
          action={pending.action} name={pending.name} newName={pending.newName}
          impact={pending.impact} busy={busy} error={err}
          onConfirm={confirmTopic} onCancel={() => { setPending(null); setErr('') }} />
      )}
    </div>
  )
}
