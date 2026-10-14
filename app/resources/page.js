'use client'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { requireStudent } from '../../lib/requireStudent'
import PortalNav from '../../components/PortalNav'
import SearchSelectPopover from '../../components/SearchSelectPopover'
import LatexContent from '../../components/qbank/LatexContent'
import { qbankSubjectKeys } from '../../lib/courses'
import { fetchAllTerms, getEnrolmentTerm } from '../../lib/terms'
import { fetchTaxonomy, qbankImageUrl, partLabel, questionTotalMarks as questionMarks, fetchAllRows, splitStemSource } from '../../lib/qbank'
import { T_STUDENTS, T_STUDENT_WORKSHEETS, T_QBANK_QUESTIONS, T_PRACTICE_RATINGS } from '../../lib/tables'
import { enrolledClassesForTerm } from '../../lib/classes'
import { RATINGS, RATING_LABEL, latestRatings, streamOf, shuffleOrder, tabOf, tabCounts } from '../../lib/practice'

/*
 * Resources — the practice stream.
 *
 * A student picks a subject and (optionally) topics, question level and type;
 * matching practice questions stream in at random. After doing one they rate
 * how hard it felt — Easy · Medium · Hard · Very hard — and it leaves the
 * stream for that tab, to revisit later (rating it again moves it). Ratings are
 * kept in practice_ratings, private to the student (lib/practice has the
 * rules). Which questions a student may see — practice, not exam, in the
 * subjects they're enrolled in — is decided by the database.
 *
 * Worksheets saved with the old generator stay readable under "Saved".
 */

const LEVEL_BANDS = { easy: [1, 2], medium: [3], hard: [4, 5] }   // the question's own level (qbank difficulty)
const PAGE = 10
// A small seeded random generator (Park–Miller), so the stream's shuffle is
// fixed for a choice of filters: rating one question never reshuffles the rest.
const seeded = (seed) => {
  let x = (seed % 2147483646) + 1
  return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646 }
}
const newSeed = () => Math.floor(Math.random() * 2147483646)

const RATING_STYLE = {
  easy:      { on: 'bg-[#16A34A] text-white border-[#16A34A]', off: 'text-[#166534] border-[#BBF7D0] hover:bg-[#F0FDF4]', dot: 'bg-[#16A34A]' },
  medium:    { on: 'bg-[#2563EB] text-white border-[#2563EB]', off: 'text-[#1E40AF] border-[#BFDBFE] hover:bg-[#EFF6FF]', dot: 'bg-[#2563EB]' },
  hard:      { on: 'bg-[#D97706] text-white border-[#D97706]', off: 'text-[#92400E] border-[#FDE68A] hover:bg-[#FFFBEB]', dot: 'bg-[#D97706]' },
  very_hard: { on: 'bg-[#DC2626] text-white border-[#DC2626]', off: 'text-[#991B1B] border-[#FECACA] hover:bg-[#FEF2F2]', dot: 'bg-[#DC2626]' },
}
const nowIso = () => new Date().toISOString()
const ago = (iso) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

export default function Resources() {
  const router = useRouter()
  const [student, setStudent] = useState(null)
  const [ready, setReady] = useState(false)
  const [tax, setTax] = useState(null)
  const [questions, setQuestions] = useState(null)
  const [enrolledPairs, setEnrolledPairs] = useState([])   // [{ year, subject }] from enrolled classes
  const [savedSets, setSavedSets] = useState([])
  const [ratingRows, setRatingRows] = useState([])

  // Choices
  const [subjectId, setSubjectId] = useState('')
  const [subjPop, setSubjPop] = useState(null)   // anchor rect for the subject popover
  const [topicIds, setTopicIds] = useState([])   // [] = all topics in the subject
  const [level, setLevel] = useState('')         // '' | 'easy' | 'medium' | 'hard' — the question's own level
  const [qtype, setQtype] = useState('')         // '' | 'mcq' | 'extended'
  const [seed, setSeed] = useState(newSeed)      // the stream's shuffle; new when the filters change
  const [shown, setShown] = useState(PAGE)
  const [tab, setTab] = useState('practice')     // 'practice' | a rating id | 'saved'
  const [openSetId, setOpenSetId] = useState(null)
  const [toast, setToast] = useState(null)       // { questionId, rating, rowId } — the Undo bar

  // Any change to what's being practised restarts the stream with a new shuffle.
  const restart = () => { setSeed(newSeed()); setShown(PAGE) }

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user ?? null
      if (!requireStudent(user, router)) return
      const { data: profile } = await supabase.from(T_STUDENTS).select('*').eq('id', user.id).single()
      setStudent(profile); setReady(true)

      // Classes are per-term rows, so scope to the current term. (year, subject)
      // of each enrolled class, by the same rule the database uses to decide
      // which practice questions the student may read (qbank_subject_key).
      const term = getEnrolmentTerm(await fetchAllTerms())
      const { data: links } = await enrolledClassesForTerm(user.id, term?.id, 'class_name, courses(course_code)')
      setEnrolledPairs((links || []).flatMap(l => l.classes ? qbankSubjectKeys(l.classes.courses?.course_code, l.classes.class_name) : []))

      fetchTaxonomy().then(setTax)
      supabase.from(T_STUDENT_WORKSHEETS).select('*').eq('student_id', user.id).order('updated_at', { ascending: false })
        .then(({ data }) => setSavedSets(data || []))
      fetchAllRows(() => supabase.from(T_PRACTICE_RATINGS).select('id, question_id, rating, rated_at').eq('student_id', user.id).order('id'))
        .then(setRatingRows, () => setRatingRows([]))
      fetchAllRows(() => supabase.from(T_QBANK_QUESTIONS)
        .select('*, qbank_question_parts(*), qbank_question_images(id, storage_path, alt, sort_order, role)')
        .order('id'))
        .then(setQuestions, () => setQuestions([]))
    }
    load()
  }, [router])

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

  // Subjects this student can practise: those of the classes they're enrolled
  // in (English has no practice questions, so it's left out).
  const mySubjects = useMemo(() => {
    if (!tax) return []
    const subjects = tax.subjects.filter(s => !/english/i.test(s.name))
    if (enrolledPairs.length) {
      return subjects.filter(s => enrolledPairs.some(p =>
        String(s.year_level) === String(p.year) && s.name.trim().toLowerCase() === p.subject.toLowerCase()))
    }
    if (student?.year) {
      const byYear = subjects.filter(s => String(s.year_level) === String(student.year))
      if (byYear.length) return byYear
    }
    return subjects
  }, [tax, student, enrolledPairs])

  const selSubjectId = subjectId || mySubjects[0]?.id || ''
  const topicsForSubject = useMemo(() => (tax && selSubjectId ? (tax.topicsBySubject[selSubjectId] || []) : []), [tax, selSubjectId])

  const latest = useMemo(() => latestRatings(ratingRows), [ratingRows])
  // Everything in the chosen subject (the tabs), and what matches the filters (the stream).
  const subjectQuestions = useMemo(() => (questions || []).filter(q =>
    q.audience !== 'exam' && labelFor(q)?.subject?.id === selSubjectId), [questions, labelFor, selSubjectId])
  const pool = useMemo(() => subjectQuestions.filter(q => {
    if (topicIds.length && !topicIds.includes(labelFor(q)?.topic?.id)) return false
    if (level && !LEVEL_BANDS[level].includes(q.difficulty)) return false
    if (qtype && q.qtype !== qtype) return false
    return true
  }), [subjectQuestions, topicIds, level, qtype, labelFor])
  const order = useMemo(() => shuffleOrder(pool.map(q => q.id), seeded(seed)), [pool, seed])
  const stream = useMemo(() => streamOf(pool, order, latest), [pool, order, latest])
  const counts = useMemo(() => tabCounts(subjectQuestions, latest), [subjectQuestions, latest])

  // Load more as the student scrolls to the end of the stream.
  const sentinel = useRef(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setShown(s => s + PAGE)
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [tab, stream.length])

  const tempIds = useRef(0)
  const rate = async (q, rating) => {
    if (!student) return
    tempIds.current += 1
    const temp = { id: `tmp-${tempIds.current}`, question_id: q.id, rating, rated_at: nowIso() }
    setRatingRows(rows => [...rows, temp])
    const { data, error } = await supabase.from(T_PRACTICE_RATINGS)
      .insert({ student_id: student.id, question_id: q.id, rating }).select('id, question_id, rating, rated_at').single()
    if (error) {
      setRatingRows(rows => rows.filter(r => r.id !== temp.id))
      alert('Could not save that — check your connection and try again.')
      return
    }
    setRatingRows(rows => rows.map(r => (r.id === temp.id ? data : r)))
    setToast({ questionId: q.id, rating, rowId: data.id })
  }
  const undo = async () => {
    const t = toast
    if (!t) return
    setToast(null)
    const { error } = await supabase.from(T_PRACTICE_RATINGS).delete().eq('id', t.rowId)
    if (!error) setRatingRows(rows => rows.filter(r => r.id !== t.rowId))
  }
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  if (!ready) return (
    <div className="min-h-screen flex items-center justify-center bg-white text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>
  )

  const selCls = 'w-full border border-[#DEE7FF] rounded-xl px-3 py-2.5 text-sm text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'
  const loading = !questions || !tax
  const tabs = [
    { id: 'practice', label: 'Practice', count: null },
    ...RATINGS.map(r => ({ id: r.id, label: r.label, count: counts[r.id] })),
    ...(savedSets.length ? [{ id: 'saved', label: 'Saved', count: savedSets.length }] : []),
  ]
  const tabQuestions = RATING_LABEL[tab] ? tabOf(subjectQuestions, latest, tab) : []
  const openSet = savedSets.find(s => s.id === openSetId)
  const setQuestionsList = openSet && questions
    ? (openSet.question_ids || []).map(id => questions.find(q => q.id === id)).filter(Boolean) : []

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <PortalNav studentName={student?.full_name} />

      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-8">
          <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold mb-1 font-display">Resources</p>
          <h1 className="text-2xl md:text-3xl font-bold text-[#2A2035] font-display">Practice</h1>
          <p className="text-sm text-[#2A2035]/70 mt-1 max-w-2xl">
            Questions stream in from the topics you choose. Do each one, then tap how hard it felt —
            it moves into that tab so you can come back to it.
          </p>

          {/* Subject */}
          <div className="mt-5 max-w-sm">
            <button type="button" onClick={e => setSubjPop(e.currentTarget.getBoundingClientRect())}
              className={`${selCls} flex items-center justify-between gap-2 text-left`}>
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
              <SearchSelectPopover anchor={subjPop}
                options={mySubjects.map(s => ({ value: s.id, label: `Year ${s.year_level} · ${s.name}` }))}
                currentValue={selSubjectId} placeholder="Search subjects…"
                onSelect={v => { setSubjectId(v); setTopicIds([]); restart(); setSubjPop(null) }}
                onClose={() => setSubjPop(null)} />
            )}
            {tax && mySubjects.length === 0 && (
              <p className="text-[11px] text-[#2A2035]/50 mt-1.5 leading-relaxed">
                Practice questions aren&rsquo;t available for your classes yet. Ask your CUBE tutor if you&rsquo;d like extra practice.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-[#DEE7FF]">
        <div className="max-w-3xl mx-auto px-4 md:px-6 flex gap-1 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setOpenSetId(null) }}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-3 text-sm font-semibold border-b-2 transition ${tab === t.id ? 'border-[#325099] text-[#062E63]' : 'border-transparent text-[#2A2035]/50 hover:text-[#2A2035]'}`}>
              {RATING_STYLE[t.id] && <span className={`w-2 h-2 rounded-full ${RATING_STYLE[t.id].dot}`} />}
              {t.label}
              {t.count != null && <span className="text-[11px] font-semibold text-[#2A2035]/40">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
        {loading && <p className="text-sm text-[#2A2035]/40 animate-pulse">Loading questions…</p>}

        {/* ── Practice: filters + the stream ── */}
        {!loading && tab === 'practice' && selSubjectId && (
          <>
            <div className="bg-white rounded-2xl border border-[#E5ECFF] p-4 space-y-3 mb-5">
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
                          onClick={() => { setTopicIds(ids => on ? ids.filter(x => x !== t.id) : [...ids, t.id]); restart() }}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${on ? 'bg-[#325099] text-white border-[#325099]' : 'bg-white text-[#2A2035]/60 border-[#DEE7FF] hover:border-[#325099]'}`}>
                          {t.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-[#2A2035]/50 block mb-1">Question level</label>
                  <select value={level} onChange={e => { setLevel(e.target.value); restart() }} className={selCls}>
                    <option value="">Mixed</option>
                    <option value="easy">Easier</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Harder</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#2A2035]/50 block mb-1">Question type</label>
                  <select value={qtype} onChange={e => { setQtype(e.target.value); restart() }} className={selCls}>
                    <option value="">Mixed</option>
                    <option value="mcq">Multiple choice</option>
                    <option value="extended">Written</option>
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-[#2A2035]/45">
                {stream.length} question{stream.length === 1 ? '' : 's'} to go
                {pool.length > stream.length ? ` · ${pool.length - stream.length} done` : ''}
              </p>
            </div>

            {stream.length === 0 ? (
              <EmptyCard
                icon={pool.length ? '🏆' : '🔍'}
                title={pool.length ? 'You’ve done every question here!' : 'No questions match'}
                text={pool.length
                  ? 'Revisit the ones you found hard in the Hard and Very hard tabs, or choose other topics.'
                  : 'Try other topics, or set the level and type back to Mixed.'} />
            ) : (
              <ol className="space-y-4">
                {stream.slice(0, shown).map((q, i) => (
                  <QuestionCard key={q.id} q={q} n={i + 1} topic={labelFor(q)?.topic?.name} onRate={r => rate(q, r)} />
                ))}
              </ol>
            )}
            {stream.length > shown && <div ref={sentinel} className="h-10" />}
          </>
        )}

        {/* ── A difficulty tab ── */}
        {!loading && RATING_LABEL[tab] && (
          tabQuestions.length === 0 ? (
            <EmptyCard icon="🗂️" title={`Nothing in ${RATING_LABEL[tab]} yet`}
              text={`Questions you rate “${RATING_LABEL[tab]}” in Practice land here, so you can try them again.`} />
          ) : (
            <ol className="space-y-4">
              {tabQuestions.map((q, i) => (
                <QuestionCard key={q.id} q={q} n={i + 1} topic={labelFor(q)?.topic?.name}
                  current={latest[q.id]} onRate={r => rate(q, r)} />
              ))}
            </ol>
          )
        )}

        {/* ── Worksheets saved with the old generator ── */}
        {!loading && tab === 'saved' && (
          openSet ? (
            <>
              <button onClick={() => setOpenSetId(null)} className="text-xs font-semibold text-[#325099] mb-3">← Saved worksheets</button>
              <h2 className="text-lg font-bold text-[#062E63] mb-3">{openSet.title}</h2>
              <ol className="space-y-4">
                {setQuestionsList.map((q, i) => (
                  <QuestionCard key={q.id} q={q} n={i + 1} topic={labelFor(q)?.topic?.name}
                    current={latest[q.id]} onRate={r => rate(q, r)} />
                ))}
              </ol>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-[#2A2035]/50 mb-2">Worksheets you saved before Practice replaced worksheets. You can still open and rate their questions.</p>
              {savedSets.map(s => (
                <button key={s.id} onClick={() => setOpenSetId(s.id)}
                  className="w-full text-left bg-white rounded-xl border border-[#E5ECFF] p-3 hover:border-[#325099] transition">
                  <p className="text-sm font-semibold text-[#062E63] truncate">{s.title}</p>
                  <p className="text-[11px] text-[#2A2035]/40">{(s.question_ids?.length || 0)} questions · saved {new Date(s.updated_at).toLocaleDateString('en-AU')}</p>
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {/* Rated — with a moment to undo */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#062E63] text-white text-sm rounded-full pl-4 pr-2 py-2 shadow-lg">
          <span>Moved to <strong>{RATING_LABEL[toast.rating]}</strong></span>
          <button onClick={undo} className="text-xs font-semibold bg-white/15 hover:bg-white/25 rounded-full px-3 py-1">Undo</button>
        </div>
      )}
    </div>
  )
}

function EmptyCard({ icon, title, text }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-[#DEE7FF] px-6 py-10 text-center">
      <div className="text-4xl mb-2">{icon}</div>
      <p className="text-sm font-bold text-[#062E63]">{title}</p>
      <p className="text-xs text-[#2A2035]/55 mt-1.5 max-w-sm mx-auto leading-relaxed">{text}</p>
    </div>
  )
}

function Solution({ children }) {
  return (
    <div className="mt-1.5 px-3 py-2 rounded-md bg-[#F0FDF4] border-l-[3px] border-[#16A34A] text-[13px] text-[#166534] leading-relaxed">
      {children}
    </div>
  )
}

// One question: attempt it, check the solution if you like, then rate it.
function QuestionCard({ q, n, topic, current = null, onRate }) {
  const [showSolution, setShowSolution] = useState(false)
  const parts = (q.qbank_question_parts || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const images = q.qbank_question_images || []
  const marks = questionMarks(q)
  const isMcq = q.qtype === 'mcq'
  const hasSolution = !!(q.solution_latex?.trim() || parts.some(p => p.solution_latex?.trim()) || (isMcq && q.correct_option))

  return (
    <li className="bg-white rounded-2xl border border-[#E5ECFF] shadow-sm overflow-hidden">
      <div className="px-5 md:px-6 pt-5 pb-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-[11px] font-semibold text-[#325099]/70 truncate">{n}.{topic ? ` ${topic}` : ''}</span>
          {current && (
            <span className="text-[10px] text-[#2A2035]/45 shrink-0">
              Done {current.times}× · last {ago(current.ratedAt)}
            </span>
          )}
        </div>
        <div className="flex items-start gap-3">
          <div className="flex-1 text-[15px] text-[#1f2a44] leading-relaxed"><LatexContent text={splitStemSource(q.stem_latex).stem} /></div>
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

        {isMcq && Array.isArray(q.options) && q.options.length > 0 && (
          <div className="mt-2.5 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {q.options.map(opt => {
              const correct = showSolution && opt.label === q.correct_option
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
        {isMcq && showSolution && q.solution_latex?.trim() && (
          <Solution><span className="font-semibold">Why: </span><LatexContent text={q.solution_latex} /></Solution>
        )}

        {parts.length > 0 && (
          <div className="mt-2.5 space-y-3">
            {parts.map((p, i) => {
              const lbl = partLabel(i)
              return (
                <div key={p.id || lbl}>
                  <div className="flex items-start gap-3 text-[14px] text-[#1f2a44]">
                    <div className="flex-1"><span className="font-semibold mr-1">{lbl})</span><LatexContent text={p.prompt_latex || ''} /></div>
                    {p.marks != null && <span className="text-[11px] text-[#2A2035]/40 shrink-0 mt-0.5">[{p.marks}]</span>}
                  </div>
                  {showSolution && p.solution_latex?.trim() && <Solution><LatexContent text={p.solution_latex} /></Solution>}
                </div>
              )
            })}
          </div>
        )}
        {!isMcq && !parts.length && showSolution && q.solution_latex?.trim() && (
          <Solution><span className="font-semibold">Solution. </span><LatexContent text={q.solution_latex} /></Solution>
        )}

        {splitStemSource(q.stem_latex).source && (
          <p className="mt-3 text-[11px] text-[#2A2035]/45">Source: {splitStemSource(q.stem_latex).source}</p>
        )}

        {hasSolution && (
          <button onClick={() => setShowSolution(s => !s)}
            className="mt-3 text-xs font-semibold text-[#325099] hover:text-[#062E63]">
            {showSolution ? 'Hide solution' : 'Show solution'}
          </button>
        )}
      </div>

      {/* How hard was it? */}
      <div className="px-5 md:px-6 py-3 bg-[#F8FAFF] border-t border-[#EEF2FF]">
        <p className="text-[11px] font-semibold text-[#2A2035]/50 mb-2">{current ? 'How hard was it this time?' : 'How hard was it?'}</p>
        <div className="grid grid-cols-4 gap-2">
          {RATINGS.map(r => {
            const on = current?.rating === r.id
            return (
              <button key={r.id} onClick={() => onRate(r.id)}
                className={`text-xs font-semibold px-2 py-2 rounded-xl border transition ${on ? RATING_STYLE[r.id].on : `bg-white ${RATING_STYLE[r.id].off}`}`}>
                {r.label}
              </button>
            )
          })}
        </div>
      </div>
    </li>
  )
}
