'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import {
  T_QBANK_SUBJECTS, T_QBANK_TOPICS, T_QBANK_SKILLS,
} from '../../../../lib/tables'

const YEARS = [5, 6, 7, 8, 9, 10, 11, 12]

export default function CategoriesPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)

  const [subjects, setSubjects] = useState([])
  const [topics, setTopics] = useState([])
  const [skills, setSkills] = useState([])
  const [subjectId, setSubjectId] = useState('')
  const [topicId, setTopicId] = useState('')

  // new-row inputs
  const [newSubYear, setNewSubYear] = useState(7)
  const [newSubName, setNewSubName] = useState('')
  const [newTopic, setNewTopic] = useState('')
  const [newSkill, setNewSkill] = useState('')

  const reload = useCallback(async () => {
    const [s, t, k] = await Promise.all([
      supabase.from(T_QBANK_SUBJECTS).select('*').order('year_level').order('sort_order').order('name'),
      supabase.from(T_QBANK_TOPICS).select('*').order('sort_order').order('name'),
      supabase.from(T_QBANK_SKILLS).select('*').order('sort_order').order('name'),
    ])
    setSubjects(s.data || []); setTopics(t.data || []); setSkills(k.data || [])
  }, [])

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true); reload()
    })
  }, [router, reload])

  const topicsForSubject = topics.filter((t) => t.subject_id === subjectId)
  const skillsForTopic = skills.filter((s) => s.topic_id === topicId)
  const subjectsByYear = (y) => subjects.filter((s) => s.year_level === y)

  // ── Mutations ───────────────────────────────────────────────────────────────
  const addSubject = async () => {
    if (!newSubName.trim()) return
    await supabase.from(T_QBANK_SUBJECTS).insert({ year_level: Number(newSubYear), name: newSubName.trim() })
    setNewSubName(''); reload()
  }
  const addTopic = async () => {
    if (!newTopic.trim() || !subjectId) return
    await supabase.from(T_QBANK_TOPICS).insert({ subject_id: subjectId, name: newTopic.trim(), sort_order: topicsForSubject.length })
    setNewTopic(''); reload()
  }
  const addSkill = async () => {
    if (!newSkill.trim() || !topicId) return
    await supabase.from(T_QBANK_SKILLS).insert({ topic_id: topicId, name: newSkill.trim(), sort_order: skillsForTopic.length })
    setNewSkill(''); reload()
  }

  const rename = async (table, id, name) => {
    if (name == null) return
    await supabase.from(table).update({ name }).eq('id', id); reload()
  }
  const remove = async (table, id, label) => {
    if (!confirm(`Delete "${label}"? This also removes everything inside it. Questions tagged to a deleted skill must be re-tagged first.`)) return
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) { alert(error.message); return }
    if (table === T_QBANK_SUBJECTS && id === subjectId) { setSubjectId(''); setTopicId('') }
    if (table === T_QBANK_TOPICS && id === topicId) setTopicId('')
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
        <Link href="/tutor/qbank" className="text-xs text-[#325099] hover:underline">← Question bank</Link>
        <h1 className="text-2xl font-bold text-[#062E63] mt-1">Categories</h1>
        <p className="text-sm text-[#325099]/60 mt-1 mb-6">Manage the Year → Subject → Topic → Skill structure your questions are filed under.</p>

        <div className="grid md:grid-cols-3 gap-4">
          {/* Subjects */}
          <div className="bg-white rounded-2xl border border-[#F0F4FF] p-4">
            <h2 className="text-sm font-bold text-[#062E63] mb-2">Subjects</h2>
            <div className="flex gap-1.5 mb-3">
              <select value={newSubYear} onChange={(e) => setNewSubYear(e.target.value)}
                className="border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#325099]">
                {YEARS.map((y) => <option key={y} value={y}>Yr {y}</option>)}
              </select>
              <input value={newSubName} onChange={(e) => setNewSubName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addSubject()} placeholder="New subject…"
                className="flex-1 min-w-0 border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
              <button onClick={addSubject} className="px-2.5 rounded-lg bg-[#325099] text-white text-xs font-semibold">+</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {YEARS.filter((y) => subjectsByYear(y).length).map((y) => (
                <div key={y} className="mb-2">
                  <p className="text-[10px] uppercase tracking-wide text-[#2A2035]/30 px-3 pt-1">Year {y}</p>
                  {subjectsByYear(y).map((s) => (
                    <Row key={s.id}>
                      <button onClick={() => { setSubjectId(s.id); setTopicId('') }}
                        className={`flex-1 text-left text-sm ${subjectId === s.id ? 'font-bold text-[#325099]' : 'text-[#2A2035]'}`}>
                        {s.name}
                      </button>
                      <button className={editBtn} onClick={() => rename(T_QBANK_SUBJECTS, s.id, prompt('Rename subject', s.name))}>edit</button>
                      <button className={editBtn} onClick={() => remove(T_QBANK_SUBJECTS, s.id, s.name)}>✕</button>
                    </Row>
                  ))}
                </div>
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
                      <button onClick={() => setTopicId(t.id)}
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

          {/* Skills */}
          <div className="bg-white rounded-2xl border border-[#F0F4FF] p-4">
            <h2 className="text-sm font-bold text-[#062E63] mb-2">Skills</h2>
            {!topicId ? (
              <p className="text-xs text-[#2A2035]/40 italic px-3 py-6">Select a topic →</p>
            ) : (
              <>
                <div className="flex gap-1.5 mb-3">
                  <input value={newSkill} onChange={(e) => setNewSkill(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addSkill()} placeholder="New skill…"
                    className="flex-1 min-w-0 border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
                  <button onClick={addSkill} className="px-2.5 rounded-lg bg-[#325099] text-white text-xs font-semibold">+</button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  {skillsForTopic.length === 0 && <p className="text-xs text-[#2A2035]/30 italic px-3 py-3">No skills yet.</p>}
                  {skillsForTopic.map((s) => (
                    <Row key={s.id}>
                      <span className="flex-1 text-sm text-[#2A2035]">{s.name}</span>
                      <button className={editBtn} onClick={() => move(T_QBANK_SKILLS, skillsForTopic, s, -1)}>↑</button>
                      <button className={editBtn} onClick={() => move(T_QBANK_SKILLS, skillsForTopic, s, 1)}>↓</button>
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
  )
}
