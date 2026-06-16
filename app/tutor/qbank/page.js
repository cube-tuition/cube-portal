'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'
import LatexContent from '../../../components/qbank/LatexContent'
import {
  T_QBANK_QUESTIONS, T_QBANK_QUESTION_IMAGES,
} from '../../../lib/tables'
import {
  fetchTaxonomy, yearsFromSubjects, deleteQbankImage, qbankImageUrl,
  DIFFICULTY_LABELS, DIFFICULTY_COLORS, fetchQuestionUsage,
} from '../../../lib/qbank'
import UsageBadge from '../../../components/qbank/UsageBadge'

export default function QuestionBankPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [tax, setTax] = useState(null)
  const [questions, setQuestions] = useState([])
  const [loadingQ, setLoadingQ] = useState(true)
  const [usageMap, setUsageMap] = useState({})

  // filters
  const [year, setYear] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [skillId, setSkillId] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [qtype, setQtype] = useState('')   // '' | 'mcq' | 'extended'
  const [search, setSearch] = useState('')
  const [usageTab, setUsageTab] = useState('all')   // all | used | unused

  const loadQuestions = useCallback(async () => {
    const { data } = await supabase
      .from(T_QBANK_QUESTIONS)
      .select('*, qbank_question_parts(id), qbank_question_images(id, storage_path)')
      .order('created_at', { ascending: false })
    setQuestions(data || [])
    setLoadingQ(false)
  }, [])

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
      fetchTaxonomy().then(setTax)
      loadQuestions()
      fetchQuestionUsage().then(setUsageMap)
    })
  }, [router, loadQuestions])

  // taxonomy lookup maps
  const maps = useMemo(() => {
    if (!tax) return null
    const skill = Object.fromEntries(tax.skills.map((s) => [s.id, s]))
    const topic = Object.fromEntries(tax.topics.map((t) => [t.id, t]))
    const subject = Object.fromEntries(tax.subjects.map((s) => [s.id, s]))
    return { skill, topic, subject }
  }, [tax])

  const labelFor = useCallback((q) => {
    if (!maps) return null
    const sk = maps.skill[q.skill_id]
    const tp = (sk && maps.topic[sk.topic_id]) || maps.topic[q.topic_id]
    const su = tp && maps.subject[tp.subject_id]
    return { skill: sk, topic: tp, subject: su }
  }, [maps])

  // filter dropdown lists
  const years = useMemo(() => (tax ? yearsFromSubjects(tax.subjects) : []), [tax])
  const subjectsForYear = useMemo(() => (tax && year ? tax.subjects.filter((s) => String(s.year_level) === String(year)) : []), [tax, year])
  const topicsForSubject = useMemo(() => (tax && subjectId ? (tax.topicsBySubject[subjectId] || []) : []), [tax, subjectId])
  const skillsForTopic = useMemo(() => (tax && topicId ? (tax.skillsByTopic[topicId] || []) : []), [tax, topicId])

  // apply filters
  const filtered = useMemo(() => {
    if (!maps) return []
    return questions.filter((q) => {
      const l = labelFor(q)
      if (!l?.topic) return !year && !subjectId && !topicId && !skillId  // fully untagged: only when no filter
      if (skillId && q.skill_id !== skillId) return false
      if (topicId && l.topic?.id !== topicId) return false
      if (subjectId && l.subject?.id !== subjectId) return false
      if (year && String(l.subject?.year_level) !== String(year)) return false
      if (difficulty && String(q.difficulty) !== String(difficulty)) return false
      if (qtype && q.qtype !== qtype) return false
      if (usageTab !== 'all') {
        const used = (usageMap[q.id]?.count || 0) > 0
        if (usageTab === 'used' && !used) return false
        if (usageTab === 'unused' && used) return false
      }
      if (search.trim()) {
        const hay = `${q.stem_latex} ${q.solution_latex}`.toLowerCase()
        if (!hay.includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [questions, maps, labelFor, year, subjectId, topicId, skillId, difficulty, qtype, search, usageTab, usageMap])

  const handleDelete = async (q) => {
    if (!confirm('Delete this question permanently?')) return
    for (const img of q.qbank_question_images || []) await deleteQbankImage(img.storage_path)
    await supabase.from(T_QBANK_QUESTIONS).delete().eq('id', q.id)
    loadQuestions()
  }

  const clearFilters = () => { setYear(''); setSubjectId(''); setTopicId(''); setSkillId(''); setDifficulty(''); setQtype(''); setSearch('') }
  const hasFilter = year || subjectId || topicId || skillId || difficulty || qtype || search

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const selCls = 'border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-5xl mx-auto px-6 pt-8 pb-16">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Question Bank</h1>
            <p className="text-sm text-[#325099]/60 mt-1">{questions.length} question{questions.length === 1 ? '' : 's'} in the bank.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/tutor/qbank/categories" className="px-3.5 py-2 rounded-xl border border-[#DEE7FF] text-sm font-semibold text-[#2A2035]/70 hover:bg-white transition">Categories</Link>
            <Link href="/tutor/qbank/worksheets" className="px-3.5 py-2 rounded-xl border border-[#DEE7FF] text-sm font-semibold text-[#2A2035]/70 hover:bg-white transition">Additional Questions</Link>
            <Link href="/tutor/qbank/generate" className="px-3.5 py-2 rounded-xl border border-[#325099] text-[#325099] text-sm font-semibold hover:bg-[#F0F4FF] transition">Generate worksheet</Link>
            <Link href="/tutor/qbank/new" className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition">+ New question</Link>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-5 bg-white rounded-2xl border border-[#F0F4FF] p-4 flex flex-wrap items-center gap-2">
          <select value={year} onChange={(e) => { setYear(e.target.value); setSubjectId(''); setTopicId(''); setSkillId('') }} className={selCls}>
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
          </select>
          <select value={subjectId} disabled={!year} onChange={(e) => { setSubjectId(e.target.value); setTopicId(''); setSkillId('') }} className={selCls}>
            <option value="">All subjects</option>
            {subjectsForYear.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={topicId} disabled={!subjectId} onChange={(e) => { setTopicId(e.target.value); setSkillId('') }} className={selCls}>
            <option value="">All topics</option>
            {topicsForSubject.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={skillId} disabled={!topicId} onChange={(e) => setSkillId(e.target.value)} className={selCls}>
            <option value="">All skills</option>
            {skillsForTopic.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className={selCls}>
            <option value="">Any difficulty</option>
            {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d} · {DIFFICULTY_LABELS[d]}</option>)}
          </select>
          <select value={qtype} onChange={(e) => setQtype(e.target.value)} className={selCls}>
            <option value="">All types</option>
            <option value="mcq">Multiple choice</option>
            <option value="extended">Non-MCQ (written)</option>
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search text…"
            className="flex-1 min-w-[120px] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
          {hasFilter ? <button onClick={clearFilters} className="text-[11px] text-[#325099] font-semibold hover:underline">Clear</button> : null}
        </div>

        {/* Used / Unused tabs */}
        <div className="flex gap-1 mt-5 border-b border-[#DEE7FF]">
          {(() => {
            const usedCount = questions.filter((q) => (usageMap[q.id]?.count || 0) > 0).length
            const tabs = [['all', 'All', questions.length], ['used', 'Used', usedCount], ['unused', 'Unused', questions.length - usedCount]]
            return tabs.map(([v, lbl, n]) => (
              <button key={v} onClick={() => setUsageTab(v)}
                className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${usageTab === v ? 'border-[#325099] text-[#062E63]' : 'border-transparent text-[#2A2035]/40 hover:text-[#2A2035]/70'}`}>
                {lbl} <span className="text-[11px] font-normal">({n})</span>
              </button>
            ))
          })()}
        </div>

        {/* List */}
        <div className="mt-4 space-y-3">
          {loadingQ ? (
            <p className="text-center text-sm text-[#2A2035]/40 py-12 animate-pulse">Loading questions…</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-[#DEE7FF]">
              <p className="text-sm text-[#2A2035]/50">{questions.length === 0 ? 'No questions yet.' : 'No questions match these filters.'}</p>
              {questions.length === 0 && (
                <Link href="/tutor/qbank/new" className="inline-block mt-3 px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold">Add the first question</Link>
              )}
            </div>
          ) : filtered.map((q) => {
            const l = labelFor(q)
            const nParts = q.qbank_question_parts?.length || 0
            const imgs = q.qbank_question_images || []
            return (
              <div key={q.id} className="bg-white rounded-2xl border border-[#F0F4FF] p-4 hover:border-[#DEE7FF] transition">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: DIFFICULTY_COLORS[q.difficulty] }}>
                    {DIFFICULTY_LABELS[q.difficulty]}
                  </span>
                  {q.qtype === 'mcq' && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#EEF2FF] text-[#4338CA]">MCQ</span>}
                  {q.audience === 'exam' && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E]">Exam only</span>}
                  {q.audience === 'student' && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#166534]">Students</span>}
                  {q.audience === 'both' && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#475569]">Both</span>}
                  <UsageBadge usage={usageMap[q.id]} />
                  {l?.subject && <span className="text-[11px] text-[#325099]">Yr {l.subject.year_level} · {l.subject.name}</span>}
                  {l?.topic && <span className="text-[11px] text-[#2A2035]/40">› {l.topic.name}</span>}
                  {l?.skill && <span className="text-[11px] text-[#2A2035]/40">› {l.skill.name}</span>}
                  {!l?.topic && <span className="text-[11px] text-[#EA580C]">⚠ untagged</span>}
                  <div className="ml-auto flex items-center gap-3">
                    {q.marks != null && <span className="text-[11px] text-[#2A2035]/40">{q.marks} mark{q.marks === 1 ? '' : 's'}</span>}
                    {nParts > 0 && <span className="text-[11px] text-[#2A2035]/40">{nParts} part{nParts === 1 ? '' : 's'}</span>}
                    {imgs.length > 0 && <span className="text-[11px] text-[#2A2035]/40">🖼 {imgs.length}</span>}
                    <Link href={`/tutor/qbank/${q.id}/edit`} className="text-[11px] font-semibold text-[#325099] hover:underline">Edit</Link>
                    <button onClick={() => handleDelete(q)} className="text-[11px] text-[#DC2626] hover:underline">Delete</button>
                  </div>
                </div>
                <div className="text-sm text-[#2A2035] line-clamp-3">
                  <LatexContent text={q.stem_latex || '(no stem)'} />
                </div>
                {imgs.length > 0 && (
                  <div className="flex gap-2 mt-2">
                    {imgs.slice(0, 4).map((im) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={im.id} src={qbankImageUrl(im.storage_path)} alt="" className="h-14 w-14 object-contain rounded-lg bg-[#F8FAFF] border border-[#F0F4FF]" />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {questions.length > 0 && (
          <p className="text-[11px] text-[#2A2035]/40 mt-8 text-center">
            Ready to build a worksheet? <Link href="/tutor/qbank/generate" className="text-[#325099] font-semibold hover:underline">Generate worksheet →</Link>
          </p>
        )}
      </div>
    </div>
  )
}
