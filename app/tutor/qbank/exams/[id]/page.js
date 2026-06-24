'use client'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../../lib/supabase'
import { getAuthProfile } from '../../../../../lib/getProfile'
import TutorNav from '../../../../../components/TutorNav'
import LatexContent from '../../../../../components/qbank/LatexContent'
import { T_QBANK_QUESTIONS } from '../../../../../lib/tables'
import { fetchTaxonomy, DIFFICULTY_LABELS, DIFFICULTY_COLORS, fetchQuestionUsage } from '../../../../../lib/qbank'
import UsageBadge from '../../../../../components/qbank/UsageBadge'
import PdfPreviewModal from '../../../../../components/qbank/PdfPreviewModal'
import QuickEditModal from '../../../../../components/qbank/QuickEditModal'
import QuestionEditor from '../../../../../components/qbank/QuestionEditor'
import { loadExam, saveExam, blankSlot, buildExamRenderPayload } from '../../../../../lib/qbankExams'
import { exportExamPdf, renderExamPreview } from '../../../../../lib/qbankExam'
import DocLivePreview from '../../../../../components/qbank/DocLivePreview'
import { listRubrics, blankBands, blankCriterion, normaliseRubric, createRubricFrom } from '../../../../../lib/rubrics'
import RubricGridEditor from '../../../../../components/qbank/RubricGridEditor'

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']
const qMarks = (q) => {
  if (!q) return 0
  if (q.qtype === 'mcq') return q.marks ?? 1
  const parts = q.qbank_question_parts || []
  if (parts.length) return parts.reduce((s, p) => s + (Number(p.marks) || 0), 0)
  return Number(q.marks) || 0
}

export default function ExamBuilderPage() {
  const router = useRouter()
  const { id } = useParams()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)

  const [exam, setExam] = useState(null)        // { ...meta, sections:[...] }
  const [tax, setTax] = useState(null)
  const [questions, setQuestions] = useState([])
  const [usageMap, setUsageMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('plan')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState('')
  const [dragSlot, setDragSlot] = useState(null)   // { secKey, slotKey } being dragged
  const [preview, setPreview] = useState(null)     // { url, filename, title } for the PDF preview modal
  const closePreview = () => { if (preview?.url) URL.revokeObjectURL(preview.url); setPreview(null) }
  const [editQ, setEditQ] = useState(null)         // bank question being quick-edited
  const [newQ, setNewQ] = useState(null)           // { secKey, slotKey, topic_id, skill_id } — creating a new bank question for a slot
  const [rubrics, setRubrics] = useState([])       // marking rubrics for English papers

  // Autosave plumbing: refs keep the latest exam + in-flight state so debounced
  // saves never race or persist a stale snapshot.
  const examRef = useRef(null)
  const savingRef = useRef(false)
  const pendingRef = useRef(false)
  const dirtyRef = useRef(false)

  const loadQuestions = useCallback(() => supabase.from(T_QBANK_QUESTIONS)
    .select('*, qbank_question_parts(*), qbank_question_images(id, storage_path, alt, sort_order, role)')
    .then(({ data }) => setQuestions(data || [])), [])

  useEffect(() => {
    getAuthProfile().then(async ({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
      const [e, t] = await Promise.all([loadExam(id), fetchTaxonomy()])
      setExam(e); setTax(t); await loadQuestions()
      fetchQuestionUsage().then(setUsageMap)
      listRubrics().then(setRubrics)
      setLoading(false)
    })
  }, [router, id, loadQuestions])

  // ── taxonomy maps ───────────────────────────────────────────────────────────
  const maps = useMemo(() => {
    if (!tax) return null
    return {
      skill: Object.fromEntries(tax.skills.map((s) => [s.id, s])),
      subtopic: Object.fromEntries(tax.subtopics.map((st) => [st.id, st])),
      topic: Object.fromEntries(tax.topics.map((t) => [t.id, t])),
      subject: Object.fromEntries(tax.subjects.map((s) => [s.id, s])),
    }
  }, [tax])
  const qById = useMemo(() => Object.fromEntries(questions.map((q) => [q.id, q])), [questions])
  const rubricById = useMemo(() => Object.fromEntries(rubrics.map((r) => [r.id, r])), [rubrics])
  const isEnglish = exam?.paper_type === 'english'
  const qTopicId = useCallback((q) => maps?.skill[q.skill_id]?.topic_id || q.topic_id, [maps])
  const qSubtopicId = useCallback((q) => maps?.skill[q.skill_id]?.subtopic_id || q.subtopic_id, [maps])

  const yearLabel = exam?.year_label
  const subjectId = exam?.subject_id
  const years = useMemo(() => (tax ? [...new Set(tax.subjects.map((s) => s.year_level))].sort((a, b) => a - b) : []), [tax])
  // Exam subject (maths/english) + year → the matching qbank_subject that drives topic scope.
  const subjectFor = useCallback((yr, paper) => {
    const subs = (tax?.subjects || []).filter((s) => String(s.year_level) === String(yr))
    const re = paper === 'english' ? /english|eald|eal/i : /math/i
    return (subs.find((s) => re.test(s.name)) || subs[0])?.id || null
  }, [tax])
  const scopeTopics = useMemo(() => (tax && subjectId ? (tax.topicsBySubject[subjectId] || []) : []), [tax, subjectId])

  // ── mutators ──────────────────────────────────────────────────────────────
  const patch = (fields) => { setExam((e) => ({ ...e, ...fields })); setDirty(true) }
  const setSections = (fn) => { setExam((e) => ({ ...e, sections: fn(e.sections) })); setDirty(true) }
  const updateSection = (key, fields) => setSections((ss) => ss.map((s) => (s._key === key ? { ...s, ...fields } : s)))
  const addSlot = (key) => setSections((ss) => ss.map((s) => (s._key === key ? { ...s, slots: [...s.slots, blankSlot()] } : s)))
  const removeSlot = (secKey, slotKey) => setSections((ss) => ss.map((s) => (s._key !== secKey ? s : { ...s, slots: s.slots.filter((sl) => sl._key !== slotKey) })))
  // Move slot `fromKey` to the position of `toKey` within the same section (drag-reorder).
  const reorderSlot = (secKey, fromKey, toKey) => {
    if (fromKey === toKey) return
    setSections((ss) => ss.map((s) => {
      if (s._key !== secKey) return s
      const slots = [...s.slots]
      const from = slots.findIndex((sl) => sl._key === fromKey)
      const to = slots.findIndex((sl) => sl._key === toKey)
      if (from < 0 || to < 0) return s
      const [moved] = slots.splice(from, 1)
      slots.splice(to, 0, moved)
      return { ...s, slots }
    }))
  }
  const addSection = (type) => setSections((ss) => [...ss, { _key: Math.random().toString(36).slice(2, 9), type, marks_limit: type === 'mcq' ? 10 : 20, allow_time: type === 'mcq' ? '15 minutes' : '45 minutes', slots: [] }])
  const removeSection = (key) => setSections((ss) => ss.filter((s) => s._key !== key))
  const moveSection = (key, dir) => setSections((ss) => {
    const i = ss.findIndex((s) => s._key === key); const j = i + dir
    if (i < 0 || j < 0 || j >= ss.length) return ss
    const next = [...ss];[next[i], next[j]] = [next[j], next[i]]; return next
  })
  const updateSlot = (secKey, slotKey, fields) => setSections((ss) => ss.map((s) => (s._key !== secKey ? s
    : { ...s, slots: s.slots.map((sl) => (sl._key === slotKey ? { ...sl, ...fields } : sl)) })))

  const toggleTopic = (topicId) => {
    const set = new Set(exam.topic_ids || [])
    set.has(topicId) ? set.delete(topicId) : set.add(topicId)
    patch({ topic_ids: [...set] })
  }

  // ── used question ids (for dup-block) ───────────────────────────────────────
  const usedIds = useMemo(() => {
    const m = new Map()  // questionId -> slotKey
    exam?.sections?.forEach((s) => s.slots.forEach((sl) => { if (sl.question_id) m.set(sl.question_id, sl._key) }))
    return m
  }, [exam])

  const matchesFor = useCallback((section, slot) => {
    if (!maps) return []
    const scope = exam.topic_ids || []
    return questions.filter((q) => {
      if (q.audience === 'student') return false   // student-only questions never go into exams
      if (q.qtype !== section.type) return false
      const usedBy = usedIds.get(q.id)
      if (usedBy && usedBy !== slot._key) return false
      const tId = qTopicId(q)
      if (scope.length && !scope.includes(tId)) return false
      if (slot.topic_id && tId !== slot.topic_id) return false
      if (slot.subtopic_id && qSubtopicId(q) !== slot.subtopic_id) return false
      if (slot.skill_id && q.skill_id !== slot.skill_id) return false
      if (slot.difficulty && q.difficulty !== Number(slot.difficulty)) return false
      return true
    })
  }, [questions, maps, exam, usedIds, qTopicId, qSubtopicId])

  // ── persistence ─────────────────────────────────────────────────────────────
  // Keep refs current so the autosave loop always reads the latest values.
  useEffect(() => { examRef.current = exam }, [exam])
  useEffect(() => { dirtyRef.current = dirty }, [dirty])

  // Persist the latest exam snapshot. Re-entrant-safe: if a save is already in
  // flight, flag a follow-up instead of starting an overlapping save.
  const save = useCallback(async () => {
    if (savingRef.current) { pendingRef.current = true; return }
    if (!examRef.current) return
    savingRef.current = true; setSaving(true)
    try {
      // Loop so edits made mid-save get persisted without overlapping writes.
      do {
        pendingRef.current = false
        await saveExam(examRef.current)
      } while (pendingRef.current)
      setDirty(false)
    } catch (e) {
      console.error('Exam autosave failed:', e)
    } finally {
      savingRef.current = false; setSaving(false)
    }
  }, [])

  // Debounced autosave — fires ~1s after the last edit.
  useEffect(() => {
    if (!ready || loading || !dirty) return
    const t = setTimeout(() => { save() }, 1000)
    return () => clearTimeout(t)
  }, [dirty, exam, ready, loading, save])

  // Best-effort flush of any unsaved edits when leaving the builder.
  useEffect(() => () => { if (dirtyRef.current) save() }, [save])

  const sectionMarks = (s) => s.slots.reduce((sum, sl) => sum + qMarks(qById[sl.question_id]), 0)
  const totalMarks = exam?.sections?.reduce((a, s) => a + sectionMarks(s), 0) || 0
  // Marks per topic within a section → [[topicName, marks], …] sorted desc.
  const sectionTopicMarks = (s) => {
    const m = {}
    s.slots.forEach((sl) => {
      const q = qById[sl.question_id]; if (!q) return
      const tId = maps?.skill[q.skill_id]?.topic_id || q.topic_id
      const name = (tId && maps?.topic[tId]?.name) || 'Untagged'
      m[name] = (m[name] || 0) + qMarks(q)
    })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }

  // Shared payload for both the PDF export and the live preview.
  const buildMeta = useCallback(() => ({
    yearLabel: exam?.year_label, term: exam?.term, paperType: exam?.paper_type || 'maths',
    readingTime: exam?.reading_time, workingTime: exam?.working_time, calculators: exam?.calculators,
  }), [exam])
  // Shared with the curriculum exam assign + student reports (single source of truth).
  const buildSections = useCallback(() => buildExamRenderPayload({ exam, questions, rubrics }).sections, [exam, questions, rubrics])

  const [previewSolutions, setPreviewSolutions] = useState(false)
  const renderPreview = useCallback((container) => renderExamPreview(container, { meta: buildMeta(), sections: buildSections(), solutions: previewSolutions }), [buildMeta, buildSections, previewSolutions])
  const previewSig = useMemo(() => JSON.stringify({
    m: buildMeta(),
    s: (exam?.sections || []).map((s) => ({ t: s.type, a: s.allow_time, q: s.slots.map((sl) => [sl.question_id, sl.working_lines, sl.rubric_id, sl.custom_rubric, sl.show_notes, sl.notes]) })),
    sol: previewSolutions, ql: questions.length,
  }), [exam, buildMeta, previewSolutions, questions.length])

  const doExport = async (solutions) => {
    await save()
    setBusy(solutions ? 'sol' : 'paper')
    try {
      const payload = buildSections()
      if (!payload.some((s) => s.questions.length)) { alert('Fill at least one question first.'); return }
      const res = await exportExamPdf({ meta: buildMeta(), sections: payload, solutions, preview: true })
      if (res?.url) setPreview({ url: res.url, filename: res.filename, title: solutions ? 'Solutions — preview' : 'Exam paper — preview' })
    } catch (e) { alert('Could not generate PDF: ' + (e.message || e)) }
    finally { setBusy('') }
  }

  // Open the question editor in a modal, pre-classified to the slot's topic/skill.
  const newQuestion = (ctx = null) => setNewQ(ctx || {})
  // After saving the new bank question, refresh the bank and drop it into the slot.
  const onNewQuestionSaved = async (qid) => {
    await loadQuestions()
    if (newQ?.slotKey) updateSlot(newQ.secKey, newQ.slotKey, { question_id: qid })
    setNewQ(null)
  }

  if (!ready || loading) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>
  if (!exam) return (
    <div className="min-h-screen bg-[#F8FAFF]"><TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-3xl mx-auto px-6 pt-16 text-center"><p className="text-sm text-[#2A2035]/50">Exam not found.</p>
        <Link href="/tutor/qbank/exams" className="text-xs text-[#325099] hover:underline">← Back to exams</Link></div>
    </div>
  )

  const inCls = 'w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm text-[#2A2035] focus:outline-none focus:border-[#325099]'
  const selCls = 'border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'
  const sectionStart = (si) => exam.sections.slice(0, si).reduce((a, sec) => a + sec.slots.length, 0)

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className={`${tab === 'build' ? 'max-w-[1480px]' : 'max-w-5xl'} mx-auto px-6 pt-8 pb-16`}>
        <Link href="/tutor/qbank/exams" className="text-xs text-[#325099] hover:underline">← Exams</Link>

        {/* Header */}
        <div className="flex items-center gap-3 mt-1 mb-4 flex-wrap">
          <input value={exam.title} onChange={(e) => patch({ title: e.target.value })}
            className="text-2xl font-bold text-[#062E63] bg-transparent border-b border-transparent hover:border-[#DEE7FF] focus:border-[#325099] focus:outline-none flex-1 min-w-[200px]" />
          <span className="text-xs text-[#2A2035]/50">{totalMarks} marks</span>
          <button onClick={save} disabled={saving} title="Changes save automatically — click to save now"
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${saving ? 'bg-[#EEF2FF] text-[#2A2035]/40' : dirty ? 'bg-[#EEF2FF] text-[#325099]' : 'bg-[#EEF2FF] text-[#16A34A]'}`}>
            {saving ? 'Saving…' : dirty ? 'Autosaving…' : 'Saved ✓'}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 border-b border-[#DEE7FF]">
          {[['plan', '1 · Plan'], ['build', '2 · Questions']].map(([v, lbl]) => (
            <button key={v} onClick={() => setTab(v)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${tab === v ? 'border-[#325099] text-[#062E63]' : 'border-transparent text-[#2A2035]/40 hover:text-[#2A2035]/70'}`}>
              {lbl}
            </button>
          ))}
        </div>

        {tab === 'plan' ? (
          <div className="space-y-5">
            {/* Details */}
            <section className="bg-white rounded-2xl border border-[#F0F4FF] p-5">
              <h2 className="text-sm font-bold text-[#062E63] mb-3">Exam details</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div><label className="text-[11px] font-semibold text-[#2A2035]/50">Exam subject</label>
                  <select value={exam.paper_type || 'maths'} className={inCls}
                    onChange={(e) => patch({ paper_type: e.target.value, subject_id: subjectFor(exam.year_label, e.target.value), topic_ids: [] })}>
                    <option value="maths">Maths</option><option value="english">English</option>
                  </select></div>
                <div><label className="text-[11px] font-semibold text-[#2A2035]/50">Year</label>
                  <select value={exam.year_label || ''} className={inCls}
                    onChange={(e) => patch({ year_label: e.target.value, subject_id: subjectFor(e.target.value, exam.paper_type || 'maths'), topic_ids: [] })}>
                    <option value="">—</option>{years.map((y) => <option key={y} value={String(y)}>Year {y}</option>)}
                  </select></div>
                <div><label className="text-[11px] font-semibold text-[#2A2035]/50">Term</label>
                  <select value={exam.term || ''} onChange={(e) => patch({ term: e.target.value })} className={inCls}>
                    <option value="">—</option>{['1', '2', '3', '4'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select></div>
                <div><label className="text-[11px] font-semibold text-[#2A2035]/50">Reading time</label>
                  <input value={exam.reading_time || ''} onChange={(e) => patch({ reading_time: e.target.value })} className={inCls} /></div>
                <div><label className="text-[11px] font-semibold text-[#2A2035]/50">Working time</label>
                  <input value={exam.working_time || ''} onChange={(e) => patch({ working_time: e.target.value })} className={inCls} /></div>
                <label className="flex items-center gap-2 text-xs font-semibold text-[#062E63] self-end pb-2 cursor-pointer">
                  <input type="checkbox" checked={exam.calculators} onChange={(e) => patch({ calculators: e.target.checked })} /> Calculators (NESA)
                </label>
              </div>
            </section>

            {/* Topic scope */}
            <section className="bg-white rounded-2xl border border-[#F0F4FF] p-5">
              <h2 className="text-sm font-bold text-[#062E63] mb-1">Topic scope</h2>
              <p className="text-[11px] text-[#2A2035]/50 mb-3">The topics this exam covers. Question slots can only pull from these.</p>
              {!exam.subject_id ? <p className="text-xs text-[#2A2035]/40 italic">Pick a year and exam subject first.</p>
                : scopeTopics.length === 0 ? <p className="text-xs text-[#EA580C]">No topics for this subject — add some in <Link href="/tutor/qbank/categories" className="underline">Categories</Link>.</p>
                  : <div className="flex flex-wrap gap-2">
                    {scopeTopics.map((t) => {
                      const on = (exam.topic_ids || []).includes(t.id)
                      return <button key={t.id} onClick={() => toggleTopic(t.id)}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${on ? 'bg-[#325099] text-white border-[#325099]' : 'bg-white text-[#2A2035]/60 border-[#DEE7FF] hover:border-[#325099]'}`}>{t.name}</button>
                    })}
                  </div>}
            </section>

            {/* Sections */}
            <section className="bg-white rounded-2xl border border-[#F0F4FF] p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-[#062E63]">Sections</h2>
                <div className="flex gap-2">
                  <button onClick={() => addSection('mcq')} className="text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 hover:bg-[#F8FAFF]">+ MCQ</button>
                  <button onClick={() => addSection('extended')} className="text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 hover:bg-[#F8FAFF]">+ Extended</button>
                </div>
              </div>
              <div className="space-y-3">
                {exam.sections.map((s, i) => (
                  <div key={s._key} className="rounded-xl border border-[#DEE7FF] p-4 bg-[#FBFCFF]">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm font-bold text-[#062E63]">Section {ROMAN[i]}</span>
                      <select value={s.type} onChange={(e) => updateSection(s._key, { type: e.target.value })} className={selCls}>
                        <option value="mcq">Multiple choice</option><option value="extended">Extended response</option>
                      </select>
                      <span className="text-[11px] text-[#2A2035]/40 ml-auto">{sectionMarks(s)}/{s.marks_limit ?? '—'} marks</span>
                      <button onClick={() => moveSection(s._key, -1)} disabled={i === 0} className="text-xs text-[#2A2035]/40 hover:text-[#325099] disabled:opacity-20">▲</button>
                      <button onClick={() => moveSection(s._key, 1)} disabled={i === exam.sections.length - 1} className="text-xs text-[#2A2035]/40 hover:text-[#325099] disabled:opacity-20">▼</button>
                      {exam.sections.length > 1 && <button onClick={() => removeSection(s._key)} className="text-[11px] text-[#DC2626] hover:underline">✕</button>}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="text-[10px] font-semibold text-[#2A2035]/50">Marks limit</label>
                        <input type="number" min="0" value={s.marks_limit ?? ''} onChange={(e) => updateSection(s._key, { marks_limit: e.target.value === '' ? null : parseInt(e.target.value, 10) })} className="w-full border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#325099]" /></div>
                      <div><label className="text-[10px] font-semibold text-[#2A2035]/50">Allow about</label>
                        <input value={s.allow_time || ''} onChange={(e) => updateSection(s._key, { allow_time: e.target.value })} className="w-full border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#325099]" /></div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setTab('build')} className="mt-4 px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition">Fill questions →</button>
            </section>
          </div>
        ) : (
          /* ── BUILD / FILL TAB ─────────────────────────────────────────────── */
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-6 items-start">
            <div className="space-y-5 min-w-0">
            {exam.sections.length === 0 && (
              <p className="text-sm text-[#2A2035]/50 bg-white rounded-2xl border border-dashed border-[#DEE7FF] p-6 text-center">
                Add a section in the <button onClick={() => setTab('plan')} className="text-[#325099] font-semibold hover:underline">Plan</button> tab first.
              </p>
            )}
            {exam.sections.map((s, si) => (
              <section key={s._key} className="bg-white rounded-2xl border border-[#F0F4FF] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-bold text-[#062E63]">Section {ROMAN[si]}</h2>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#EEF2FF] text-[#4338CA]">{s.type === 'mcq' ? 'Multiple choice' : 'Extended'}</span>
                  <span className={`text-[11px] ml-auto ${s.marks_limit != null && sectionMarks(s) > s.marks_limit ? 'text-[#DC2626] font-semibold' : 'text-[#2A2035]/40'}`}>{sectionMarks(s)}{s.marks_limit != null ? ` / ${s.marks_limit}` : ''} marks · {s.slots.length} Q</span>
                </div>
                {sectionTopicMarks(s).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="text-[10px] font-semibold text-[#2A2035]/40 self-center">By topic:</span>
                    {sectionTopicMarks(s).map(([name, marks]) => (
                      <span key={name} className="text-[10px] text-[#325099] bg-[#F0F4FF] rounded-full px-2 py-0.5">{name}: {marks}</span>
                    ))}
                  </div>
                )}
                <div className="space-y-3">
                  {s.slots.map((slot, sli) => {
                    const n = sectionStart(si) + sli + 1
                    return <SlotRow key={slot._key} n={n} section={s} slot={slot}
                      scopeTopics={scopeTopics} tax={tax} maps={maps} qById={qById} usageMap={usageMap}
                      paperEnglish={isEnglish} rubrics={rubrics} onRubricsChanged={() => listRubrics().then(setRubrics)}
                      matches={matchesFor(s, slot)}
                      onCriteria={(f) => updateSlot(s._key, slot._key, f)}
                      onPick={(qid) => updateSlot(s._key, slot._key, { question_id: qid })}
                      onRemove={() => removeSlot(s._key, slot._key)}
                      onNew={() => newQuestion({ secKey: s._key, slotKey: slot._key, topic_id: slot.topic_id, subtopic_id: slot.subtopic_id, skill_id: slot.skill_id })}
                      onRefresh={loadQuestions} onEdit={setEditQ}
                      dragging={dragSlot?.slotKey === slot._key}
                      onDragStart={() => setDragSlot({ secKey: s._key, slotKey: slot._key })}
                      onDragEnter={() => { if (dragSlot && dragSlot.secKey === s._key) reorderSlot(s._key, dragSlot.slotKey, slot._key) }}
                      onDragEnd={() => setDragSlot(null)} />
                  })}
                </div>
                <button onClick={() => addSlot(s._key)}
                  className="mt-3 text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg px-3 py-1.5 hover:bg-[#F8FAFF]">
                  + Add question
                </button>
              </section>
            ))}

            <div className="flex gap-2 sticky bottom-3">
              <button onClick={() => doExport(false)} disabled={busy}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-40 shadow-sm">
                {busy === 'paper' ? 'Building…' : 'Exam paper PDF'}
              </button>
              <button onClick={() => doExport(true)} disabled={busy}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#325099] bg-white text-[#325099] text-sm font-semibold hover:bg-[#F0F4FF] transition disabled:opacity-40 shadow-sm">
                {busy === 'sol' ? 'Building…' : 'Solutions PDF'}
              </button>
            </div>
            </div>
            {/* Live preview column */}
            <div className="hidden xl:block sticky top-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold">Live preview</p>
                <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden text-xs">
                  <button onClick={() => setPreviewSolutions(false)} className={`px-2.5 py-1 font-semibold ${!previewSolutions ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>Paper</button>
                  <button onClick={() => setPreviewSolutions(true)} className={`px-2.5 py-1 font-semibold border-l border-[#DEE7FF] ${previewSolutions ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>Solutions</button>
                </div>
              </div>
              <DocLivePreview render={renderPreview} signature={previewSig} scale={0.72} />
            </div>
          </div>
        )}
      </div>
      {preview && <PdfPreviewModal url={preview.url} filename={preview.filename} title={preview.title} onClose={closePreview} />}
      {editQ && <QuickEditModal question={editQ} onClose={() => setEditQ(null)} onSaved={async () => { await loadQuestions(); setEditQ(null) }} />}
      {newQ && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
          onClick={(e) => { if (e.target === e.currentTarget) setNewQ(null) }}>
          <div className="bg-[#F8FAFF] rounded-2xl shadow-2xl w-full max-w-3xl my-8 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-[#062E63]">New question → bank</h2>
              <button onClick={() => setNewQ(null)} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg">✕</button>
            </div>
            <p className="text-[11px] text-[#2A2035]/50 mb-4">Saved to the question bank and placed straight into this slot.</p>
            <QuestionEditor staffName={profile?.full_name}
              defaults={{ topicId: newQ.topic_id, subtopicId: newQ.subtopic_id, skillId: newQ.skill_id, audience: 'exam' }}
              onSaved={onNewQuestionSaved} onCancel={() => setNewQ(null)} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Slot row ──────────────────────────────────────────────────────────────────
function SlotRow({ n, section, slot, scopeTopics, tax, maps, qById, usageMap, paperEnglish, rubrics, onRubricsChanged, matches, onCriteria, onPick, onRemove, onNew, onRefresh, onEdit, dragging, onDragStart, onDragEnter, onDragEnd }) {
  const [open, setOpen] = useState(false)
  const [savingLib, setSavingLib] = useState(false)
  const handleRubricSelect = (e) => {
    const v = e.target.value
    if (v === '__custom__') {
      const base = slot.rubric_id ? (rubrics || []).find((rb) => rb.id === slot.rubric_id) : null
      const seed = base
        ? { name: `${base.name} (custom)`, bands: base.bands, criteria: base.criteria }
        : { name: 'Custom rubric', bands: blankBands(), criteria: [blankCriterion(5)] }
      onCriteria({ rubric_id: null, custom_rubric: normaliseRubric(seed) })
    } else {
      onCriteria({ rubric_id: v || null, custom_rubric: null })
    }
  }
  const saveCustomToLibrary = async () => {
    setSavingLib(true)
    try {
      const newId = await createRubricFrom(slot.custom_rubric)
      await onRubricsChanged?.()
      onCriteria({ rubric_id: newId, custom_rubric: null })
    } catch (err) { alert('Save failed: ' + err.message) }
    finally { setSavingLib(false) }
  }
  const chosen = slot.question_id ? qById[slot.question_id] : null
  const subtopicsForTopic = (tax && slot.topic_id) ? (tax.subtopicsByTopic[slot.topic_id] || []) : []
  const skillsForSubtopic = (tax && slot.subtopic_id) ? (tax.skillsBySubtopic[slot.subtopic_id] || []) : []
  const selCls = 'border border-[#DEE7FF] rounded-lg px-2 py-1 text-[11px] text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'

  // Per-paper working-line overrides for this slot. Map of part_label (or "_" for a
  // single-part question) → line count; blank removes the override (auto from marks).
  const chosenParts = (chosen?.qbank_question_parts || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const setLines = (key, val) => {
    const next = { ...(slot.working_lines || {}) }
    if (val === '' || val == null) delete next[key]
    else next[key] = Math.max(0, parseInt(val, 10) || 0)
    onCriteria({ working_lines: Object.keys(next).length ? next : null })
  }
  const lineInputCls = 'w-12 border border-[#DEE7FF] rounded px-1.5 py-0.5 text-[11px] text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={onDragEnter}
      className={`rounded-xl border bg-[#FBFCFF] p-3 transition ${dragging ? 'opacity-40 border-[#325099] border-dashed' : 'border-[#F0F4FF]'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
          className="cursor-grab active:cursor-grabbing text-[#2A2035]/30 hover:text-[#325099] select-none text-base leading-none -ml-0.5">⠿</span>
        <span className="text-sm font-bold text-[#062E63]">Q{n}</span>
        <select value={slot.topic_id || ''} onChange={(e) => onCriteria({ topic_id: e.target.value || null, subtopic_id: null, skill_id: null })} className={selCls}>
          <option value="">Any topic (in scope)</option>
          {scopeTopics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={slot.subtopic_id || ''} disabled={!slot.topic_id} onChange={(e) => onCriteria({ subtopic_id: e.target.value || null, skill_id: null })} className={selCls}>
          <option value="">Any subtopic</option>
          {subtopicsForTopic.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
        </select>
        <select value={slot.skill_id || ''} disabled={!slot.subtopic_id} onChange={(e) => onCriteria({ skill_id: e.target.value || null })} className={selCls}>
          <option value="">Any skill</option>
          {skillsForSubtopic.map((sk) => <option key={sk.id} value={sk.id}>{sk.name}</option>)}
        </select>
        <select value={slot.difficulty || ''} onChange={(e) => onCriteria({ difficulty: e.target.value ? Number(e.target.value) : null })} className={selCls}>
          <option value="">Any difficulty</option>
          {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d} · {DIFFICULTY_LABELS[d]}</option>)}
        </select>
        <span className="text-[11px] text-[#2A2035]/40 ml-auto">{matches.length} match{matches.length === 1 ? '' : 'es'}</span>
        <button onClick={onRemove} title="Remove this question" className="text-[12px] text-[#2A2035]/30 hover:text-[#DC2626]">✕</button>
      </div>

      {chosen ? (
        <>
          <div className="mt-2 flex items-start gap-2 bg-white rounded-lg border border-[#BACBFF] p-2.5">
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-white mt-0.5" style={{ background: DIFFICULTY_COLORS[chosen.difficulty] }}>{chosen.difficulty}</span>
            <div className="flex-1 min-w-0 text-[13px] text-[#2A2035] line-clamp-2"><LatexContent text={chosen.stem_latex || '(no stem)'} /></div>
            <UsageBadge usage={usageMap[chosen.id]} />
            <span className="text-[10px] text-[#2A2035]/40 whitespace-nowrap">{qMarks(chosen)}m</span>
            <button onClick={() => onEdit(chosen)} className="text-[11px] text-[#325099] hover:underline">Edit</button>
            <button onClick={() => onPick(null)} className="text-[11px] text-[#DC2626] hover:underline">Clear</button>
          </div>
          {section.type !== 'mcq' && (
            <div className="mt-2 flex items-center gap-2 flex-wrap pl-1">
              <span className="text-[11px] font-semibold text-[#2A2035]/60">Working lines:</span>
              {chosenParts.length ? chosenParts.map((p, i) => {
                const lbl = p.part_label || 'abcdefgh'[i] || String(i + 1)
                return (
                  <label key={p.id || lbl} className="flex items-center gap-1 text-[11px] text-[#2A2035]/55">
                    <span className="font-semibold">{lbl})</span>
                    <input type="number" min="0" placeholder="auto" value={slot.working_lines?.[lbl] ?? ''}
                      onChange={(e) => setLines(lbl, e.target.value)} className={lineInputCls} />
                  </label>
                )
              }) : (
                <input type="number" min="0" placeholder="auto" value={slot.working_lines?.['_'] ?? ''}
                  onChange={(e) => setLines('_', e.target.value)} className={lineInputCls} />
              )}
              <span className="text-[10px] text-[#2A2035]/35">blank = auto from marks</span>
            </div>
          )}
          {section.type !== 'mcq' && paperEnglish && (
            <div className="mt-2 pl-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold text-[#2A2035]/60">Marking rubric:</span>
                <select value={slot.custom_rubric ? '__custom__' : (slot.rubric_id || '')} onChange={handleRubricSelect} className={selCls}>
                  <option value="">— none —</option>
                  {(rubrics || []).map((rb) => <option key={rb.id} value={rb.id}>{rb.name}</option>)}
                  <option value="__custom__">✎ Custom…</option>
                </select>
                <Link href="/tutor/qbank/rubrics" target="_blank" className="text-[10px] text-[#325099] hover:underline">manage</Link>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[#2A2035]/60 cursor-pointer ml-2">
                  <input type="checkbox" checked={slot.show_notes !== false} onChange={(e) => onCriteria({ show_notes: e.target.checked })} />
                  Sample / marker notes
                </label>
              </div>
              {slot.show_notes !== false && (
                <textarea value={slot.notes || ''} onChange={(e) => onCriteria({ notes: e.target.value })}
                  placeholder="Sample answer / marking notes for this question (shown on the Solutions copy)…"
                  className="mt-2 w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-[12px] text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] resize-y min-h-[52px]" />
              )}
              {slot.custom_rubric && (
                <div className="mt-2 border border-[#DEE7FF] rounded-xl p-3 bg-white">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <input value={slot.custom_rubric.name || ''} onChange={(e) => onCriteria({ custom_rubric: { ...slot.custom_rubric, name: e.target.value } })} placeholder="Rubric title" className="text-sm font-semibold text-[#2A2035] border-b border-transparent hover:border-[#DEE7FF] focus:border-[#325099] focus:outline-none flex-1 min-w-0" />
                    <button onClick={saveCustomToLibrary} disabled={savingLib} className="text-[11px] font-semibold text-[#16A34A] hover:underline disabled:opacity-40 whitespace-nowrap">{savingLib ? 'Saving…' : '⬆ Save to library'}</button>
                  </div>
                  <RubricGridEditor value={slot.custom_rubric} onChange={(next) => onCriteria({ custom_rubric: next })} compact />
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <button onClick={() => setOpen((o) => !o)} className="text-[11px] font-semibold text-[#325099] hover:underline">{open ? 'Hide' : 'Choose'} matching question{matches.length ? ` (${matches.length})` : ''}</button>
            <button onClick={onRefresh} title="Refresh bank" className="text-[11px] text-[#2A2035]/40 hover:text-[#325099]">↻</button>
            <button onClick={onNew} className="text-[11px] font-semibold text-[#16A34A] hover:underline ml-auto">+ Create new</button>
          </div>
          {open && (
            <div className="mt-2 space-y-1.5 max-h-60 overflow-y-auto">
              {matches.length === 0 ? <p className="text-[11px] text-[#2A2035]/40 italic">No bank questions match — adjust the criteria or create one.</p>
                : matches.map((q) => (
                  <button key={q.id} onClick={() => { onPick(q.id); setOpen(false) }}
                    className="w-full text-left flex items-start gap-2 bg-white rounded-lg border border-[#F0F4FF] hover:border-[#325099] p-2.5 transition">
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-white mt-0.5" style={{ background: DIFFICULTY_COLORS[q.difficulty] }}>{q.difficulty}</span>
                    <div className="flex-1 min-w-0 text-[13px] text-[#2A2035] line-clamp-2"><LatexContent text={q.stem_latex || '(no stem)'} /></div>
                    <UsageBadge usage={usageMap[q.id]} />
                    <span className="text-[10px] text-[#2A2035]/40 whitespace-nowrap">{qMarks(q)}m</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
