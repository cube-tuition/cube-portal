'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import {
  T_QBANK_QUESTIONS, T_QBANK_QUESTION_PARTS, T_QBANK_QUESTION_IMAGES,
  T_QBANK_TOPICS, T_QBANK_SUBTOPICS, T_QBANK_SKILLS,
} from '../../lib/tables'
import {
  fetchTaxonomy, yearsFromSubjects, uploadQbankImage, deleteQbankImage,
  DIFFICULTY_LABELS, DIFFICULTY_COLORS, MCQ_LABELS, fetchQuestionUsage,
  defaultCriterion, TOP_CRITERION,
} from '../../lib/qbank'
import LatexField from './LatexField'
import ImageManager from './ImageManager'
import UsageBadge from './UsageBadge'

const blankPart = (i) => ({
  _key: Math.random().toString(36).slice(2),
  part_label: 'abcdefgh'[i] || String(i + 1),
  prompt_latex: '',
  solution_latex: '',
  marks: '',
  criteria: {},
})

// Editable banded marking criteria for the solutions PDF (shown when marks > 1).
function CriteriaEditor({ marks, value, onChange }) {
  const m = Number(marks) || 0
  if (m <= 1) return null
  const rows = []
  for (let k = m; k >= 1; k--) rows.push(k)
  return (
    <div className="rounded-xl border border-[#DEE7FF] bg-[#FBFCFF] p-3">
      <label className="text-xs font-semibold text-[#062E63]">Marking criteria (solutions)</label>
      <p className="text-[10px] text-[#2A2035]/40 mb-2">Top band is fixed; edit the lower bands (defaults pre-filled). Use $…$ for maths.</p>
      <div className="space-y-1.5">
        {rows.map((k) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-6 text-xs font-bold text-[#062E63] text-center">{k}</span>
            {k === m ? (
              <div className="flex-1 text-sm text-[#2A2035] px-2 py-1.5 bg-white border border-[#F0F4FF] rounded-lg">{TOP_CRITERION}</div>
            ) : (
              <input
                value={value?.[k] ?? defaultCriterion(k, m)}
                onChange={(e) => onChange({ ...(value || {}), [k]: e.target.value })}
                className="flex-1 border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#325099]" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function QuestionEditor({ questionId = null, staffName, onSaved = null, onCancel = null, defaults = null }) {
  const router = useRouter()
  const editing = !!questionId
  const embedded = !!(onSaved || onCancel)

  const [tax, setTax] = useState(null)          // { subjects, topicsBySubject, skillsByTopic }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Cascade selection: Year → Subject → Topic → Subtopic → Skill
  const [year, setYear] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [subtopicId, setSubtopicId] = useState('')
  const [skillId, setSkillId] = useState('')

  // Question fields
  const [qtype, setQtype] = useState('extended')   // 'extended' | 'mcq'
  const [stem, setStem] = useState('')
  const [solution, setSolution] = useState('')
  const [difficulty, setDifficulty] = useState(3)
  const [marks, setMarks] = useState('')
  const [audience, setAudience] = useState('both')   // 'exam' | 'student' | 'both'
  const [isMulti, setIsMulti] = useState(false)
  const [parts, setParts] = useState([blankPart(0)])
  const [options, setOptions] = useState(MCQ_LABELS.map((label) => ({ label, latex: '' })))
  const [correctOption, setCorrectOption] = useState('A')
  const [criteria, setCriteria] = useState({})
  const [images, setImages] = useState([])
  const [removedImageIds, setRemovedImageIds] = useState([])
  const [solutionImages, setSolutionImages] = useState([])
  const [removedSolutionImageIds, setRemovedSolutionImageIds] = useState([])
  const [usage, setUsage] = useState(null)

  // ── Load taxonomy (+ existing question when editing) ────────────────────────
  useEffect(() => {
    let alive = true
    ;(async () => {
      const t = await fetchTaxonomy()
      if (!alive) return
      setTax(t)

      if (editing) {
        const { data: q } = await supabase.from(T_QBANK_QUESTIONS)
          .select('*').eq('id', questionId).maybeSingle()
        if (q) {
          setQtype(q.qtype || 'extended')
          setStem(q.stem_latex || '')
          setSolution(q.solution_latex || '')
          setDifficulty(q.difficulty || 3)
          setMarks(q.marks ?? '')
          setAudience(q.audience || 'exam')
          setIsMulti(q.is_multipart)
          if (Array.isArray(q.options) && q.options.length) {
            setOptions(MCQ_LABELS.map((label, i) => ({
              label, latex: q.options[i]?.latex ?? q.options[i]?.text ?? '',
            })))
          }
          if (q.correct_option) setCorrectOption(q.correct_option)
          if (q.criteria && typeof q.criteria === 'object') setCriteria(q.criteria)

          // Prefill cascade from skill → subtopic → topic → subject (skill is
          // optional, so fall back to the question's own subtopic_id/topic_id).
          const skill = t.skills.find((s) => s.id === q.skill_id)
          const subtopic = (skill && t.subtopics.find((st) => st.id === skill.subtopic_id))
            || t.subtopics.find((st) => st.id === q.subtopic_id)
          const topic = (subtopic && t.topics.find((tp) => tp.id === subtopic.topic_id))
            || (skill && t.topics.find((tp) => tp.id === skill.topic_id))
            || t.topics.find((tp) => tp.id === q.topic_id)
          const subject = topic && t.subjects.find((su) => su.id === topic.subject_id)
          if (subject) { setYear(String(subject.year_level)); setSubjectId(subject.id) }
          if (topic) setTopicId(topic.id)
          if (subtopic) setSubtopicId(subtopic.id)
          if (skill) setSkillId(skill.id)

          const { data: pr } = await supabase.from(T_QBANK_QUESTION_PARTS)
            .select('*').eq('question_id', questionId).order('sort_order')
          if (pr?.length) {
            setParts(pr.map((p) => ({
              _key: p.id, part_label: p.part_label || '',
              prompt_latex: p.prompt_latex || '', solution_latex: p.solution_latex || '',
              marks: p.marks ?? '',
              criteria: (p.criteria && typeof p.criteria === 'object') ? p.criteria : {},
            })))
          }
          const { data: im } = await supabase.from(T_QBANK_QUESTION_IMAGES)
            .select('*').eq('question_id', questionId).order('sort_order')
          if (im?.length) {
            const map = (x) => ({ id: x.id, storage_path: x.storage_path, alt: x.alt || '' })
            setImages(im.filter((x) => (x.role || 'stem') !== 'solution').map(map))
            setSolutionImages(im.filter((x) => x.role === 'solution').map(map))
          }

          const um = await fetchQuestionUsage([questionId])
          if (alive) setUsage(um[questionId] || null)
        }
      } else if (defaults) {
        // Prefill the classification when opened from a builder (modal mode).
        if (defaults.audience) setAudience(defaults.audience)
        const skill = defaults.skillId ? t.skills.find((s) => s.id === defaults.skillId) : null
        let subtopic = defaults.subtopicId ? t.subtopics.find((st) => st.id === defaults.subtopicId) : null
        if (!subtopic && skill) subtopic = t.subtopics.find((st) => st.id === skill.subtopic_id) || null
        let topic = defaults.topicId ? t.topics.find((tp) => tp.id === defaults.topicId) : null
        if (!topic && subtopic) topic = t.topics.find((tp) => tp.id === subtopic.topic_id) || null
        let subject = topic ? t.subjects.find((su) => su.id === topic.subject_id) : null
        if (!subject && defaults.year && defaults.subjectName) {
          subject = t.subjects.find(
            (su) => String(su.year_level) === String(defaults.year) && su.name === defaults.subjectName,
          ) || null
        }
        if (subject) { setYear(String(subject.year_level)); setSubjectId(subject.id) }
        else if (defaults.year) setYear(String(defaults.year))
        if (topic) setTopicId(topic.id)
        if (subtopic) setSubtopicId(subtopic.id)
        if (skill) setSkillId(skill.id)
      }
      setLoading(false)
    })()
    return () => { alive = false }
    // defaults is read once on mount for prefill; intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, questionId])

  // ── Derived dropdown lists ──────────────────────────────────────────────────
  const years = useMemo(() => (tax ? yearsFromSubjects(tax.subjects) : []), [tax])
  const subjectsForYear = useMemo(
    () => (tax && year ? tax.subjects.filter((s) => String(s.year_level) === String(year)) : []),
    [tax, year],
  )
  const topicsForSubject = useMemo(
    () => (tax && subjectId ? (tax.topicsBySubject[subjectId] || []) : []),
    [tax, subjectId],
  )
  const subtopicsForTopic = useMemo(
    () => (tax && topicId ? (tax.subtopicsByTopic[topicId] || []) : []),
    [tax, topicId],
  )
  const skillsForSubtopic = useMemo(
    () => (tax && subtopicId ? (tax.skillsBySubtopic[subtopicId] || []) : []),
    [tax, subtopicId],
  )

  // ── Create a new topic / subtopic / skill inline from the dropdowns ─────────
  const addTopic = async () => {
    const name = (window.prompt('New topic name:') || '').trim()
    if (!name) return
    const { data, error: e } = await supabase.from(T_QBANK_TOPICS)
      .insert({ subject_id: subjectId, name }).select('id').single()
    if (e) { setError(e.message || 'Could not create the topic.'); return }
    const t = await fetchTaxonomy(); setTax(t)
    setTopicId(data.id); setSubtopicId(''); setSkillId('')
  }
  const addSubtopic = async () => {
    const name = (window.prompt('New subtopic name:') || '').trim()
    if (!name) return
    const { data, error: e } = await supabase.from(T_QBANK_SUBTOPICS)
      .insert({ topic_id: topicId, name }).select('id').single()
    if (e) { setError(e.message || 'Could not create the subtopic.'); return }
    const t = await fetchTaxonomy(); setTax(t)
    setSubtopicId(data.id); setSkillId('')
  }
  const addSkill = async () => {
    const name = (window.prompt('New skill name:') || '').trim()
    if (!name) return
    // Skills carry both topic_id (kept for compat) and subtopic_id.
    const { data, error: e } = await supabase.from(T_QBANK_SKILLS)
      .insert({ topic_id: topicId, subtopic_id: subtopicId, name }).select('id').single()
    if (e) { setError(e.message || 'Could not create the skill.'); return }
    const t = await fetchTaxonomy(); setTax(t)
    setSkillId(data.id)
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  const isMcq = qtype === 'mcq'

  const handleSave = async () => {
    setError('')
    if (!topicId) { setError('Pick a Year → Subject → Topic for this question.'); return }
    if (!subtopicId) { setError('Pick a Subtopic for this question. (Skill is optional.)'); return }
    if (!stem.trim()) { setError('Enter the question text.'); return }
    if (isMcq && options.filter((o) => o.latex.trim()).length < 2) {
      setError('Add at least two options for a multiple-choice question.'); return
    }
    setSaving(true)
    try {
      const payload = {
        skill_id: skillId || null,
        subtopic_id: subtopicId,
        topic_id: topicId,
        qtype,
        stem_latex: stem,
        solution_latex: (isMulti && !isMcq) ? '' : solution,   // mcq: explanation; extended single: worked solution
        difficulty: Number(difficulty),
        marks: marks === '' ? (isMcq ? 1 : null) : Number(marks),
        audience,
        is_multipart: isMcq ? false : isMulti,
        options: isMcq ? options.filter((o) => o.latex.trim()).map((o) => ({ label: o.label, latex: o.latex })) : [],
        correct_option: isMcq ? correctOption : null,
        criteria: (isMcq || isMulti) ? {} : (criteria || {}),
      }

      let qid = questionId
      if (editing) {
        const { error: e } = await supabase.from(T_QBANK_QUESTIONS).update(payload).eq('id', questionId)
        if (e) throw e
      } else {
        const { data, error: e } = await supabase.from(T_QBANK_QUESTIONS)
          .insert({ ...payload, created_by: staffName || null }).select('id').single()
        if (e) throw e
        qid = data.id
      }

      // Parts: replace wholesale (lightweight rows)
      await supabase.from(T_QBANK_QUESTION_PARTS).delete().eq('question_id', qid)
      if (isMulti && !isMcq) {
        const rows = parts
          .filter((p) => p.prompt_latex.trim() || p.solution_latex.trim())
          .map((p, i) => ({
            question_id: qid,
            part_label: p.part_label || 'abcdefgh'[i] || String(i + 1),
            prompt_latex: p.prompt_latex,
            solution_latex: p.solution_latex,
            marks: p.marks === '' ? null : Number(p.marks),
            criteria: p.criteria || {},
            sort_order: i,
          }))
        if (rows.length) {
          const { error: e } = await supabase.from(T_QBANK_QUESTION_PARTS).insert(rows)
          if (e) throw e
        }
      }

      // Images: delete removed (stem + solution), upload new with their role
      const removedAll = [...removedImageIds, ...removedSolutionImageIds]
      if (removedAll.length) {
        const { data: removedRows } = await supabase.from(T_QBANK_QUESTION_IMAGES)
          .select('storage_path').in('id', removedAll)
        await supabase.from(T_QBANK_QUESTION_IMAGES).delete().in('id', removedAll)
        for (const r of removedRows || []) await deleteQbankImage(r.storage_path)
      }
      const uploadNew = async (list, role) => {
        const newOnes = list.filter((x) => x._new)
        for (let i = 0; i < newOnes.length; i++) {
          const img = newOnes[i]
          const path = await uploadQbankImage(img.file)
          await supabase.from(T_QBANK_QUESTION_IMAGES)
            .insert({ question_id: qid, storage_path: path, alt: img.alt || null, sort_order: i, role })
        }
      }
      await uploadNew(images, 'stem')
      await uploadNew(solutionImages, 'solution')

      if (onSaved) { onSaved(qid); return }   // modal mode — hand control back to the builder
      router.push('/tutor/qbank')
    } catch (e) {
      setError(e.message || 'Could not save the question.')
      setSaving(false)
    }
  }

  // Track removed existing images for deletion on save.
  const onImagesChange = (next) => {
    const stillThere = new Set(next.filter((x) => x.id).map((x) => x.id))
    const newlyRemoved = images.filter((x) => x.id && !stillThere.has(x.id)).map((x) => x.id)
    if (newlyRemoved.length) setRemovedImageIds((r) => [...r, ...newlyRemoved])
    setImages(next)
  }
  const onSolutionImagesChange = (next) => {
    const stillThere = new Set(next.filter((x) => x.id).map((x) => x.id))
    const newlyRemoved = solutionImages.filter((x) => x.id && !stillThere.has(x.id)).map((x) => x.id)
    if (newlyRemoved.length) setRemovedSolutionImageIds((r) => [...r, ...newlyRemoved])
    setSolutionImages(next)
  }

  const updatePart = (key, field, val) =>
    setParts((ps) => ps.map((p) => (p._key === key ? { ...p, [field]: val } : p)))

  if (loading) return (
    <div className="py-20 text-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>
  )

  const inputCls = 'w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'

  return (
    <div className="space-y-6">
      {editing && (
        <section className="bg-white rounded-2xl border border-[#F0F4FF] p-4">
          <h2 className="text-sm font-bold text-[#062E63] mb-2">Usage</h2>
          <UsageBadge usage={usage} details />
        </section>
      )}

      {/* Classification */}
      <section className="bg-white rounded-2xl border border-[#F0F4FF] p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[#062E63]">Classification</h2>
          <div className="inline-flex rounded-xl border border-[#DEE7FF] overflow-hidden text-xs font-semibold">
            {[['extended', 'Extended response'], ['mcq', 'Multiple choice']].map(([v, lbl]) => (
              <button key={v} type="button" onClick={() => setQtype(v)}
                className={`px-3 py-1.5 transition ${qtype === v ? 'bg-[#325099] text-white' : 'bg-white text-[#2A2035]/60 hover:bg-[#F8FAFF]'}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div>
            <label className="text-[11px] font-semibold text-[#2A2035]/50">Year</label>
            <select value={year} className={inputCls}
              onChange={(e) => { setYear(e.target.value); setSubjectId(''); setTopicId(''); setSubtopicId(''); setSkillId('') }}>
              <option value="">—</option>
              {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-[#2A2035]/50">Subject</label>
            <select value={subjectId} disabled={!year} className={inputCls}
              onChange={(e) => { setSubjectId(e.target.value); setTopicId(''); setSubtopicId(''); setSkillId('') }}>
              <option value="">—</option>
              {subjectsForYear.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-[#2A2035]/50">Topic</label>
            <select value={topicId} disabled={!subjectId} className={inputCls}
              onChange={(e) => { if (e.target.value === '__new__') { addTopic(); return } setTopicId(e.target.value); setSubtopicId(''); setSkillId('') }}>
              <option value="">—</option>
              {topicsForSubject.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              {subjectId && <option value="__new__">＋ New topic…</option>}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-[#2A2035]/50">Subtopic</label>
            <select value={subtopicId} disabled={!topicId} className={inputCls}
              onChange={(e) => { if (e.target.value === '__new__') { addSubtopic(); return } setSubtopicId(e.target.value); setSkillId('') }}>
              <option value="">—</option>
              {subtopicsForTopic.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
              {topicId && <option value="__new__">＋ New subtopic…</option>}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-[#2A2035]/50">Skill <span className="text-[#2A2035]/30 normal-case">(optional)</span></label>
            <select value={skillId} disabled={!subtopicId} className={inputCls}
              onChange={(e) => { if (e.target.value === '__new__') { addSkill(); return } setSkillId(e.target.value) }}>
              <option value="">— None</option>
              {skillsForSubtopic.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              {subtopicId && <option value="__new__">＋ New skill…</option>}
            </select>
          </div>
        </div>
        {topicId && subtopicsForTopic.length === 0 && (
          <p className="text-[11px] text-[#EA580C] mt-2">
            No subtopics under this topic yet — add one with “＋ New subtopic…” or in <a className="underline" href="/tutor/qbank/categories">Categories</a>.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-4 mt-4">
          <div>
            <label className="text-[11px] font-semibold text-[#2A2035]/50 block mb-1">Difficulty</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((d) => (
                <button key={d} type="button" onClick={() => setDifficulty(d)}
                  title={DIFFICULTY_LABELS[d]}
                  className="w-8 h-8 rounded-lg text-xs font-bold border transition"
                  style={difficulty === d
                    ? { background: DIFFICULTY_COLORS[d], color: '#fff', borderColor: DIFFICULTY_COLORS[d] }
                    : { background: '#fff', color: '#94a3b8', borderColor: '#DEE7FF' }}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          {(!isMulti || isMcq) && (
            <div>
              <label className="text-[11px] font-semibold text-[#2A2035]/50 block mb-1">Marks</label>
              <input type="number" min="0" value={marks} onChange={(e) => setMarks(e.target.value)}
                placeholder={isMcq ? '1' : ''}
                className="w-24 border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#325099]" />
            </div>
          )}
          {!isMcq && (
            <label className="flex items-center gap-2 text-xs font-semibold text-[#062E63] ml-auto cursor-pointer">
              <input type="checkbox" checked={isMulti} onChange={(e) => setIsMulti(e.target.checked)} />
              Multi-part question (a, b, c…)
            </label>
          )}
        </div>

        <div className="mt-4">
          <label className="text-[11px] font-semibold text-[#2A2035]/50 block mb-1">Available for</label>
          <div className="inline-flex rounded-xl border border-[#DEE7FF] overflow-hidden text-xs font-semibold">
            {[['exam', 'Exams only'], ['student', 'Students only'], ['both', 'Both']].map(([v, lbl]) => (
              <button key={v} type="button" onClick={() => setAudience(v)}
                className={`px-3.5 py-1.5 transition ${audience === v ? 'bg-[#325099] text-white' : 'bg-white text-[#2A2035]/60 hover:bg-[#F8FAFF]'}`}>
                {lbl}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-[#2A2035]/40 mt-1">
            {audience === 'exam' ? 'Only selectable in the exam builder — hidden from student practice.'
              : audience === 'student' ? 'Only available in student practice — never pulled into exams.'
              : 'Available in both the exam builder and student practice.'}
          </p>
        </div>
      </section>

      {/* Question body */}
      <section className="bg-white rounded-2xl border border-[#F0F4FF] p-5 space-y-4">
        <h2 className="text-sm font-bold text-[#062E63]">
          {isMcq ? 'Multiple-choice question' : isMulti ? 'Stem / intro (shown above the parts)' : 'Question'}
        </h2>
        <LatexField
          label={isMulti && !isMcq ? 'Stem (optional)' : 'Question text'}
          value={stem} onChange={setStem} rows={4}
          hint="Use $…$ for inline math, $$…$$ for display"
          placeholder={'e.g. Solve for $x$:  $$x^2 - 5x + 6 = 0$$'}
        />
        <ImageManager images={images} onChange={onImagesChange} />

        {/* MCQ options */}
        {isMcq && (
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[#062E63]">Options — select the correct one</label>
            {options.map((opt, i) => (
              <div key={opt.label} className="flex items-start gap-2">
                <button type="button" onClick={() => setCorrectOption(opt.label)}
                  title="Mark correct"
                  className={`mt-1 w-7 h-7 shrink-0 rounded-full text-xs font-bold border transition ${correctOption === opt.label ? 'bg-[#16A34A] text-white border-[#16A34A]' : 'bg-white text-[#2A2035]/50 border-[#DEE7FF] hover:border-[#16A34A]'}`}>
                  {opt.label}
                </button>
                <div className="flex-1">
                  <LatexField value={opt.latex} rows={1}
                    onChange={(v) => setOptions((os) => os.map((o, j) => (j === i ? { ...o, latex: v } : o)))}
                    placeholder={`Option ${opt.label}…`} />
                </div>
              </div>
            ))}
            <p className="text-[11px] text-[#2A2035]/40">Correct answer: <span className="font-bold text-[#16A34A]">{correctOption}</span></p>
          </div>
        )}

        {(isMcq || !isMulti) && (
          <>
            <LatexField
              label={isMcq ? 'Explanation (shown in the solutions)' : 'Worked solution (answer key)'}
              value={solution} onChange={setSolution} rows={isMcq ? 2 : 4}
              placeholder={'e.g. Factorising: $$(x-2)(x-3)=0 \\Rightarrow x=2,3$$'} />
            <ImageManager label="Solution figures / images" images={solutionImages} onChange={onSolutionImagesChange} />
          </>
        )}
        {!isMcq && !isMulti && Number(marks) > 1 && (
          <CriteriaEditor marks={marks} value={criteria} onChange={setCriteria} />
        )}
      </section>

      {/* Parts */}
      {isMulti && !isMcq && (
        <section className="bg-white rounded-2xl border border-[#F0F4FF] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#062E63]">Parts</h2>
            <button type="button"
              onClick={() => setParts((ps) => [...ps, blankPart(ps.length)])}
              className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63]">+ Add part</button>
          </div>
          {parts.map((p) => (
            <div key={p._key} className="rounded-xl border border-[#DEE7FF] p-4 bg-[#FBFCFF] space-y-3">
              <div className="flex items-center gap-2">
                <input value={p.part_label} onChange={(e) => updatePart(p._key, 'part_label', e.target.value)}
                  className="w-12 border border-[#DEE7FF] rounded-lg px-2 py-1 text-sm font-bold text-center focus:outline-none focus:border-[#325099]" />
                <span className="text-[11px] text-[#2A2035]/40">part label</span>
                <input type="number" min="0" value={p.marks} placeholder="marks"
                  onChange={(e) => updatePart(p._key, 'marks', e.target.value)}
                  className="w-20 ml-auto border border-[#DEE7FF] rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[#325099]" />
                {parts.length > 1 && (
                  <button type="button" onClick={() => setParts((ps) => ps.filter((x) => x._key !== p._key))}
                    className="text-[11px] text-[#DC2626] hover:underline">Remove</button>
                )}
              </div>
              <LatexField value={p.prompt_latex} onChange={(v) => updatePart(p._key, 'prompt_latex', v)}
                rows={2} placeholder="Part prompt…" />
              <LatexField value={p.solution_latex} onChange={(v) => updatePart(p._key, 'solution_latex', v)}
                rows={2} placeholder="Part solution…" />
              {Number(p.marks) > 1 && (
                <CriteriaEditor marks={p.marks} value={p.criteria} onChange={(c) => updatePart(p._key, 'criteria', c)} />
              )}
            </div>
          ))}
        </section>
      )}

      {error && <p className="text-sm text-[#DC2626]">{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-50">
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Add to bank'}
        </button>
        <button onClick={() => (onCancel ? onCancel() : router.push('/tutor/qbank'))}
          className="px-5 py-2.5 rounded-xl border border-[#DEE7FF] text-sm font-semibold text-[#2A2035]/60 hover:bg-[#F8FAFF] transition">
          Cancel
        </button>
      </div>
    </div>
  )
}
