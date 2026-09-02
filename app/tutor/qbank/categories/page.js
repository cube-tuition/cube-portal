'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import {
  T_QBANK_SUBJECTS, T_QBANK_TOPICS, T_QBANK_SUBTOPICS, T_QBANK_SKILLS,
} from '../../../../lib/tables'
import { SUBJECT_FAMILIES, SCOPE_LABEL, familyOfSubject, stageOfYear, STAGE_LABEL, subjectYearLabel } from '../../../../lib/qbank'
import { topicImpact, mirrorAdd, mirrorRename, mirrorDelete } from '../../../../lib/topicSync'
import TopicSyncModal from '../../../../components/TopicSyncModal'

const YEARS = [5, 6, 7, 8, 9, 10, 11, 12]

export default function CategoriesPage() {
  return <Suspense><CategoriesInner /></Suspense>
}

function CategoriesInner() {
  const router = useRouter()
  // Subject-hub scope (?subject=Maths|English|Chemistry): the subject column
  // shows only that family. Absent → unchanged behaviour.
  const searchParams = useSearchParams()
  const scopeParam = searchParams.get('subject')
  const scope = SUBJECT_FAMILIES[scopeParam] ? scopeParam : null
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
  const [newSubYear, setNewSubYear] = useState(7)
  const [newSubName, setNewSubName] = useState('')
  const [newTopic, setNewTopic] = useState('')
  // { action, name, newName, impact } while a topic edit waits on the modal.
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [newSubtopic, setNewSubtopic] = useState('')
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

  const topicsForSubject = topics.filter((t) => t.subject_id === subjectId)
  const subtopicsForTopic = subtopics.filter((st) => st.topic_id === topicId)
  // Skills are shared across a whole stage, not owned by one year: editing the
  // list from Year 8 edits the same list Years 7 and 9-12 see. The heading above
  // the column says so, because the change is invisible otherwise.
  const activeSubject = subjects.find((s) => s.id === subjectId) || null
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
    setNewSubName(''); reload()
  }
  // Topics are shared with the workbook Master Database, so every topic edit is
  // proposed to the user first and then written to both sides by lib/topicSync.
  // Subjects, subtopics and skills belong to the bank alone and are unaffected.
  const subjRow = subjects.find((x) => x.id === subjectId) || null
  const proposeTopic = async (action, name, newName) => {
    if (!subjRow || !name) return
    setPending({ action, name, newName, impact: null })
    const impact = await topicImpact(subjRow.year_level, subjRow.name, name)
    setPending({ action, name, newName, impact })
  }
  const confirmTopic = async () => {
    const { action, name, newName } = pending
    setBusy(true); setErr('')
    const y = subjRow.year_level, sub = subjRow.name
    const res = action === 'add'    ? await mirrorAdd(y, sub, name)
              : action === 'rename' ? await mirrorRename(y, sub, name, newName)
              :                       await mirrorDelete(y, sub, name)
    setBusy(false)
    if (res.error) { setErr(res.error); return }
    if (action === 'add') setNewTopic('')
    if (action === 'delete' && pending.impact?.qbank?.id === topicId) { setTopicId(''); setSubtopicId('') }
    setPending(null); reload()
  }

  const addTopic = async () => {
    if (!newTopic.trim() || !subjectId) return
    await proposeTopic('add', newTopic.trim())
  }
  const addSubtopic = async () => {
    if (!newSubtopic.trim() || !topicId) return
    await supabase.from(T_QBANK_SUBTOPICS).insert({ topic_id: topicId, name: newSubtopic.trim(), sort_order: subtopicsForTopic.length })
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
    if (!confirm(`Delete "${label}"? This also removes everything inside it. Questions tagged to a deleted skill must be re-tagged first.`)) return
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) { alert(error.message); return }
    if (table === T_QBANK_SUBJECTS && id === subjectId) { setSubjectId(''); setTopicId(''); setSubtopicId('') }
    if (table === T_QBANK_TOPICS && id === topicId) { setTopicId(''); setSubtopicId('') }
    if (table === T_QBANK_SUBTOPICS && id === subtopicId) setSubtopicId('')
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
  const editBtn = 'text-[11px] text-[#2A2035]/30 hover:text-[#325099] opacity-0 group-hover:opacity-100'

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-16">
        <Link href={`/tutor/qbank${scope ? `?subject=${scope}` : ''}`} className="text-xs text-[#325099] hover:underline">← Question bank</Link>
        <h1 className="text-2xl font-bold text-[#062E63] mt-1">Categories{scope ? ` — ${SCOPE_LABEL[scope]}` : ''}</h1>
        <p className="text-sm text-[#325099]/60 mt-1 mb-6">Manage the Year → Subject → Topic → Subtopic structure your questions are filed under. Skills sit outside that tree: one shared list per subject per stage — Years 5\u20136 share one, Years 7\u201312 share another.</p>

        <div className="grid md:grid-cols-4 gap-4">
          {/* Subjects */}
          <div className="bg-white rounded-2xl border border-[#F0F4FF] p-4">
            <h2 className="text-sm font-bold text-[#062E63]">Years &amp; courses</h2>
            <p className="text-[11px] text-[#2A2035]/45 mb-2">
              {scope
                ? <>Pick a year and press add for an ordinary {scope} course; name it only for a senior stream.</>
                : 'One row per year and course.'}
            </p>
            <div className="flex gap-1.5 mb-3">
              <select value={newSubYear} onChange={(e) => setNewSubYear(e.target.value)}
                className="border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#325099]">
                {YEARS.map((y) => <option key={y} value={y}>Yr {y}</option>)}
              </select>
              <input value={newSubName} onChange={(e) => setNewSubName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addSubject()} placeholder={scope ? `${scope} (or Ext 1 Maths…)` : 'New subject…'}
                className="flex-1 min-w-0 border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
              <button onClick={addSubject} className="px-2.5 rounded-lg bg-[#325099] text-white text-xs font-semibold">+</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {subjectRows.length === 0 && <p className="text-xs text-[#2A2035]/30 italic px-3 py-3">No years yet.</p>}
              {subjectRows.map((s) => (
                <Row key={s.id}>
                  <button onClick={() => { setSubjectId(s.id); setTopicId('') }}
                    className={`flex-1 text-left text-sm ${subjectId === s.id ? 'font-bold text-[#325099]' : 'text-[#2A2035]'}`}>
                    {subjectYearLabel(s, familyOfSubject(s.name))}
                    {!scope && <span className="text-[11px] text-[#2A2035]/35 ml-1.5">{familyOfSubject(s.name)}</span>}
                  </button>
                  <button className={editBtn} onClick={() => rename(T_QBANK_SUBJECTS, s.id, prompt('Rename subject', s.name))}>edit</button>
                  <button className={editBtn} onClick={() => remove(T_QBANK_SUBJECTS, s.id, s.name)}>✕</button>
                </Row>
              ))}
            </div>
          </div>

          {/* Topics */}
          <div className="bg-white rounded-2xl border border-[#F0F4FF] p-4">
            <h2 className="text-sm font-bold text-[#062E63] mb-2">Topics</h2>
            {!subjectId ? (
              <p className="text-xs text-[#2A2035]/40 italic px-3 py-6">Select a subject →</p>
            ) : (
              <>
                <div className="flex gap-1.5 mb-3">
                  <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addTopic()} placeholder="New topic…"
                    className="flex-1 min-w-0 border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
                  <button onClick={addTopic} className="px-2.5 rounded-lg bg-[#325099] text-white text-xs font-semibold">+</button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  {topicsForSubject.length === 0 && <p className="text-xs text-[#2A2035]/30 italic px-3 py-3">No topics yet.</p>}
                  {topicsForSubject.map((t) => (
                    <Row key={t.id}>
                      <button onClick={() => { setTopicId(t.id); setSubtopicId('') }}
                        className={`flex-1 text-left text-sm ${topicId === t.id ? 'font-bold text-[#325099]' : 'text-[#2A2035]'}`}>
                        {t.name}
                      </button>
                      <button className={editBtn} onClick={() => move(T_QBANK_TOPICS, topicsForSubject, t, -1)}>↑</button>
                      <button className={editBtn} onClick={() => move(T_QBANK_TOPICS, topicsForSubject, t, 1)}>↓</button>
                      <button className={editBtn} onClick={() => rename(T_QBANK_TOPICS, t.id, prompt('Rename topic', t.name))}>edit</button>
                      <button className={editBtn} onClick={() => remove(T_QBANK_TOPICS, t.id, t.name)}>✕</button>
                    </Row>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Subtopics */}
          <div className="bg-white rounded-2xl border border-[#F0F4FF] p-4">
            <h2 className="text-sm font-bold text-[#062E63] mb-2">Subtopics</h2>
            {!topicId ? (
              <p className="text-xs text-[#2A2035]/40 italic px-3 py-6">Select a topic →</p>
            ) : (
              <>
                <div className="flex gap-1.5 mb-3">
                  <input value={newSubtopic} onChange={(e) => setNewSubtopic(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addSubtopic()} placeholder="New subtopic…"
                    className="flex-1 min-w-0 border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
                  <button onClick={addSubtopic} className="px-2.5 rounded-lg bg-[#325099] text-white text-xs font-semibold">+</button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  {subtopicsForTopic.length === 0 && <p className="text-xs text-[#2A2035]/30 italic px-3 py-3">No subtopics yet.</p>}
                  {subtopicsForTopic.map((st) => (
                    <Row key={st.id}>
                      <button onClick={() => setSubtopicId(st.id)}
                        className={`flex-1 text-left text-sm ${subtopicId === st.id ? 'font-bold text-[#325099]' : 'text-[#2A2035]'}`}>
                        {st.name}
                      </button>
                      <button className={editBtn} onClick={() => move(T_QBANK_SUBTOPICS, subtopicsForTopic, st, -1)}>↑</button>
                      <button className={editBtn} onClick={() => move(T_QBANK_SUBTOPICS, subtopicsForTopic, st, 1)}>↓</button>
                      <button className={editBtn} onClick={() => rename(T_QBANK_SUBTOPICS, st.id, prompt('Rename subtopic', st.name))}>edit</button>
                      <button className={editBtn} onClick={() => remove(T_QBANK_SUBTOPICS, st.id, st.name)}>✕</button>
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
                  <button onClick={addSkill} className="px-2.5 rounded-lg bg-[#325099] text-white text-xs font-semibold">+</button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  {skillsForSubject.length === 0 && <p className="text-xs text-[#2A2035]/30 italic px-3 py-3">No skills yet.</p>}
                  {skillsForSubject.map((s) => (
                    <Row key={s.id}>
                      <span className="flex-1 text-sm text-[#2A2035]">{s.name}</span>
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

      {pending && subjRow && (
        <TopicSyncModal from="qbank" year={subjRow.year_level} subject={subjRow.name}
          action={pending.action} name={pending.name} newName={pending.newName}
          impact={pending.impact} busy={busy} error={err}
          onConfirm={confirmTopic} onCancel={() => { setPending(null); setErr('') }} />
      )}
    </div>
  )
}
