'use client'
import { useEffect, useMemo, useState, useCallback, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { requireStudent } from '../../lib/requireStudent'
import PortalNav from '../../components/PortalNav'
import SearchSelectPopover from '../../components/SearchSelectPopover'
import LatexContent from '../../components/qbank/LatexContent'
import { inferSubject, subjectsMatch } from '../../components/CourseDetail'
import { fetchAllTerms, getCurrentTerm } from '../../lib/terms'
import { fetchTaxonomy, qbankImageUrl } from '../../lib/qbank'
import { T_STUDENTS, T_STUDENT_WORKSHEETS, T_QBANK_QUESTIONS } from '../../lib/tables'
import { enrolledClassesForTerm } from '../../lib/classes'

/*
 * Resources — students REQUEST a practice worksheet (they don't hand-pick).
 * They choose subject + topic + difficulty + length; the system pulls a
 * balanced random set scoped to their year/enrolled subjects, shows it on-device
 * with an optional answer key, and can save it to revisit (student_worksheets).
 */

const DIFF_BANDS = { easy: [1, 2], medium: [3], hard: [4, 5] }
// Year from a class name like "Y9 Maths" or "Year 9 English".
const parseYear = (name) => {
  const m = String(name || '').match(/\by(?:ear)?\s*(\d{1,2})/i)
  return m ? parseInt(m[1], 10) : null
}
const shuffle = (arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }
  return a
}
// Spread the pick across skills (round-robin over shuffled per-skill buckets) so
// a worksheet isn't all one skill or one difficulty, then shuffle the order.
function pickBalanced(pool, n) {
  const groups = {}
  for (const q of pool) (groups[q.skill_id || '_'] ||= []).push(q)
  const buckets = Object.values(groups).map(g => shuffle(g))
  const out = []
  let progressed = true
  while (out.length < n && progressed) {
    progressed = false
    for (const b of buckets) {
      if (out.length >= n) break
      if (b.length) { out.push(b.pop()); progressed = true }
    }
  }
  return shuffle(out)
}

export default function Resources() {
  const router = useRouter()
  const [student, setStudent] = useState(null)
  const [ready, setReady] = useState(false)
  const [tax, setTax] = useState(null)
  const [questions, setQuestions] = useState([])
  const [enrolledPairs, setEnrolledPairs] = useState([])   // [{ year, subject }] from enrolled classes
  const [savedSets, setSavedSets] = useState([])

  // request form
  const [subjectId, setSubjectId] = useState('')
  const [subjPop, setSubjPop] = useState(null)   // anchor rect for the subject popover
  const [emptyModal, setEmptyModal] = useState(false)  // no questions left for this selection
  const [topicIds, setTopicIds] = useState([])   // [] = all topics in the subject
  const [band, setBand] = useState('')        // '' | 'easy' | 'medium' | 'hard'
  const [qtype, setQtype] = useState('')      // '' | 'mcq' | 'extended'
  const [count, setCount] = useState(20)

  // generated worksheet
  const [worksheet, setWorksheet] = useState([])
  const [title, setTitle] = useState('')
  const [currentSetId, setCurrentSetId] = useState(null)
  const [mode, setMode] = useState('request') // 'request' | 'view'
  const [showAnswers, setShowAnswers] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [genParams, setGenParams] = useState(null) // remembers choices for "Regenerate"

  const loadSets = useCallback(async (sid) => {
    const { data } = await supabase.from(T_STUDENT_WORKSHEETS)
      .select('*').eq('student_id', sid).order('updated_at', { ascending: false })
    setSavedSets(data || [])
  }, [])

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!requireStudent(user, router)) return
      const { data: profile } = await supabase.from(T_STUDENTS).select('*').eq('id', user.id).single()
      setStudent(profile); setReady(true)

      // Classes are per-term rows, so scope to the current term to avoid
      // counting the same class once per term after a rollover.
      const term = getCurrentTerm(await fetchAllTerms())
      const { data: links } = await enrolledClassesForTerm(user.id, term?.id, 'class_name')
      const pairs = (links || []).map(l => {
        const cls = l.classes
        if (!cls) return null
        const y = parseYear(cls.class_name)
        const subj = inferSubject(cls)
        return (y && subj) ? { year: y, subject: subj } : null
      }).filter(Boolean)
      setEnrolledPairs(pairs)

      fetchTaxonomy().then(setTax)
      loadSets(user.id)
      supabase.from(T_QBANK_QUESTIONS)
        .select('*, qbank_question_parts(*), qbank_question_images(id, storage_path, alt, sort_order, role)')
        .then(({ data }) => setQuestions(data || []))
    }
    load()
  }, [router, loadSets])

  const maps = useMemo(() => {
    if (!tax) return null
    return {
      skill: Object.fromEntries(tax.skills.map(s => [s.id, s])),
      topic: Object.fromEntries(tax.topics.map(t => [t.id, t])),
      subject: Object.fromEntries(tax.subjects.map(s => [s.id, s])),
    }
  }, [tax])

  const labelFor = useCallback((q) => {
    if (!maps) return null
    const sk = maps.skill[q.skill_id]
    const tp = (sk && maps.topic[sk.topic_id]) || maps.topic[q.topic_id]
    const su = tp && maps.subject[tp.subject_id]
    return { skill: sk, topic: tp, subject: su }
  }, [maps])

  // Subjects available to this student: match the (year, subject) of each class
  // they're actually enrolled in (fuzzy subject match, e.g. "Maths" ↔ "Mathematics").
  // Falls back to the profile year, then all subjects, so the picker is never empty.
  const mySubjects = useMemo(() => {
    if (!tax) return []
    if (enrolledPairs.length) {
      const f = tax.subjects.filter(s => enrolledPairs.some(p =>
        String(s.year_level) === String(p.year) && subjectsMatch(s.name, p.subject)))
      if (f.length) return f
    }
    if (student?.year) {
      const byYear = tax.subjects.filter(s => String(s.year_level) === String(student.year))
      if (byYear.length) return byYear
    }
    return tax.subjects
  }, [tax, student, enrolledPairs])

  // Effective subject: the student's choice, or the first available subject.
  const selSubjectId = subjectId || mySubjects[0]?.id || ''
  const topicsForSubject = useMemo(() => (tax && selSubjectId ? (tax.topicsBySubject[selSubjectId] || []) : []), [tax, selSubjectId])

  const poolFor = useCallback((p) => {
    if (!maps) return []
    const bandArr = DIFF_BANDS[p.band] || null
    return questions.filter(q => {
      if (q.audience === 'exam') return false   // exam-only questions never appear in student practice
      const l = labelFor(q)
      if (!l?.subject || l.subject.id !== p.subjectId) return false
      if (p.topicIds?.length && !p.topicIds.includes(l.topic?.id)) return false
      if (bandArr && !bandArr.includes(q.difficulty)) return false
      if (p.qtype && q.qtype !== p.qtype) return false
      return true
    })
  }, [questions, maps, labelFor])

  const runGenerate = (p) => {
    const pool = poolFor(p)
    if (pool.length === 0) {
      setEmptyModal(true)
      return false
    }
    setWorksheet(pickBalanced(pool, p.count))
    setGenParams(p)
    return true
  }

  const generate = () => {
    const subjName = maps?.subject[selSubjectId]?.name || 'Practice'
    const topicNames = topicIds.map(id => maps?.topic[id]?.name).filter(Boolean)
    const topicLabel = topicNames.length === 1 ? topicNames[0] : topicNames.length > 1 ? `${topicNames.length} topics` : ''
    const p = { subjectId: selSubjectId, topicIds, band, qtype, count: Number(count) }
    if (!runGenerate(p)) return
    setTitle(`${subjName}${topicLabel ? ' · ' + topicLabel : ''} practice`)
    setCurrentSetId(null)
    setShowAnswers(false)
    setSaveState('idle')
    setMode('view')
  }

  const regenerate = () => { if (genParams) { runGenerate(genParams); setShowAnswers(false); setSaveState('idle'); setCurrentSetId(null) } }

  const openSet = (s) => {
    const byId = Object.fromEntries(questions.map(q => [q.id, q]))
    const ids = Array.isArray(s.question_ids) ? s.question_ids : []
    setWorksheet(ids.map(id => byId[id]).filter(Boolean))
    setTitle(s.title || 'Saved worksheet')
    setCurrentSetId(s.id)
    setGenParams(null)
    setShowAnswers(false)
    setSaveState('idle')
    setMode('view')
  }

  const saveSet = async () => {
    if (!student || worksheet.length === 0) return
    setSaveState('saving')
    const payload = {
      student_id: student.id,
      title: title.trim() || 'My worksheet',
      question_ids: worksheet.map(q => q.id),
      updated_at: new Date().toISOString(),
    }
    let err
    if (currentSetId) {
      ({ error: err } = await supabase.from(T_STUDENT_WORKSHEETS).update(payload).eq('id', currentSetId))
    } else {
      const { data, error } = await supabase.from(T_STUDENT_WORKSHEETS).insert(payload).select('id').single()
      err = error; if (data) setCurrentSetId(data.id)
    }
    if (err) { setSaveState('idle'); alert('Could not save: ' + err.message); return }
    setSaveState('saved')
    loadSets(student.id)
  }

  const deleteSet = async (s) => {
    if (!window.confirm(`Delete "${s.title}"?`)) return
    await supabase.from(T_STUDENT_WORKSHEETS).delete().eq('id', s.id)
    if (currentSetId === s.id) { setMode('request'); setCurrentSetId(null) }
    loadSets(student.id)
  }

  if (!ready) return (
    <div className="min-h-screen flex items-center justify-center bg-white text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>
  )

  const selCls = 'w-full border border-[#DEE7FF] rounded-xl px-3 py-2.5 text-sm text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <PortalNav studentName={student?.full_name} />

      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-5xl mx-auto px-6 md:px-10 py-8">
          <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold mb-1 font-display">Resources</p>
          <h1 className="text-2xl md:text-3xl font-bold text-[#2A2035] font-display">Practice worksheets</h1>
          <p className="text-sm text-[#2A2035]/70 mt-1 max-w-2xl">Pick a topic and we&rsquo;ll build you a fresh practice worksheet to study on your device.</p>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8">
        {mode === 'view' ? (
          <ViewSet
            worksheet={worksheet} title={title} setTitle={setTitle}
            showAnswers={showAnswers} setShowAnswers={setShowAnswers}
            canRegenerate={!!genParams} onRegenerate={regenerate}
            onSave={saveSet} saveState={saveState}
            onBack={() => setMode('request')} />
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Request form */}
            <div className="bg-white rounded-2xl border border-[#F0F4FF] p-5 space-y-4">
              <h2 className="text-sm font-bold text-[#062E63]">Create a worksheet</h2>

              <div>
                <label className="text-[11px] font-semibold text-[#2A2035]/50 block mb-1">Subject</label>
                <button
                  type="button"
                  onClick={e => setSubjPop(e.currentTarget.getBoundingClientRect())}
                  className={`${selCls} flex items-center justify-between gap-2 text-left`}
                >
                  <span className="truncate">
                    {(() => {
                      const s = mySubjects.find(x => String(x.id) === String(selSubjectId))
                      return s ? `Year ${s.year_level} · ${s.name}` : 'Choose a subject…'
                    })()}
                  </span>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[#2A2035]/40">
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {subjPop && (
                  <SearchSelectPopover
                    anchor={subjPop}
                    options={mySubjects.map(s => ({ value: s.id, label: `Year ${s.year_level} · ${s.name}` }))}
                    currentValue={selSubjectId}
                    placeholder="Search subjects…"
                    onSelect={v => { setSubjectId(v); setTopicIds([]); setSubjPop(null) }}
                    onClose={() => setSubjPop(null)}
                  />
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-semibold text-[#2A2035]/50">Topics</label>
                  <span className="text-[10px] text-[#2A2035]/40">{topicIds.length ? `${topicIds.length} selected` : 'all topics'}</span>
                </div>
                {topicsForSubject.length === 0 ? (
                  <p className="text-xs text-[#2A2035]/40">No topics for this subject yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {topicsForSubject.map(t => {
                      const on = topicIds.includes(t.id)
                      return (
                        <button key={t.id} type="button"
                          onClick={() => setTopicIds(ids => on ? ids.filter(x => x !== t.id) : [...ids, t.id])}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${on ? 'bg-[#325099] text-white border-[#325099]' : 'bg-white text-[#2A2035]/60 border-[#DEE7FF] hover:border-[#325099]'}`}>
                          {t.name}
                        </button>
                      )
                    })}
                  </div>
                )}
                <p className="text-[10px] text-[#2A2035]/40 mt-1.5">Pick one or more, or leave all unselected for the whole subject.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-[#2A2035]/50 block mb-1">Difficulty</label>
                  <select value={band} onChange={e => setBand(e.target.value)} className={selCls}>
                    <option value="">Mixed</option>
                    <option value="easy">Easier</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Harder</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#2A2035]/50 block mb-1">Question type</label>
                  <select value={qtype} onChange={e => setQtype(e.target.value)} className={selCls}>
                    <option value="">Mixed</option>
                    <option value="mcq">Multiple choice</option>
                    <option value="extended">Written</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#2A2035]/50 block mb-1">How many questions</label>
                <div className="flex gap-2">
                  {[10, 20, 30].map(n => (
                    <button key={n} onClick={() => setCount(n)}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${count === n ? 'bg-[#325099] text-white border-[#325099]' : 'bg-white text-[#2A2035]/60 border-[#DEE7FF] hover:border-[#325099]'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={generate} disabled={!selSubjectId}
                className="w-full mt-1 py-3 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-40">
                Generate worksheet →
              </button>
            </div>

            {/* Saved worksheets */}
            <div>
              <h2 className="text-sm font-bold text-[#062E63] mb-3">Your saved worksheets</h2>
              {savedSets.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-[#DEE7FF] p-8 text-center">
                  <p className="text-sm text-[#2A2035]/50">No saved worksheets yet. Generate one and tap Save to keep it.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {savedSets.map(s => (
                    <div key={s.id} className="bg-white rounded-xl border border-[#F0F4FF] p-3 flex items-center gap-3">
                      <button onClick={() => openSet(s)} className="flex-1 text-left min-w-0">
                        <p className="text-sm font-semibold text-[#062E63] truncate">{s.title}</p>
                        <p className="text-[11px] text-[#2A2035]/40">{(s.question_ids?.length || 0)} questions · {new Date(s.updated_at).toLocaleDateString()}</p>
                      </button>
                      <button onClick={() => openSet(s)} className="text-[11px] font-semibold text-[#325099] hover:underline shrink-0">Open →</button>
                      <button onClick={() => deleteSet(s)} className="text-[11px] text-[#DC2626]/60 hover:text-[#DC2626] shrink-0">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* No-questions-left modal */}
      {emptyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
          onClick={e => e.target === e.currentTarget && setEmptyModal(false)}
        >
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden text-center">
            <div className="bg-gradient-to-br from-[#EEF4FF] via-[#F8FAFF] to-[#BFD1FF]/40 pt-8 pb-6 px-6">
              <div className="text-5xl mb-3">🏆</div>
              <h3 className="text-lg font-bold text-[#062E63] font-display">You&rsquo;ve done them all!</h3>
            </div>
            <div className="px-7 py-6">
              <p className="text-sm text-[#2A2035]/70 leading-relaxed">
                You&rsquo;ve worked through every question in the bank for this selection.
                Patiently wait — more questions are on their way!
              </p>
              <p className="text-[11px] text-[#2A2035]/40 mt-3">
                In the meantime, try a different topic, difficulty or question type.
              </p>
              <button
                onClick={() => setEmptyModal(false)}
                className="mt-5 w-full py-2.5 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition"
              >
                Okay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── On-screen worksheet view (styled like a paper worksheet) ───────────────────
const questionMarks = (q) => {
  const parts = q.qbank_question_parts || []
  if (q.qtype === 'mcq') return q.marks ?? 1
  if (parts.length) return parts.reduce((s, p) => s + (Number(p.marks) || 0), 0)
  return q.marks || 0
}

function Solution({ children }) {
  return (
    <div className="mt-1.5 px-3 py-2 rounded-md bg-[#F0FDF4] border-l-[3px] border-[#16A34A] text-[13px] text-[#166534] leading-relaxed">
      {children}
    </div>
  )
}

function ViewSet({ worksheet, title, setTitle, showAnswers, setShowAnswers, canRegenerate, onRegenerate, onSave, saveState, onBack }) {
  const totalMarks = worksheet.reduce((s, q) => s + questionMarks(q), 0)
  // Multiple-choice questions are always grouped together at the start.
  const mcqs = worksheet.filter(q => q.qtype === 'mcq')
  const written = worksheet.filter(q => q.qtype !== 'mcq')
  const ordered = [...mcqs, ...written]
  const showSections = mcqs.length > 0 && written.length > 0

  return (
    <div className="max-w-3xl mx-auto">
      {/* Controls (not part of the sheet) */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={onBack} className="text-xs font-semibold text-[#325099] hover:text-[#062E63]">← New worksheet</button>
        <div className="flex-1" />
        {canRegenerate && (
          <button onClick={onRegenerate} className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] px-3 py-2 rounded-full hover:bg-[#F0F4FF] transition">↻ Regenerate</button>
        )}
        <button onClick={onSave} disabled={saveState === 'saving'}
          className="text-xs font-semibold text-[#325099] border border-[#325099] px-4 py-2 rounded-full hover:bg-[#F0F4FF] transition disabled:opacity-40">
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save'}
        </button>
        <button onClick={() => setShowAnswers(a => !a)}
          className={`text-xs font-semibold px-4 py-2 rounded-full transition ${showAnswers ? 'bg-[#16A34A] text-white hover:bg-[#15803D]' : 'bg-[#325099] text-white hover:bg-[#062E63]'}`}>
          {showAnswers ? 'Hide answers' : 'Show answers'}
        </button>
      </div>

      {/* The paper */}
      <div className="bg-white rounded-2xl border border-[#E5ECFF] shadow-sm px-7 md:px-12 py-9">
        {/* Worksheet header */}
        <div className="border-b-2 border-[#1f2a44] pb-4 mb-5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold font-display">CUBE Tuition · Practice worksheet</p>
            <p className="text-[11px] text-[#2A2035]/50">{worksheet.length} question{worksheet.length === 1 ? '' : 's'}{totalMarks > 0 ? ` · ${totalMarks} marks` : ''}</p>
          </div>
          <input value={title} onChange={e => setTitle(e.target.value)}
            className="w-full mt-1 text-2xl font-bold text-[#1f2a44] bg-transparent focus:outline-none font-display" />
          <div className="flex flex-wrap gap-x-10 gap-y-1 mt-3 text-[13px] text-[#2A2035]/70">
            <span className="flex items-baseline gap-2">Name:<span className="inline-block w-44 border-b border-[#94a3b8]" /></span>
            <span className="flex items-baseline gap-2">Date:<span className="inline-block w-28 border-b border-[#94a3b8]" /></span>
          </div>
        </div>

        <ol>
          {ordered.map((q, i) => (
            <Fragment key={q.id}>
              {showSections && i === 0 && <SectionLabel text="Section A · Multiple choice" />}
              {showSections && i === mcqs.length && <SectionLabel text="Section B · Written response" />}
              <QuestionView q={q} n={i + 1} showAnswers={showAnswers} last={i === ordered.length - 1} />
            </Fragment>
          ))}
        </ol>
      </div>
    </div>
  )
}

function SectionLabel({ text }) {
  return (
    <li className="list-none pt-4 pb-2 first:pt-0">
      <p className="text-[11px] tracking-[0.2em] uppercase text-[#325099] font-semibold font-display">{text}</p>
    </li>
  )
}

function QuestionView({ q, n, showAnswers, last }) {
  const parts = (q.qbank_question_parts || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const images = q.qbank_question_images || []
  const marks = questionMarks(q)
  const isMcq = q.qtype === 'mcq'

  return (
    <li className={`py-5 ${last ? '' : 'border-b border-dashed border-[#E2E8F0]'}`}>
      <div className="flex gap-3">
        <span className="text-[15px] font-bold text-[#1f2a44] shrink-0 leading-relaxed">{n}.</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-3">
            <div className="flex-1 text-[15px] text-[#1f2a44] leading-relaxed"><LatexContent text={q.stem_latex || ''} /></div>
            {marks > 0 && <span className="text-[12px] text-[#2A2035]/45 shrink-0 mt-0.5">[{marks}]</span>}
          </div>

          {images.length > 0 && (
            <div className="flex flex-wrap justify-center gap-3 my-3">
              {images.map(im => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={im.id} src={qbankImageUrl(im.storage_path)} alt={im.alt || ''} className="max-w-[320px] max-h-[230px] object-contain" />
              ))}
            </div>
          )}

          {/* MCQ */}
          {isMcq && Array.isArray(q.options) && q.options.length > 0 && (
            <div className="mt-2.5 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {q.options.map(opt => {
                const correct = showAnswers && opt.label === q.correct_option
                return (
                  <div key={opt.label} className={`flex items-start gap-2 text-[14px] ${correct ? 'text-[#166534] font-semibold' : 'text-[#1f2a44]'}`}>
                    <span className="font-bold">{opt.label}.</span>
                    <span><LatexContent text={opt.latex || ''} /></span>
                    {correct && <span className="ml-1">✓</span>}
                  </div>
                )
              })}
            </div>
          )}
          {isMcq && showAnswers && q.solution_latex?.trim() && (
            <Solution><span className="font-semibold">Why: </span><LatexContent text={q.solution_latex} /></Solution>
          )}

          {/* Multi-part written */}
          {parts.length > 0 && (
            <div className="mt-2.5 space-y-3">
              {parts.map((p, i) => {
                const lbl = p.part_label || 'abcdefgh'[i] || String(i + 1)
                return (
                  <div key={p.id || lbl}>
                    <div className="flex items-start gap-3 text-[14px] text-[#1f2a44]">
                      <div className="flex-1"><span className="font-semibold mr-1">{lbl})</span><LatexContent text={p.prompt_latex || ''} /></div>
                      {p.marks != null && <span className="text-[11px] text-[#2A2035]/40 shrink-0 mt-0.5">[{p.marks}]</span>}
                    </div>
                    {showAnswers && p.solution_latex?.trim() && <Solution><LatexContent text={p.solution_latex} /></Solution>}
                  </div>
                )
              })}
            </div>
          )}

          {/* Single written — solution only (students answer separately) */}
          {!isMcq && !parts.length && showAnswers && q.solution_latex?.trim() && (
            <Solution><span className="font-semibold">Solution. </span><LatexContent text={q.solution_latex} /></Solution>
          )}
        </div>
      </div>
    </li>
  )
}
