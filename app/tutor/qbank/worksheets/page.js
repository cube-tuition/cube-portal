'use client'
import { useEffect, useState, useMemo, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import SearchSelectPopover from '../../../../components/SearchSelectPopover'
import QuickEditModal from '../../../../components/qbank/QuickEditModal'
import TutorNav from '../../../../components/TutorNav'
import LatexContent from '../../../../components/qbank/LatexContent'
import { T_QBANK_QUESTIONS, T_QBANK_WORKSHEETS } from '../../../../lib/tables'
import { fetchTaxonomy, yearsFromSubjects, qbankImageUrl, DIFFICULTY_LABELS, DIFFICULTY_COLORS, fetchQuestionUsage, logWorksheetUsage, buildTaxonomyMaps, labelForQuestion, SUBJECT_FAMILIES, SCOPE_LABEL } from '../../../../lib/qbank'
import { exportWorksheet, renderWorksheetPreview } from '../../../../lib/qbankWorksheet'
import UsageBadge from '../../../../components/qbank/UsageBadge'
import PdfPreviewModal from '../../../../components/qbank/PdfPreviewModal'
import DocLivePreview from '../../../../components/qbank/DocLivePreview'

/*
 * Additional Questions — /tutor/qbank/worksheets
 * THE worksheet builder: persistent, autosaved worksheets in qbank_worksheets
 * (ordered ids in question_ids) that can be reopened, edited and re-exported
 * any time. The Generate page's ad-hoc builder was merged into this — arriving
 * with ?new=1 creates a worksheet and drops straight into the editor.
 *
 * Writing space belongs to the worksheet, not to the question: a question in
 * the bank carries none, and each placement here can set its own lines per part
 * (blank = derived from marks), the same contract exam slots use. question_ids
 * is jsonb, so an entry is either a bare id (no override) or
 * { id, lines: { partLabel | "_" : n } } — old worksheets keep loading as-is.
 */

// question_ids entries are bare ids until someone sets lines on one.
const entryId = (e) => (typeof e === 'string' ? e : e?.id)
const entryLines = (e) => (typeof e === 'string' ? null : (e?.lines || null))

// ── AQ master database tabs — same shape as the workbook master database ─────
const AQ_YEARS = [5, 6, 7, 8, 9, 10, 11, 12]
const AQ_SUBJECTS_BY_YEAR = {
  11: ['English', 'Standard Maths', 'Adv Maths', 'Ext 1 Maths', 'Chemistry'],
  12: ['English', 'Standard Maths', 'Adv Maths', 'Ext 1 Maths', 'Ext 2 Maths', 'Chemistry'],
}
const aqSubjects = (year) => AQ_SUBJECTS_BY_YEAR[year] || ['Maths', 'English']
const aqAccent = (s) => (s === 'Maths' || s?.includes('Maths')) ? '#325099' : s === 'Chemistry' ? '#0F766E' : '#7C3AED'
const aqAccentBg = (s) => (s === 'Maths' || s?.includes('Maths')) ? '#EEF4FF' : s === 'Chemistry' ? '#F0FDF4' : '#F5F3FF'

export default function AdditionalQuestionsPage() {
  return <Suspense><AdditionalQuestionsInner /></Suspense>
}

function AdditionalQuestionsInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Subject-hub scope (?subject=Maths|English|Chemistry): limits the year/subject
  // filters and the bank list to that family. Absent → unchanged behaviour.
  const scopeParam = searchParams.get('subject')
  const scope = SUBJECT_FAMILIES[scopeParam] ? scopeParam : null
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)

  // worksheet list
  const [worksheets, setWorksheets] = useState([])
  const [loadingWs, setLoadingWs] = useState(true)
  const [selectedId, setSelectedId] = useState(null)

  // bank + taxonomy
  const [tax, setTax] = useState(null)
  const [questions, setQuestions] = useState([])
  const [loadingQ, setLoadingQ] = useState(true)
  const [usageMap, setUsageMap] = useState({})

  // editor state
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  // Curriculum topic this worksheet belongs to. Tagging one makes it appear
  // under that topic in Materials; null leaves it untagged.
  const [wsTopicId, setWsTopicId] = useState('')
  const [wsTopicPop, setWsTopicPop] = useState(null)   // anchor rect while the topic picker is open
  // Master-database tabs for the saved-worksheet list (year × subject, seeded
  // from the Materials links' ?year=&subj= scoping).
  const [listYear, setListYear] = useState(() => Number(searchParams.get('year')) || 5)
  const [listSub, setListSub] = useState(() => searchParams.get('subj') || 'Maths')
  const [editQ, setEditQ] = useState(null)             // bank question being quick-edited
  const [allTopics, setAllTopics] = useState([])
  const [tray, setTray] = useState([])
  const [dirty, setDirty] = useState(false)
  const [includeMarks, setIncludeMarks] = useState(true)
  const [busy, setBusy] = useState('')
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(null)      // { url, filename, title } PDF preview modal
  const closePreview = () => { if (preview?.url) URL.revokeObjectURL(preview.url); setPreview(null) }
  const [dragId, setDragId] = useState(null)        // tray question id being dragged

  // Autosave plumbing — refs hold the latest editable snapshot + in-flight state
  // so debounced saves never race or persist stale data.
  const dataRef = useRef({ selectedId: null, title: '', subtitle: '', tray: [], includeMarks: true, wsTopicId: '' })
  const savingRef = useRef(false)
  const pendingRef = useRef(false)
  const dirtyRef = useRef(false)

  // filters
  // A Materials tab can open this page already scoped (?year=11&subj=Ext+1+Maths).
  // The subject arrives as a NAME; it is resolved to an id once the taxonomy
  // has loaded, in the effect below.
  const [year, setYear] = useState(searchParams.get('year') || '')
  const [subjectId, setSubjectId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [subtopicId, setSubtopicId] = useState('')
  const [skillId, setSkillId] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [qtype, setQtype] = useState('')   // '' | 'mcq' | 'extended'
  const [search, setSearch] = useState('')

  const loadWorksheets = useCallback(async () => {
    const { data } = await supabase.from(T_QBANK_WORKSHEETS)
      .select('*').order('updated_at', { ascending: false })
    setWorksheets(data || []); setLoadingWs(false)
  }, [])

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
      fetchTaxonomy().then(setTax)
      fetchQuestionUsage().then(setUsageMap)
      loadWorksheets()
      supabase.from(T_QBANK_QUESTIONS)
        .select('*, qbank_question_parts(*), qbank_question_images(id, storage_path, alt, sort_order, role)')
        .order('created_at', { ascending: false })
        .then(({ data }) => { setQuestions(data || []); setLoadingQ(false) })
      // Arriving from Generate (?new=1): create a worksheet and open it straight away.
      if (searchParams.get('new') === '1') {
        supabase.from(T_QBANK_WORKSHEETS)
          .insert({ title: 'Untitled worksheet', question_ids: [], created_by: profile?.full_name || null })
          .select('*').single()
          .then(({ data, error }) => {
            if (error || !data) return
            setSelectedId(data.id); setTitle(data.title || ''); setSubtitle(''); setWsTopicId(''); setTray([]); setIncludeMarks(data.include_marks ?? true); setDirty(false)
            loadWorksheets()
            router.replace('/tutor/qbank/worksheets')   // drop ?new=1 so refresh doesn't create another
          })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, loadWorksheets])

  const qById = useMemo(() => Object.fromEntries(questions.map((q) => [q.id, q])), [questions])
  // A ?ws=<id> deep link (from a Materials topic page). Held in a ref and
  // acted on only once the questions have loaded: openWorksheet resolves the
  // tray through qById, so opening early would build an empty tray and let
  // autosave write that emptiness back over the worksheet.
  const wantWsRef = useRef(searchParams.get('ws') || null)
  const topicById = useMemo(() => Object.fromEntries(allTopics.map((t) => [t.id, t])), [allTopics])

  // Keep refs in sync so the autosave loop always reads the latest values.
  useEffect(() => { dataRef.current = { selectedId, title, subtitle, tray, includeMarks, wsTopicId } }, [selectedId, title, subtitle, tray, includeMarks, wsTopicId])
  useEffect(() => { dirtyRef.current = dirty }, [dirty])

  // Low-level write for a given snapshot.
  const persist = useCallback(async (snap) => {
    if (!snap?.selectedId) return
    const { error } = await supabase.from(T_QBANK_WORKSHEETS).update({
      title: (snap.title || '').trim() || 'Untitled worksheet',
      subtitle: (snap.subtitle || '').trim() || null,
      question_ids: (snap.tray || []).map((q) => (
        q._workingLines && Object.keys(q._workingLines).length
          ? { id: q.id, lines: q._workingLines }
          : q.id)),
      include_marks: snap.includeMarks ?? true,
      topic_id: snap.wsTopicId ? Number(snap.wsTopicId) : null,
      updated_at: new Date().toISOString(),
    }).eq('id', snap.selectedId)
    if (error) throw error
  }, [])

  // Force-write any unsaved edits immediately (used before switching/closing).
  const flushNow = useCallback(async () => {
    if (!dirtyRef.current) return
    try { await persist(dataRef.current); setDirty(false) }
    catch (e) { console.error('Worksheet flush failed:', e) }
  }, [persist])

  useEffect(() => {
    const id = wantWsRef.current
    if (!id || loadingQ || !worksheets.length) return
    wantWsRef.current = null
    const ws = worksheets.find((w) => String(w.id) === String(id))
    if (ws) openWorksheet(ws)
    router.replace('/tutor/qbank/worksheets')   // drop ?ws so a refresh doesn't re-open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingQ, worksheets])

  // open a worksheet into the editor (saving any pending edits first)
  const openWorksheet = async (ws) => {
    await flushNow()
    setSelectedId(ws.id)
    setTitle(ws.title || '')
    setSubtitle(ws.subtitle || '')
    setWsTopicId(ws.topic_id ?? '')
    const entries = Array.isArray(ws.question_ids) ? ws.question_ids : []
    const ids = entries.map(entryId).filter(Boolean)
    const linesById = Object.fromEntries(entries.map((e) => [entryId(e), entryLines(e)]).filter(([k, v]) => k && v))
    setTray(ids.map((id) => qById[id]).filter(Boolean)
      .map((q) => (linesById[q.id] ? { ...q, _workingLines: linesById[q.id] } : q)))
    setIncludeMarks(ws.include_marks ?? true)
    setDirty(false)
  }

  const closeEditor = async () => { await flushNow(); setSelectedId(null); loadWorksheets() }

  const createWorksheet = async () => {
    const { data, error } = await supabase.from(T_QBANK_WORKSHEETS)
      .insert({ title: 'Untitled worksheet', question_ids: [], created_by: profile?.full_name || null })
      .select('*').single()
    if (error) { alert('Could not create worksheet: ' + error.message); return }
    await loadWorksheets()
    openWorksheet(data)
  }

  // Re-entrant-safe autosave: if a save is already running, flag a follow-up
  // rather than starting an overlapping write.
  const saveWorksheet = useCallback(async () => {
    if (savingRef.current) { pendingRef.current = true; return }
    if (!dataRef.current.selectedId) return
    savingRef.current = true; setSaving(true)
    try {
      // Loop so edits made mid-save get persisted without overlapping writes.
      do {
        pendingRef.current = false
        await persist(dataRef.current)
      } while (pendingRef.current)
      setDirty(false)
    } catch (e) {
      console.error('Worksheet autosave failed:', e)
    } finally {
      savingRef.current = false; setSaving(false)
      loadWorksheets()
    }
  }, [persist, loadWorksheets])

  // Debounced autosave — fires ~1s after the last edit.
  useEffect(() => {
    if (!selectedId || !dirty) return
    const t = setTimeout(() => { saveWorksheet() }, 1000)
    return () => clearTimeout(t)
  }, [dirty, title, subtitle, tray, includeMarks, wsTopicId, selectedId, saveWorksheet])

  // Best-effort flush when the page unmounts with unsaved edits.
  useEffect(() => () => { if (dirtyRef.current) saveWorksheet() }, [saveWorksheet])

  const deleteWorksheet = async (ws) => {
    if (!window.confirm(`Delete worksheet "${ws.title}"? The questions stay in the bank — only this saved list is removed.`)) return
    const { error } = await supabase.from(T_QBANK_WORKSHEETS).delete().eq('id', ws.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    if (selectedId === ws.id) setSelectedId(null)
    loadWorksheets()
  }

  // taxonomy helpers (shared with the list page and exam builder)
  const maps = useMemo(() => buildTaxonomyMaps(tax), [tax])
  const labelFor = useCallback((q) => labelForQuestion(q, maps), [maps])

  // Subjects narrowed to the hub scope's family when one is active.
  const scopedSubjects = useMemo(() => {
    if (!tax) return []
    return scope ? tax.subjects.filter((s) => SUBJECT_FAMILIES[scope].includes(s.name)) : tax.subjects
  }, [tax, scope])
  const years = useMemo(() => yearsFromSubjects(scopedSubjects), [scopedSubjects])
  const subjectsForYear = useMemo(() => (year ? scopedSubjects.filter((s) => String(s.year_level) === String(year)) : []), [scopedSubjects, year])
  // Curriculum topics a worksheet can be filed under, limited to the hub's
  // subject family. These come from `topics` (year, subject, name) — the same
  // list the Materials pages read — not from the question bank's own tree.
  useEffect(() => {
    let dead = false
    const fams = scope ? SUBJECT_FAMILIES[scope] : null
    let q = supabase.from('topics').select('id, year, subject, name')
    if (fams) q = q.in('subject', fams)
    q.order('year').order('name').then(({ data }) => { if (!dead) setAllTopics(data || []) })
    return () => { dead = true }
  }, [scope])

  // Seed the subject filter from ?subj=<name>, once for the initial load.
  const subjSeeded = useRef(false)
  useEffect(() => {
    if (subjSeeded.current) return
    const name = searchParams.get('subj')
    if (!name || !scopedSubjects.length) return
    const hit = scopedSubjects.find(
      (s) => s.name === name && (!year || String(s.year_level) === String(year)))
    if (hit) { setSubjectId(hit.id); subjSeeded.current = true }
  }, [scopedSubjects, searchParams, year])

  const topicsForSubject = useMemo(() => (tax && subjectId ? (tax.topicsBySubject[subjectId] || []) : []), [tax, subjectId])
  const subtopicsForTopic = useMemo(() => (tax && topicId ? (tax.subtopicsByTopic[topicId] || []) : []), [tax, topicId])
  // Skills are a subject-level dimension — available as soon as a subject is picked.
  const skillsForFilter = useMemo(() => (tax && subjectId ? (tax.skillsBySubject[subjectId] || []) : []), [tax, subjectId])
  const onQuestionSaved = async () => {
    const { data } = await supabase.from(T_QBANK_QUESTIONS)
      .select('*, qbank_question_parts(*), qbank_question_images(id, storage_path, alt, sort_order, role)')
      .eq('id', editQ.id).single()
    if (data) {
      setQuestions((qs) => qs.map((q) => (q.id === data.id ? data : q)))
      setTray((ts) => ts.map((q) => (q.id === data.id ? { ...data, _workingLines: q._workingLines } : q)))
    }
    setEditQ(null)
  }

  // Years/subjects narrowed to the hub scope, tab kept valid — as the
  // workbook master database does.
  const aqSubjectsFor = useCallback((y) => {
    const all = aqSubjects(y)
    return scope ? all.filter((su) => SUBJECT_FAMILIES[scope].includes(su)) : all
  }, [scope])
  const aqVisibleYears = useMemo(() => AQ_YEARS.filter((y) => aqSubjectsFor(y).length > 0), [aqSubjectsFor])
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (!aqVisibleYears.includes(listYear)) { setListYear(aqVisibleYears[0]); return }
      const subs = aqSubjectsFor(listYear)
      if (!subs.includes(listSub)) setListSub(subs[0])
    })
    return () => cancelAnimationFrame(raf)
  }, [listYear, listSub, aqVisibleYears, aqSubjectsFor])

  // Saved worksheets under the active tab, grouped by their filing topic.
  // A worksheet with no topic has no year/subject to live under — those sit in
  // a strip above the groups so they stay findable from every tab.
  const wsGroups = useMemo(() => {
    const groups = new Map()
    for (const ws of worksheets) {
      const t = topicById[ws.topic_id]
      if (!t || Number(t.year) !== Number(listYear) || t.subject !== listSub) continue
      if (!groups.has(t.name)) groups.set(t.name, [])
      groups.get(t.name).push(ws)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [worksheets, topicById, listYear, listSub])
  const wsUnfiled = useMemo(() => worksheets.filter((ws) => !topicById[ws.topic_id]), [worksheets, topicById])

  const trayIds = useMemo(() => new Set(tray.map((q) => q.id)), [tray])

  const filtered = useMemo(() => {
    if (!maps) return []
    return questions.filter((q) => {
      const l = labelFor(q)
      if (scope && !SUBJECT_FAMILIES[scope].includes(l?.subject?.name)) return false
      if (skillId && q.skill_id !== skillId) return false
      if (subtopicId && l?.subtopic?.id !== subtopicId) return false
      if (topicId && l?.topic?.id !== topicId) return false
      if (subjectId && l?.subject?.id !== subjectId) return false
      if (year && String(l?.subject?.year_level) !== String(year)) return false
      if (difficulty && String(q.difficulty) !== String(difficulty)) return false
      if (qtype && q.qtype !== qtype) return false
      if (search.trim()) {
        const hay = `${q.stem_latex} ${q.solution_latex}`.toLowerCase()
        if (!hay.includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [questions, maps, labelFor, scope, year, subjectId, topicId, subtopicId, skillId, difficulty, qtype, search])

  const add = (q) => { setTray((t) => (t.find((x) => x.id === q.id) ? t : [...t, q])); setDirty(true) }
  // Blank clears the override, so the question falls back to marks-derived space.
  const setLines = (qid, key, raw) => {
    setTray((t) => t.map((q) => {
      if (q.id !== qid) return q
      const next = { ...(q._workingLines || {}) }
      if (raw === '' || raw == null) delete next[key]
      else next[key] = Math.max(0, Number(String(raw).replace(/\D/g, '')) || 0)
      return { ...q, _workingLines: Object.keys(next).length ? next : undefined }
    }))
    setDirty(true)
  }
  const removeFromTray = (id) => { setTray((t) => t.filter((x) => x.id !== id)); setDirty(true) }
  const moveTray = (id, dir) => {
    setTray((t) => {
      const i = t.findIndex((x) => x.id === id); const j = i + dir
      if (i < 0 || j < 0 || j >= t.length) return t
      const next = [...t]; [next[i], next[j]] = [next[j], next[i]]; return next
    })
    setDirty(true)
  }
  // Drag-to-reorder the worksheet questions (same as the Generate page).
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
    setDirty(true)
  }

  const totalMarks = useMemo(
    () => tray.reduce((sum, q) => {
      const parts = q.qbank_question_parts || []
      if (parts.length) return sum + parts.reduce((s, p) => s + (Number(p.marks) || 0), 0)
      return sum + (Number(q.marks) || 0)
    }, 0),
    [tray],
  )

  // Live preview (shares the worksheet exporter; toggle worksheet vs answer key).
  const [previewAnswers, setPreviewAnswers] = useState(false)
  const renderPreview = useCallback((c) => renderWorksheetPreview(c, { title: title || 'Worksheet', subtitle, questions: tray, includeMarks, answers: previewAnswers }), [title, subtitle, tray, includeMarks, previewAnswers])
  const previewSig = useMemo(() => JSON.stringify({ t: title, s: subtitle, m: includeMarks, a: previewAnswers, q: tray.map((q) => [q.id, q._workingLines, q.updated_at]) }), [title, subtitle, includeMarks, previewAnswers, tray])

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
    } finally { setBusy('') }
  }

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const selCls = 'border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white'

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-7xl mx-auto px-6 pt-8 pb-16">
        <Link href={`/tutor/qbank${scope ? `?subject=${scope}` : ''}`} className="text-xs text-[#325099] hover:underline">← Question bank</Link>
        <div className="flex items-center gap-3 mt-1 mb-5">
          <h1 className="text-2xl font-bold text-[#062E63]">Additional Questions{scope ? ` — ${SCOPE_LABEL[scope]}` : ''}</h1>
          {selectedId && (
            <button onClick={closeEditor}
              className="text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] rounded-full px-3 py-1 hover:bg-white transition">
              ← All worksheets
            </button>
          )}
          {selectedId && (
            <span className={`text-[11px] font-semibold ${saving ? 'text-[#2A2035]/40' : dirty ? 'text-[#325099]' : 'text-[#16A34A]'}`}>
              {saving ? 'Saving…' : dirty ? 'Autosaving…' : 'Saved ✓'}
            </span>
          )}
        </div>

        {/* ── Worksheet list ───────────────────────────────────────────────── */}
        {!selectedId && (
          <div>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <p className="text-xs text-[#2A2035]/50">Saved worksheets keep their question list so you can edit and re-export them any time. File one under a topic (inside the worksheet) and it sorts itself here.</p>
              <button onClick={createWorksheet} className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition shrink-0">+ New worksheet</button>
            </div>

            {/* Year tabs */}
            <div className="flex overflow-x-auto border-b border-[#E4EAF6] mb-5">
              {aqVisibleYears.map((y) => (
                <button key={y} onClick={() => setListYear(y)}
                  className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                    listYear === y ? 'border-[#325099] text-[#325099]' : 'border-transparent text-[#2A2035]/50 hover:text-[#325099]'
                  }`}>
                  Year {y}
                </button>
              ))}
            </div>

            {/* Subject tabs */}
            <div className="flex gap-2 mb-6 flex-wrap">
              {aqSubjectsFor(listYear).map((su) => (
                <button key={su} onClick={() => setListSub(su)}
                  className={`px-5 py-2 rounded-xl text-sm font-semibold border transition ${
                    listSub === su ? 'text-white border-transparent' : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'
                  }`}
                  style={listSub === su ? { background: aqAccent(su) } : {}}>
                  {su}
                </button>
              ))}
            </div>

            {/* Worksheets with no filing topic — visible from every tab */}
            {wsUnfiled.length > 0 && (
              <div className="mb-7 bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden shadow-sm">
                <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-5 py-2.5 flex items-center justify-between gap-3">
                  <span className="text-xs font-bold text-[#325099]">📝 Unfiled worksheets · {wsUnfiled.length}</span>
                  <span className="text-[11px] text-[#2A2035]/40">Open one and pick its topic to file it under a year below</span>
                </div>
                <div className="divide-y divide-[#F0F4FF]">
                  {wsUnfiled.map((ws) => (
                    <div key={ws.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                      <button onClick={() => openWorksheet(ws)} className="text-left min-w-0 truncate">
                        <span className="font-semibold text-sm text-[#062E63]">{ws.title}</span>
                        <span className="text-xs text-[#2A2035]/50 ml-2">{(Array.isArray(ws.question_ids) ? ws.question_ids.length : 0)} questions · updated {new Date(ws.updated_at).toLocaleDateString()}</span>
                      </button>
                      <div className="flex items-center gap-3 shrink-0 text-[11px]">
                        <button onClick={() => openWorksheet(ws)} className="font-semibold text-[#325099] hover:underline">Open →</button>
                        <button onClick={() => deleteWorksheet(ws)} className="text-[#2A2035]/40 hover:text-rose-500">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {loadingWs ? (
              <p className="text-center text-sm text-[#2A2035]/40 py-10 animate-pulse">Loading…</p>
            ) : wsGroups.length === 0 ? (
              <div className="text-center py-14 bg-white rounded-2xl border border-dashed border-[#DEE7FF]">
                <p className="text-sm text-[#2A2035]/50">No worksheets filed under Year {listYear} {listSub} yet.</p>
                <p className="text-xs text-[#2A2035]/40 mt-1">Create one and pick a Year {listYear} {listSub} topic inside it.</p>
              </div>
            ) : (
              <div className="space-y-8 pb-12">
                {wsGroups.map(([topicName, list]) => (
                  <div key={topicName}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-xs font-bold px-3 py-1 rounded-full"
                        style={{ background: aqAccentBg(listSub), color: aqAccent(listSub) }}>
                        {topicName}
                      </span>
                      <span className="text-[10px] text-[#2A2035]/30 font-medium">{list.length} worksheet{list.length !== 1 ? 's' : ''}</span>
                      <div className="flex-1 h-px bg-[#E8EDF8]" />
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
                      {list.map((ws) => (
                        <div key={ws.id} className="bg-white rounded-xl border border-[#E8EDF8] shadow-sm px-4 py-3 flex items-center gap-3 hover:border-[#C7D7FF] hover:shadow-md transition">
                          <button onClick={() => openWorksheet(ws)} className="flex-1 text-left min-w-0">
                            <p className="text-xs font-semibold text-[#2A2035] truncate">{ws.title}</p>
                            <p className="text-[10px] text-[#2A2035]/45 mt-0.5">
                              {(Array.isArray(ws.question_ids) ? ws.question_ids.length : 0)} question{(Array.isArray(ws.question_ids) ? ws.question_ids.length : 0) === 1 ? '' : 's'}
                              {ws.subtitle ? ` · ${ws.subtitle}` : ''} · updated {new Date(ws.updated_at).toLocaleDateString()}
                            </p>
                          </button>
                          <button onClick={() => openWorksheet(ws)}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg transition hover:opacity-80 whitespace-nowrap shrink-0"
                            style={{ background: aqAccentBg(listSub), color: aqAccent(listSub) }}>
                            Open →
                          </button>
                          <button onClick={() => deleteWorksheet(ws)} className="text-[11px] text-[#2A2035]/30 hover:text-rose-500 shrink-0" title="Delete worksheet">✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Editor ───────────────────────────────────────────────────────── */}
        {selectedId && (
        <>
        {/* Top bar — worksheet name (left) + downloads, like the workbook builder */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-xl border border-[#DEE7FF] px-4 py-2.5 mb-4">
          <div className="min-w-0">
            <p className="text-[9px] tracking-[0.25em] uppercase text-[#325099] font-bold">Worksheet</p>
            <p className="text-base font-bold text-[#062E63] truncate">
              {title || 'Untitled worksheet'}
              <span className="text-[#2A2035]/40 font-medium">{tray.length ? ` · ${tray.length} question${tray.length === 1 ? '' : 's'}` : ''}{includeMarks && totalMarks > 0 ? ` · ${totalMarks} marks` : ''}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => doExport(false)} disabled={!tray.length || busy}
              className="px-4 py-2 rounded-lg bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-40">
              {busy === 'worksheet' ? 'Building…' : '↓ Worksheet PDF'}
            </button>
            <button onClick={() => doExport(true)} disabled={!tray.length || busy}
              className="px-4 py-2 rounded-lg border border-[#325099] text-[#325099] text-sm font-semibold hover:bg-[#F0F4FF] transition disabled:opacity-40">
              {busy === 'answers' ? 'Building…' : '↓ Solutions PDF'}
            </button>
          </div>
        </div>
        <div className="grid lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-5 items-start">
          {/* Left: pick from bank */}
          <div>
            <div className="bg-white rounded-2xl border border-[#F0F4FF] p-3 flex flex-wrap items-center gap-2">
              <select value={year} onChange={(e) => { setYear(e.target.value); setSubjectId(''); setTopicId(''); setSubtopicId(''); setSkillId('') }} className={selCls}>
                <option value="">All years</option>
                {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
              <select value={subjectId} disabled={!year} onChange={(e) => { setSubjectId(e.target.value); setTopicId(''); setSubtopicId(''); setSkillId('') }} className={selCls}>
                <option value="">All subjects</option>
                {subjectsForYear.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={topicId} disabled={!subjectId} onChange={(e) => { setTopicId(e.target.value); setSubtopicId(''); setSkillId('') }} className={selCls}>
                <option value="">All topics</option>
                {topicsForSubject.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={subtopicId} disabled={!topicId} onChange={(e) => { setSubtopicId(e.target.value); setSkillId('') }} className={selCls}>
                <option value="">All subtopics</option>
                {subtopicsForTopic.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
              </select>
              <select value={skillId} disabled={!subjectId} onChange={(e) => setSkillId(e.target.value)} className={selCls}>
                <option value="">All skills</option>
                {skillsForFilter.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className={selCls}>
                <option value="">Any difficulty</option>
                {[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d} · {DIFFICULTY_LABELS[d]}</option>)}
              </select>
              <select value={qtype} onChange={(e) => setQtype(e.target.value)} className={selCls}>
                <option value="">All types</option>
                <option value="mcq">Multiple choice</option>
                <option value="extended">Non-MCQ (written)</option>
              </select>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
                className="flex-1 min-w-[100px] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#325099]" />
            </div>

            <div className="flex items-center justify-between mt-3 mb-2 px-1">
              <span className="text-xs text-[#2A2035]/50">{filtered.length} available</span>
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
                          <button onClick={() => setEditQ(q)}
                            className="text-[11px] font-semibold text-[#2A2035]/40 hover:text-[#325099]">✎ Edit</button>
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

          {/* Right: saved worksheet */}
          <div>
            <div className="bg-white rounded-2xl border border-[#F0F4FF] p-4 space-y-3">
              <input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true) }} placeholder="Worksheet title"
                className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm font-semibold text-[#062E63] focus:outline-none focus:border-[#325099]" />
              <input value={subtitle} onChange={(e) => { setSubtitle(e.target.value); setDirty(true) }} placeholder="Subtitle / instructions (optional)"
                className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-xs text-[#2A2035] focus:outline-none focus:border-[#325099]" />
              {/* Filing this under a topic makes it appear on that topic's page
                  in Materials, beside the workbooks for the same topic. */}
              <button type="button"
                onClick={(e) => setWsTopicPop(e.currentTarget.getBoundingClientRect())}
                className={`w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:border-[#325099] flex items-center justify-between gap-2 text-left hover:border-[#325099] transition ${topicById[wsTopicId] ? 'text-[#2A2035]' : 'text-[#2A2035]/45'}`}>
                <span className="truncate">
                  {topicById[wsTopicId]
                    ? `Year ${topicById[wsTopicId].year} ${topicById[wsTopicId].subject} · ${topicById[wsTopicId].name}`
                    : 'No topic — won\u2019t show under Materials'}
                </span>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0 opacity-50">
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {wsTopicPop && (
                <SearchSelectPopover
                  anchor={wsTopicPop}
                  options={allTopics.map((t) => ({ value: String(t.id), label: t.name, sub: `Year ${t.year} · ${t.subject}` }))}
                  currentValue={String(wsTopicId || '')}
                  clearLabel="No topic — won’t show under Materials"
                  placeholder="Search topics…"
                  onSelect={(v) => { setWsTopicId(v); setDirty(true); setWsTopicPop(null) }}
                  onClose={() => setWsTopicPop(null)}
                />
              )}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-[#062E63] cursor-pointer">
                  <input type="checkbox" checked={includeMarks} onChange={(e) => { setIncludeMarks(e.target.checked); setDirty(true) }} /> Show marks
                </label>
                <span className="text-xs text-[#2A2035]/50">{tray.length} question{tray.length === 1 ? '' : 's'}{includeMarks && totalMarks > 0 ? ` · ${totalMarks} marks` : ''}</span>
              </div>
              <p className="text-[10px] text-[#2A2035]/40">Changes save automatically · download from the bar above.</p>
            </div>

            <div className="mt-3 space-y-2 max-h-[58vh] overflow-y-auto pr-1">
              {tray.length === 0 ? (
                <div className="text-center py-14 bg-white rounded-2xl border border-dashed border-[#DEE7FF]">
                  <p className="text-sm text-[#2A2035]/50">Add questions from the left.</p>
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
                          <span className="text-[10px] text-[#2A2035]/40">· difficulty {q.difficulty}</span>
                          {q.marks != null && <span className="text-[10px] text-[#2A2035]/40">· {q.marks} mark{q.marks === 1 ? '' : 's'}</span>}
                        </div>
                        {/* Writing space for THIS placement. Blank = derived from
                            marks; MCQs never get lines, so they get no control. */}
                        {q.qtype !== 'mcq' && (() => {
                          const parts = (q.qbank_question_parts || []).slice()
                            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                          const cls = 'w-11 border border-[#DEE7FF] rounded px-1 py-0.5 text-[11px] text-center text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]'
                          return (
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <span className="text-[10px] font-semibold text-[#2A2035]/45">Writing lines:</span>
                              {parts.length ? parts.map((p, pi) => {
                                const lbl = p.part_label || 'abcdefgh'[pi] || String(pi + 1)
                                return (
                                  <label key={p.id || lbl} className="flex items-center gap-1 text-[10px] text-[#2A2035]/50">
                                    <span className="font-semibold">{lbl})</span>
                                    <input type="text" inputMode="numeric" placeholder="auto" className={cls}
                                      value={q._workingLines?.[lbl] ?? ''}
                                      onChange={(e) => setLines(q.id, lbl, e.target.value)} />
                                  </label>
                                )
                              }) : (
                                <input type="text" inputMode="numeric" placeholder="auto" className={cls}
                                  value={q._workingLines?.['_'] ?? ''}
                                  onChange={(e) => setLines(q.id, '_', e.target.value)} />
                              )}
                              <span className="text-[10px] text-[#2A2035]/30">blank = auto from marks</span>
                            </div>
                          )
                        })()}
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <button onClick={() => moveTray(q.id, -1)} disabled={i === 0} className="text-xs text-[#2A2035]/40 hover:text-[#325099] disabled:opacity-20">▲</button>
                        <button onClick={() => moveTray(q.id, 1)} disabled={i === tray.length - 1} className="text-xs text-[#2A2035]/40 hover:text-[#325099] disabled:opacity-20">▼</button>
                        <button onClick={() => setEditQ(q)} title="Edit this question — stem, solution, marks, MCQ options"
                          className="text-[11px] text-[#325099]/70 hover:text-[#325099] mt-1">✎</button>
                        <button onClick={() => removeFromTray(q.id)} className="text-[11px] text-[#DC2626] hover:underline mt-1">✕</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Live preview column */}
          <div className="hidden xl:block sticky top-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold">Live preview</p>
              <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden text-xs">
                <button onClick={() => setPreviewAnswers(false)} className={`px-2.5 py-1 font-semibold ${!previewAnswers ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>Worksheet</button>
                <button onClick={() => setPreviewAnswers(true)} className={`px-2.5 py-1 font-semibold border-l border-[#DEE7FF] ${previewAnswers ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>Answers</button>
              </div>
            </div>
            {tray.length === 0
              ? <div className="bg-[#E9EDF6] rounded-xl p-6 text-center text-xs text-[#2A2035]/40">Add questions to see a preview.</div>
              : <DocLivePreview render={renderPreview} signature={previewSig} scale={0.62} />}
          </div>
        </div>
        </>
        )}
      </div>
      {preview && <PdfPreviewModal url={preview.url} filename={preview.filename} title={preview.title} onClose={closePreview} />}
      {editQ && (
        <QuickEditModal question={editQ} onClose={() => setEditQ(null)} onSaved={onQuestionSaved} />
      )}

    </div>
  )
}
