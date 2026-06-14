'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import LatexContent from '../../../../components/qbank/LatexContent'
import { T_QBANK_QUESTIONS } from '../../../../lib/tables'
import {
  fetchTaxonomy, yearsFromSubjects, qbankImageUrl,
  DIFFICULTY_LABELS, DIFFICULTY_COLORS, fetchQuestionUsage, logWorksheetUsage,
} from '../../../../lib/qbank'
import { exportWorksheet } from '../../../../lib/qbankWorksheet'
import UsageBadge from '../../../../components/qbank/UsageBadge'
import PdfPreviewModal from '../../../../components/qbank/PdfPreviewModal'

export default function GeneratePage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [tax, setTax] = useState(null)
  const [questions, setQuestions] = useState([])
  const [loadingQ, setLoadingQ] = useState(true)

  // filters
  const [year, setYear] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [skillId, setSkillId] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [search, setSearch] = useState('')

  // worksheet
  const [tray, setTray] = useState([])              // ordered question objects
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [includeMarks, setIncludeMarks] = useState(true)
  const [busy, setBusy] = useState('')
  const [mode, setMode] = useState(null)            // null | 'additional' | 'exam'
  const [usageMap, setUsageMap] = useState({})
  const [dragId, setDragId] = useState(null)        // tray question id being dragged
  const [preview, setPreview] = useState(null)      // { url, filename, title } PDF preview modal
  const closePreview = () => { if (preview?.url) URL.revokeObjectURL(preview.url); setPreview(null) }

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
      fetchTaxonomy().then(setTax)
      fetchQuestionUsage().then(setUsageMap)
      supabase.from(T_QBANK_QUESTIONS)
        .select('*, qbank_question_parts(*), qbank_question_images(id, storage_path, alt, sort_order)')
        .order('created_at', { ascending: false })
        .then(({ data }) => { setQuestions(data || []); setLoadingQ(false) })
    })
  }, [router])

  const maps = useMemo(() => {
    if (!tax) return null
    return {
      skill: Object.fromEntries(tax.skills.map((s) => [s.id, s])),
      topic: Object.fromEntries(tax.topics.map((t) => [t.id, t])),
      subject: Object.fromEntries(tax.subjects.map((s) => [s.id, s])),
    }
  }, [tax])

  const labelFor = useCallback((q) => {
    if (!maps) return null
    const sk = maps.skill[q.skill_id]
    const tp = sk && maps.topic[sk.topic_id]
    const su = tp && maps.subject[tp.subject_id]
    return { skill: sk, topic: tp, subject: su }
  }, [maps])

  const years = useMemo(() => (tax ? yearsFromSubjects(tax.subjects) : []), [tax])
  const subjectsForYear = useMemo(() => (tax && year ? tax.subjects.filter((s) => String(s.year_level) === String(year)) : []), [tax, year])
  const topicsForSubject = useMemo(() => (tax && subjectId ? (tax.topicsBySubject[subjectId] || []) : []), [tax, subjectId])
  const skillsForTopic = useMemo(() => (tax && topicId ? (tax.skillsByTopic[topicId] || []) : []), [tax, topicId])

  const trayIds = useMemo(() => new Set(tray.map((q) => q.id)), [tray])

  const filtered = useMemo(() => {
    if (!maps) return []
    return questions.filter((q) => {
      const l = labelFor(q)
      if (skillId && q.skill_id !== skillId) return false
      if (topicId && l?.topic?.id !== topicId) return false
      if (subjectId && l?.subject?.id !== subjectId) return false
      if (year && String(l?.subject?.year_level) !== String(year)) return false
      if (difficulty && String(q.difficulty) !== String(difficulty)) return false
      if (search.trim()) {
        const hay = `${q.stem_latex} ${q.solution_latex}`.toLowerCase()
        if (!hay.includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [questions, maps, labelFor, year, subjectId, topicId, skillId, difficulty, search])

  const add = (q) => setTray((t) => (t.find((x) => x.id === q.id) ? t : [...t, q]))
  const removeFromTray = (id) => setTray((t) => t.filter((x) => x.id !== id))
  const moveTray = (id, dir) => setTray((t) => {
    const i = t.findIndex((x) => x.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= t.length) return t
    const next = [...t]; [next[i], next[j]] = [next[j], next[i]]; return next
  })
  // Move dragged question `fromId` to the position of `toId` (drag-reorder).
  const reorderTray = (fromId, toId) => {
    if (fromId === toId) return
    setTray((t) => {
      const from = t.findIndex((x) => x.id === fromId)
      const to = t.findIndex((x) => x.id === toId)
      if (from < 0 || to < 0) return t
      const next = [...t]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }
  const addAllFiltered = () => setTray((t) => {
    const have = new Set(t.map((x) => x.id))
    return [...t, ...filtered.filter((q) => !have.has(q.id))]
  })

  const totalMarks = useMemo(
    () => tray.reduce((sum, q) => {
      const parts = q.qbank_question_parts || []
      if (parts.length) return sum + parts.reduce((s, p) => s + (Number(p.marks) || 0), 0)
      return sum + (Number(q.marks) || 0)
    }, 0),
    [tray],
  )

  const doExport = async (answers) => {
    if (!tray.length) return
    setBusy(answers ? 'answers' : 'worksheet')
    try {
      const res = await exportWorksheet({ title: title || 'Worksheet', subtitle, questions: tray, includeMarks, answers, preview: true })
      if (res?.url) setPreview({ url: res.url, filename: res.filename, title: answers ? 'Answer key — preview' : 'Worksheet — preview' })
      if (!answers) {
        await logWorksheetUsage(tray, title || 'Worksheet', profile?.full_name)
        fetchQuestionUsage().then(setUsageMap)
      }
    } catch (e) {
      alert('Could not generate the PDF: ' + (e.message || e))
    } finally {
      setBusy('')
    }
  }

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const selCls = 'border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-7xl mx-auto px-6 pt-8 pb-16">
        <Link href="/tutor/qbank" className="text-xs text-[#325099] hover:underline">← Question bank</Link>
        <div className="flex items-center gap-3 mt-1 mb-5">
          <h1 className="text-2xl font-bold text-[#062E63]">
            {mode === 'additional' ? 'Additional questions' : mode === 'exam' ? 'Exam' : 'Generate'}
          </h1>
          {mode && (
            <button onClick={() => setMode(null)}
              className="text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3 py-1 hover:bg-white transition">
              ← Change type
            </button>
          )}
        </div>

        {/* Step 1 — choose what you're making */}
        {!mode && (
          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
            <button onClick={() => setMode('additional')}
              className="text-left bg-white rounded-2xl border border-[#DEE7FF] p-5 hover:border-[#325099] hover:shadow-sm transition">
              <div className="text-2xl mb-2">📝</div>
              <div className="text-base font-bold text-[#062E63]">Additional questions</div>
              <p className="text-xs text-[#2A2035]/60 mt-1">Pick questions from the bank and export a practice worksheet with a matching answer key.</p>
              <span className="inline-block mt-3 text-[11px] font-semibold text-[#325099]">Start →</span>
            </button>
            <button onClick={() => router.push('/tutor/qbank/exams')}
              className="text-left bg-white rounded-2xl border border-[#DEE7FF] p-5 hover:border-[#325099] hover:shadow-sm transition">
              <div className="text-2xl mb-2">🧪</div>
              <div className="text-base font-bold text-[#062E63]">Exam</div>
              <p className="text-xs text-[#2A2035]/60 mt-1">Plan a formatted exam — topic scope, sections, marks — then fill each question slot from the bank and export the paper + solutions.</p>
              <span className="inline-block mt-3 text-[11px] font-semibold text-[#325099]">Go to exams →</span>
            </button>
          </div>
        )}

        {mode === 'additional' && (
        <div className="grid lg:grid-cols-2 gap-5">
          {/* ── Left: pick from bank ─────────────────────────────────────── */}
          <div>
            <div className="bg-white rounded-2xl border border-[#F0F4FF] p-3 flex flex-wrap items-center gap-2">
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
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
                className="flex-1 min-w-[100px] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
            </div>

            <div className="flex items-center justify-between mt-3 mb-2 px-1">
              <span className="text-xs text-[#2A2035]/50">{filtered.length} available</span>
              {filtered.length > 0 && <button onClick={addAllFiltered} className="text-[11px] font-semibold text-[#325099] hover:underline">Add all</button>}
            </div>

            <div className="space-y-2 max-h-[64vh] overflow-y-auto pr-1">
              {loadingQ ? <p className="text-center text-sm text-[#2A2035]/40 py-10 animate-pulse">Loading…</p>
                : filtered.length === 0 ? <p className="text-center text-sm text-[#2A2035]/40 py-10">No questions match.</p>
                : filtered.map((q) => {
                  const l = labelFor(q); const inTray = trayIds.has(q.id)
                  return (
                    <div key={q.id} className={`rounded-xl border p-3 transition ${inTray ? 'border-[#BACBFF] bg-[#F8FAFF]' : 'border-[#F0F4FF] bg-white'}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ background: DIFFICULTY_COLORS[q.difficulty] }}>{q.difficulty}</span>
                        {l?.subject && <span className="text-[10px] text-[#325099]">Yr {l.subject.year_level} · {l.subject.name}</span>}
                        {l?.topic && <span className="text-[10px] text-[#2A2035]/40">› {l.topic.name}</span>}
                        <div className="ml-auto flex items-center gap-2">
                          <UsageBadge usage={usageMap[q.id]} />
                          <button onClick={() => (inTray ? removeFromTray(q.id) : add(q))}
                            className={`text-[11px] font-semibold ${inTray ? 'text-[#2A2035]/40 hover:text-[#DC2626]' : 'text-[#325099] hover:text-[#062E63]'}`}>
                            {inTray ? 'Added ✓' : '+ Add'}
                          </button>
                        </div>
                      </div>
                      <div className="text-[13px] text-[#2A2035] line-clamp-2"><LatexContent text={q.stem_latex || '(no stem)'} /></div>
                    </div>
                  )
                })}
            </div>
          </div>

          {/* ── Right: worksheet tray ────────────────────────────────────── */}
          <div>
            <div className="bg-white rounded-2xl border border-[#F0F4FF] p-4 space-y-3">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Worksheet title (e.g. Year 9 Algebra — Week 3)"
                className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm font-semibold text-[#062E63] focus:outline-none focus:border-[#325099]" />
              <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Subtitle / instructions (optional)"
                className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099]" />
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-[#062E63] cursor-pointer">
                  <input type="checkbox" checked={includeMarks} onChange={(e) => setIncludeMarks(e.target.checked)} /> Show marks
                </label>
                <span className="text-xs text-[#2A2035]/50">{tray.length} question{tray.length === 1 ? '' : 's'}{includeMarks && totalMarks > 0 ? ` · ${totalMarks} marks` : ''}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => doExport(false)} disabled={!tray.length || busy}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-40">
                  {busy === 'worksheet' ? 'Building…' : 'Worksheet PDF'}
                </button>
                <button onClick={() => doExport(true)} disabled={!tray.length || busy}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[#325099] text-[#325099] text-sm font-semibold hover:bg-[#F0F4FF] transition disabled:opacity-40">
                  {busy === 'answers' ? 'Building…' : 'Answer key PDF'}
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-2 max-h-[58vh] overflow-y-auto pr-1">
              {tray.length === 0 ? (
                <div className="text-center py-14 bg-white rounded-2xl border border-dashed border-[#DEE7FF]">
                  <p className="text-sm text-[#2A2035]/50">Add questions from the left to build your worksheet.</p>
                </div>
              ) : tray.map((q, i) => {
                const l = labelFor(q); const imgs = q.qbank_question_images || []
                return (
                  <div key={q.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnter={() => { if (dragId) reorderTray(dragId, q.id) }}
                    className={`rounded-xl border bg-white p-3 transition ${dragId === q.id ? 'opacity-40 border-[#325099] border-dashed' : 'border-[#F0F4FF]'}`}>
                    <div className="flex items-start gap-2">
                      <span
                        draggable
                        onDragStart={() => setDragId(q.id)}
                        onDragEnd={() => setDragId(null)}
                        title="Drag to reorder"
                        className="cursor-grab active:cursor-grabbing text-[#2A2035]/30 hover:text-[#325099] select-none text-base leading-none mt-0.5">⠿</span>
                      <span className="text-sm font-bold text-[#062E63] mt-0.5">Q{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-[#2A2035] line-clamp-3"><LatexContent text={q.stem_latex || '(no stem)'} /></div>
                        {imgs.length > 0 && (
                          <div className="flex gap-1.5 mt-1.5">
                            {imgs.slice(0, 4).map((im) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={im.id} src={qbankImageUrl(im.storage_path)} alt="" className="h-10 w-10 object-contain rounded bg-[#F8FAFF] border border-[#F0F4FF]" />
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          {l?.skill && <span className="text-[10px] text-[#2A2035]/40">{l.skill.name}</span>}
                          {(q.qbank_question_parts?.length > 0) && <span className="text-[10px] text-[#2A2035]/40">· {q.qbank_question_parts.length} parts</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <button onClick={() => moveTray(q.id, -1)} disabled={i === 0} className="text-xs text-[#2A2035]/40 hover:text-[#325099] disabled:opacity-20">▲</button>
                        <button onClick={() => moveTray(q.id, 1)} disabled={i === tray.length - 1} className="text-xs text-[#2A2035]/40 hover:text-[#325099] disabled:opacity-20">▼</button>
                        <button onClick={() => removeFromTray(q.id)} className="text-[11px] text-[#DC2626] hover:underline mt-1">✕</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        )}
      </div>
      {preview && <PdfPreviewModal url={preview.url} filename={preview.filename} title={preview.title} onClose={closePreview} />}
    </div>
  )
}
