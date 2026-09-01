'use client'
import Link from 'next/link'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '../../../../../lib/supabase'
import { buildLabel } from '../../../../../lib/format'
import { getAuthProfile } from '../../../../../lib/getProfile'
import TutorNav from '../../../../../components/TutorNav'
import { T_BOOKLET_BUILDS, T_BOOKLETS, T_QBANK_QUESTIONS, T_TERMS } from '../../../../../lib/tables'

// A booklet stops being "Not Started" once it has this many blocks in it; the
// builder promotes the linked curriculum row to "In Progress" on the next save.
const AUTO_IN_PROGRESS_BLOCKS = 5
import { BLOCK_TYPES, BLOCK_GROUPS, HW_BLOCK_TYPES, HW_GROUPS, newBlock, blockHtml, questionChunksHtml, BOOKLET_CSS, DEFAULT_LT_INSTRUCTIONS, DEFAULT_LT_TOTALS } from '../../../../../lib/bookletRender'
import { exportBookletPdf } from '../../../../../lib/bookletExport'
import { bookletPdfName } from '../../../../../lib/bookletNaming'
import BlockEditor from '../../../../../components/booklet/BlockEditor'
import BookletPreview from '../../../../../components/booklet/BookletPreview'
import PdfPreviewModal from '../../../../../components/qbank/PdfPreviewModal'
import QuestionEditor from '../../../../../components/qbank/QuestionEditor'
import { fetchTaxonomy, SUBJECT_FAMILIES } from '../../../../../lib/qbank'
import { fetchSyllabus, filterModulesToPool, removeDotpointsFromSections, dotpointAllocation, countSelected } from '../../../../../lib/syllabus'
import { buildSyllabusContent } from '../../../../../lib/bookletContent'
import LatexContent from '../../../../../components/qbank/LatexContent'
import { setUndoHandler, announceUndo } from '../../../../../lib/undo'

// Standard year/subject options so metadata is consistent across booklets.
// Topics are loaded per year+subject from the shared `topics` table. The stored
// value stays canonical ('Maths') to match the topics table / master database,
// while the dropdown shows the friendlier "Mathematics" label.
const YEARS = [5, 6, 7, 8, 9, 10, 11, 12]
// How many steps back Ctrl/Cmd+Z can walk in one builder session, and how many
// consecutive keystrokes in one field fold into a single step.
const UNDO_DEPTH = 60
const MERGE_RUN = 40

const SUBJECTS = [
  { value: 'Maths', label: 'Mathematics' },
  { value: 'English', label: 'English' },
  { value: 'Chemistry', label: 'Chemistry' },
]
// Standardised display name: "X.Y. Name" (year . subject-code . name). Shared
// with the Master Database so the header and the workbook lists always agree.
const formatBookletName = (year, subject, name) =>
  buildLabel({ year, subject, title: name }, 'Untitled booklet')

export default function BookletBuilderEditor() {
  const router = useRouter()
  const { id } = useParams()
  const [staff, setStaff] = useState(null)
  const [bk, setBk] = useState(null)          // { id, title, year, subject, topic, blocks, status, booklet_id }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [solnView, setSolnView] = useState(false)
  const [preview, setPreview] = useState(null)
  const [bankOpen, setBankOpen] = useState(false)
  const [newQOpen, setNewQOpen] = useState(false)   // create a new bank question, then drop it in as a block
  const [exporting, setExporting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [pubProgress, setPubProgress] = useState(null)   // { pct, label } while saving to curriculum
  const [chemSyllabus, setChemSyllabus] = useState([])   // master syllabus for this booklet's year (Chemistry)
  const [tax, setTax] = useState(null)                   // qbank taxonomy (for the test topic scope)
  useEffect(() => { fetchTaxonomy().then(setTax) }, [])

  const bkRef = useRef(null)
  useEffect(() => { bkRef.current = bk })
  const savingRef = useRef(false), pendingRef = useRef(false)
  // The updated_at we last read or wrote. Every save is conditional on it, so a
  // page holding a stale copy of `blocks` can never overwrite a newer version —
  // the whole array is written wholesale, so without this one tab silently
  // discards another's work (or a change made outside the builder).
  const versionRef = useRef(null)
  const [conflict, setConflict] = useState(false)
  // Set once the "In Progress" promotion has been attempted, so the extra write
  // doesn't ride along with every autosave.
  const promotedRef = useRef(false)

  // Which page is being edited, and (for homework) which subsection new blocks
  // land in. The cover is automatic (page 1) and has no editable section.
  const [activeSection, setActiveSection] = useState('content') // 'content' | 'homework'
  const [activeHwGroup, setActiveHwGroup] = useState('foundational') // 'foundational' | 'developmental'

  // Auto-scroll a newly added block into view so adding from the pinned palette
  // doesn't require hunting for the new block at the bottom of the list.
  const lastBlockRef = useRef(null)
  const [lastAddedId, setLastAddedId] = useState(null)
  // Clicking a block selects it as the insertion anchor — new blocks go after it.
  const [selectedBlockId, setSelectedBlockId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)   // block awaiting delete confirmation
  // "Don't ask for 5 minutes" — a ref, so it survives re-renders but not a
  // reload: the quiet window should not outlive the tidy-up it was for.
  const deleteAskAgainAt = useRef(0)
  // Real page grouping for the content cards — measured the same way the preview
  // paginates, so headers mirror the printed pages (manual breaks + overflow).
  const [physicalPages, setPhysicalPages] = useState(null)
  useEffect(() => {
    if (lastAddedId) lastBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [lastAddedId])

  useEffect(() => {
    (async () => {
      const { profile } = await getAuthProfile()
      if (!profile || (profile.role !== 'admin' && profile.role !== 'tutor')) { router.push('/tutor'); return }
      setStaff(profile)
      const { data } = await supabase.from(T_BOOKLET_BUILDS).select('*').eq('id', id).single()
      if (data) {
        // Pre-test names are always auto-generated from their term ("{YY}T{term}
        // Pre-test") — regenerate on load so the name is never blank/stale.
        // Level-test names are always just "Level Test" (the subject + year are
        // prepended by formatBookletName) — there's no manual name input.
        let title = data.title
        if (data.doc_type === 'pre_test' && data.term_id) {
          const { data: term } = await supabase.from(T_TERMS).select('year, term_number').eq('id', data.term_id).maybeSingle()
          if (term?.year != null && term?.term_number != null) {
            title = `${String(term.year).slice(-2)}T${term.term_number} Pre-test`
          }
        } else if (data.doc_type === 'level_test') {
          title = 'Level Test'
        }
        const blocks = Array.isArray(data.blocks) ? data.blocks : []
        // Chemistry pool: seed an empty checklist from the dotpoints already
        // drawn into sections, so builds made before the pool existed open
        // fully ticked and allocated instead of empty.
        let syllabusPoints = Array.isArray(data.syllabus_points) ? data.syllabus_points : []
        if (data.subject === 'Chemistry' && !syllabusPoints.length) {
          syllabusPoints = [...new Set(blocks.flatMap(bl => (bl.type === 'section' && Array.isArray(bl.syllabus_points)) ? bl.syllabus_points : []))]
        }
        setBk({
          ...data,
          title,
          blocks,
          syllabus_points: syllabusPoints,
        })
        versionRef.current = data.updated_at
        if (title !== data.title) setDirty(true)  // persist the corrected name
      }
      setLoading(false)
    })()
  }, [id, router])

  // Load the master syllabus for this booklet's year (Chemistry only) so the
  // Content tab can draw individual dotpoints from it.
  useEffect(() => {
    let active = true
    if (bk?.subject === 'Chemistry' && bk?.year) {
      fetchSyllabus('Chemistry', Number(bk.year)).then((m) => { if (active) setChemSyllabus(m) })
    } else {
      Promise.resolve().then(() => { if (active) setChemSyllabus([]) })
    }
    return () => { active = false }
  }, [bk?.subject, bk?.year])

  // Debounced autosave (mirrors the exam builder).
  const save = useCallback(async () => {
    if (savingRef.current) { pendingRef.current = true; return }
    savingRef.current = true; setSaving(true)
    try {
      do {
        pendingRef.current = false
        const b = bkRef.current
        // Booklet-level syllabus_points (drives the Syllabus page's auto
        // coverage). Chemistry: the POOL — the checklist of dotpoints this
        // booklet covers, chosen on the Content tab (sections then allocate
        // from it). Other subjects: derived union of section dotpoints, as
        // before. An empty chem pool falls back to the union so a build from
        // before the pool existed seeds itself on first save.
        const sectionUnion = [...new Set((b.blocks || []).flatMap(bl => (bl.type === 'section' && Array.isArray(bl.syllabus_points)) ? bl.syllabus_points : []))]
        const poolIds = Array.isArray(b.syllabus_points) ? b.syllabus_points : []
        const allPoints = b.subject === 'Chemistry' && poolIds.length ? poolIds : sectionUnion
        // Chemistry: the content summary is generated from the sections' drawn
        // dotpoints (section header + its points). Other subjects keep free text.
        const contentVal = b.subject === 'Chemistry' ? buildSyllabusContent(b.blocks) : (b.content ?? null)
        const stamp = new Date().toISOString()
        let q = supabase.from(T_BOOKLET_BUILDS).update({
          title: b.title, year: b.year ? Number(b.year) : null, subject: b.subject, topic: b.topic,
          content: contentVal, blocks: b.blocks,
          cover: b.cover ?? null,
          delivery: b.delivery === 'online' ? 'online' : 'physical',
          syllabus_points: allPoints,
          qbank_topic_ids: Array.isArray(b.qbank_topic_ids) ? b.qbank_topic_ids : null,
          updated_at: stamp,
        }).eq('id', b.id)
        // Only write if the row is still the version we loaded.
        q = versionRef.current == null ? q.is('updated_at', null) : q.eq('updated_at', versionRef.current)
        const { data: hit, error } = await q.select('id')
        if (error) throw error
        if (!hit || !hit.length) {
          // Somebody else has saved since we loaded. Stop rather than clobber
          // them, and let the user decide what to keep.
          setConflict(true)
          return
        }
        versionRef.current = stamp
      } while (pendingRef.current)

      // Once a booklet has real content in it, it is no longer "Not Started".
      // Promote the linked curriculum row on the way past — guarded in the query
      // so a booklet already In Progress / Needs Improvement / Complete is never
      // knocked backwards, and only attempted once per session.
      const b = bkRef.current
      if (!promotedRef.current && b?.booklet_id && (b.blocks?.length || 0) >= AUTO_IN_PROGRESS_BLOCKS) {
        promotedRef.current = true
        await supabase.from(T_BOOKLETS)
          .update({ status: 'In Progress' })
          .eq('id', b.booklet_id)
          .or('status.is.null,status.eq.Not Started')
      }
      setDirty(false)
    } finally { savingRef.current = false; setSaving(false) }
  }, [])

  useEffect(() => {
    if (loading || !dirty || conflict) return
    const t = setTimeout(() => save(), 900)
    return () => clearTimeout(t)
  }, [dirty, bk, loading, save, conflict])

  // Measure where content actually breaks into A4 pages — identical stage + logic
  // to the live preview / PDF export (lib/bookletExport) — and group the content
  // blocks into those same physical pages. Each page records whether it began
  // from a manual "New page" (breakId, removable) or automatic overflow (auto).
  useEffect(() => {
    if (loading || !bk) return
    // Debounced, and deliberately slower than the live preview's own pass. This
    // only feeds the "Page N" headers down the left, which nobody is watching
    // mid-sentence, so running it less often keeps the main thread free for the
    // preview — and staggering the two stops both ~47ms passes landing in the
    // same frame.
    const raf = setTimeout(() => {
      const content = (bk.blocks || []).filter(b => b.section !== 'homework' && b.section !== 'revision')
      const PAGE_H = 1123
      const stage = document.createElement('div')
      stage.className = 'bk-root'
      stage.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1;visibility:hidden'
      const style = document.createElement('style')
      style.textContent = BOOKLET_CSS
      stage.appendChild(style)
      document.body.appendChild(stage)
      const newPage = () => {
        const page = document.createElement('article'); page.className = 'bk-page'
        const inner = document.createElement('div'); inner.className = 'bk-content'
        page.appendChild(inner); stage.appendChild(page)
        return { page, inner }
      }
      const out = []
      let cur = { breakId: null, auto: false, ids: [] }
      let mp = newPage()
      let countOnPage = 0
      let qn = 0
      for (const b of content) {
        // A manual "New page" always starts a fresh builder page (even if it ends
        // up empty — e.g. a break at the very end), so the button always shows.
        if (b.type === 'pagebreak') {
          out.push(cur); cur = { breakId: b.id, auto: false, ids: [] }
          mp = newPage(); countOnPage = 0
          continue
        }
        if (b.type === 'stimulus') qn = 0   // each stimulus restarts question numbering
        if (b.type === 'question' || b.type === 'mcq') qn++
        const ctx = { solutions: solnView, qNum: qn, hideSectionSyllabus: /maths/i.test(bk?.subject || '') && !isExamStyle, hideMarks: /maths/i.test(bk?.subject || '') && !isExamStyle }
        const tmp = document.createElement('div')
        tmp.innerHTML = blockHtml(b, ctx)
        const el = tmp.firstElementChild
        if (el) {
          mp.inner.appendChild(el)
          if (mp.page.scrollHeight > PAGE_H && countOnPage > 0) {
            mp.inner.removeChild(el)
            out.push(cur); cur = { breakId: null, auto: true, ids: [] }
            mp = newPage(); countOnPage = 0
            mp.inner.appendChild(el)
          }
          // Even alone the block is taller than a page: split a multi-part
          // question between its parts (same fallback as preview/export). The
          // block id is grouped onto the page where the question starts.
          const chunks = mp.page.scrollHeight > PAGE_H ? questionChunksHtml(b, ctx) : null
          if (chunks) {
            mp.inner.removeChild(el)
            let idPushed = false
            for (const ch of chunks) {
              const t2 = document.createElement('div')
              t2.innerHTML = ch
              const cel = t2.firstElementChild
              if (!cel) continue
              mp.inner.appendChild(cel)
              if (mp.page.scrollHeight > PAGE_H && countOnPage > 0) {
                mp.inner.removeChild(cel)
                if (idPushed) {
                  // Continuation spills over: later blocks join the new page.
                  out.push(cur); cur = { breakId: null, auto: true, ids: [] }
                }
                mp = newPage(); countOnPage = 0
                mp.inner.appendChild(cel)
              }
              if (!idPushed) { cur.ids.push(b.id); idPushed = true }
              countOnPage++
            }
            if (!idPushed) cur.ids.push(b.id)
            continue
          }
        }
        cur.ids.push(b.id); countOnPage++
      }
      out.push(cur)
      document.body.removeChild(stage)
      setPhysicalPages(out)
    }, 450)
    return () => clearTimeout(raf)
    // Keyed on `blocks` rather than the whole `bk`: page grouping depends on the
    // blocks and the copy being shown, not on the title or year.
  }, [bk?.blocks, bk?.subject, bk?.doc_type, solnView, loading])

  /*
   * Undo (Ctrl/Cmd+Z) — the builder keeps its own history while it is mounted,
   * because every change here is a change to one `bk` object rather than a
   * discrete row write the portal-wide stack could reverse. Each mutation
   * snapshots the document as it was BEFORE the change; undo pops the last
   * snapshot back on, and the debounced autosave persists it like any edit.
   *
   * Only the document is rewound. Identity and publish state (id, status,
   * booklet_id) change outside `mutate` and must survive an undo.
   */
  const DOC_FIELDS = ['title', 'year', 'subject', 'topic', 'delivery', 'doc_type',
    'cover', 'content', 'blocks', 'syllabus_points', 'qbank_topic_ids']
  const docOf = (b) => Object.fromEntries(
    DOC_FIELDS.filter(k => k in (b || {})).map(k => [k, b[k]]))
  const historyRef = useRef([])
  const mergedRef = useRef(0)
  // The history lives in a ref — it must not re-render the editor on every
  // keystroke — so what the toolbar button needs is mirrored into state.
  const [undoTop, setUndoTop] = useState(null)   // { depth, label } | null

  const pushHistory = (prev, label, mergeKey) => {
    if (!prev) return
    const hist = historyRef.current
    const top = hist[hist.length - 1]
    // Typing fires a change per keystroke, so consecutive edits to the SAME
    // field fold into one step — undo walks back by phrase, not by character.
    // The run is capped so a long paragraph doesn't become a single step, and
    // a delete or a move (no merge key) always begins a step of its own.
    if (mergeKey && top?.mergeKey === mergeKey && mergedRef.current < MERGE_RUN) {
      mergedRef.current++
      return
    }
    hist.push({ label, mergeKey, doc: docOf(prev) })
    if (hist.length > UNDO_DEPTH) hist.shift()
    mergedRef.current = 0
    setUndoTop({ depth: hist.length, label })
  }

  const mutate = (patch, label = 'Edit', mergeKey = null) => {
    pushHistory(bk, label, mergeKey)
    setBk(b => ({ ...b, ...patch }))
    setDirty(true)
  }
  const setBlocks = (blocks, label = 'Edit', mergeKey = null) => mutate({ blocks }, label, mergeKey)

  // Clear the finished publish bar a few seconds after the tab is actually
  // looked at. Timing it from when the publish ENDED would clear it while the
  // user is still away in another tab — they would come back to no sign of
  // whether it worked, which is the whole reason the bar is held.
  useEffect(() => {
    if (!pubProgress?.done) return undefined
    let timer = null
    const startCountdown = () => {
      if (timer) return
      timer = setTimeout(() => setPubProgress(p => (p?.done ? null : p)), 6000)
    }
    const onVisible = () => { if (!document.hidden) startCountdown() }
    if (!document.hidden) startCountdown()
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [pubProgress?.done])

  // Take over Ctrl/Cmd+Z while the builder is mounted (GlobalUndo, mounted in
  // TutorNav, routes the shortcut here; the portal-wide stack resumes on
  // unmount). The shortcut stands down while focus is in a text field, where
  // native text undo wins — the toolbar button is the way back from there.
  const undoLast = useCallback(() => {
    const hist = historyRef.current
    const step = hist.pop()
    if (!step) { announceUndo('Nothing left to undo in this workbook', false); return }
    mergedRef.current = 0
    setBk(b => (b ? { ...b, ...step.doc } : b))
    setDirty(true)
    const next = hist[hist.length - 1]
    setUndoTop(next ? { depth: hist.length, label: next.label } : null)
    announceUndo(`Undone: ${step.label}`, true)
  }, [])
  useEffect(() => setUndoHandler(undoLast), [undoLast])

  // Chemistry pool: the Content tab's checklist of every dotpoint this booklet
  // covers. It is the single source of truth — unticking a dotpoint also pulls
  // it out of any section it was allocated to (confirmed first, since that
  // changes the printed booklet).
  const setChemPool = (nextIds) => {
    const prev = new Set(Array.isArray(bk.syllabus_points) ? bk.syllabus_points : [])
    const removed = [...prev].filter(id => !nextIds.includes(id))
    let blocks = bk.blocks || []
    if (removed.length) {
      const alloc = dotpointAllocation(blocks)
      const used = removed.filter(id => (alloc[id] || []).length > 0)
      if (used.length) {
        const secs = [...new Set(used.flatMap(id => alloc[id].map(s =>
          [s.number, s.title].filter(v => v != null && String(v).trim() !== '').join('. ') || 'a section')))]
        const msg = `Unticking removes ${used.length === 1 ? 'this dotpoint' : `${used.length} dotpoints`} from ${secs.join(', ')} as well. Continue?`
        if (!confirm(msg)) return
      }
      blocks = removeDotpointsFromSections(blocks, chemSyllabus, removed).blocks
    }
    mutate({ syllabus_points: nextIds, blocks }, 'Syllabus selection')
  }

  // Topic scope for a test: the qbank topics for this build's subject + year.
  const bkSubject = bk?.subject
  const bkYear = bk?.year
  const scopeTopics = useMemo(() => {
    if (!tax || !bkSubject) return []
    const fam = subjectFamily(bkSubject)
    const subjIds = new Set((tax.subjects || [])
      .filter(s => subjectFamily(s.name) === fam && (bkYear == null || Number(s.year_level) === Number(bkYear)))
      .map(s => s.id))
    return (tax.topics || []).filter(t => subjIds.has(t.subject_id))
  }, [tax, bkSubject, bkYear])
  const toggleTestTopic = (tid) => {
    const set = new Set(bk.qbank_topic_ids || [])
    set.has(tid) ? set.delete(tid) : set.add(tid)
    mutate({ qbank_topic_ids: [...set] }, 'Test topics')
  }

  // Each block carries a section ('content' | 'homework' | 'revision'). Homework
  // blocks also carry hwGroup ('foundational' | 'developmental'). Legacy blocks
  // (no section) are treated as content. The canonical array order is kept as
  // content → homework/foundational → homework/developmental → revision quiz.
  const sectionOf = (b) => (b.section === 'homework' ? 'homework' : b.section === 'revision' ? 'revision' : 'content')
  const tagOf = (b) => {
    const s = sectionOf(b)
    return s === 'homework' ? `hw:${b.hwGroup === 'developmental' ? 'developmental' : 'foundational'}` : s
  }
  const recompose = (arr) => ([
    ...arr.filter(b => sectionOf(b) === 'content'),
    ...arr.filter(b => sectionOf(b) === 'homework' && b.hwGroup !== 'developmental'),
    ...arr.filter(b => sectionOf(b) === 'homework' && b.hwGroup === 'developmental'),
    ...arr.filter(b => sectionOf(b) === 'revision'),
  ])

  // Insert a (new or bank) block into the currently-active section/group, keeping
  // the canonical ordering, then scroll it into view.
  const insertBlock = (blk) => {
    const arr = [...(bk.blocks || [])]
    const anchorIdx = selectedBlockId ? arr.findIndex(b => b.id === selectedBlockId) : -1
    let mk
    if (anchorIdx >= 0) {
      // Insert right after the selected block, in that block's section/group.
      const a = arr[anchorIdx]
      mk = { ...blk, section: a.section || 'content', hwGroup: a.section === 'homework' ? (a.hwGroup || 'foundational') : undefined }
      arr.splice(anchorIdx + 1, 0, mk)
    } else {
      if (activeSection === 'homework') mk = { ...blk, section: 'homework', hwGroup: activeHwGroup }
      else if (activeSection === 'revision') mk = { ...blk, section: 'revision', hwGroup: undefined }
      else mk = { ...blk, section: 'content', hwGroup: undefined }
      arr.push(mk)
    }
    setBlocks(recompose(arr), 'Add block')
    setLastAddedId(mk.id)
    setSelectedBlockId(mk.id) // keep building downward from the new block
  }
  const addBlock = (type) => insertBlock(newBlock(type))
  // After a new bank question is saved, fetch it (with parts + images) and drop
  // it into the booklet as a block, mirroring the "from question bank" flow.
  const onNewQuestionSaved = async (qid) => {
    const { data } = await supabase.from(T_QBANK_QUESTIONS)
      .select('*, qbank_question_parts(*), qbank_question_images(id, storage_path, alt, sort_order, role)')
      .eq('id', qid).single()
    if (data) insertBlock(bankToBlock(data))
    setNewQOpen(false)
  }
  const updateBlock = (bid, next) => setBlocks(bk.blocks.map(b => b.id === bid ? next : b), 'Edit block', `block:${bid}`)
  // One stable onChange per block. BlockEditor is memoised, and a fresh arrow
  // function here would defeat that entirely — every keystroke would re-render
  // every block's editor form, which is what made typing crawl on a long
  // booklet. The handler reads updateBlock through a ref so it never goes
  // stale despite never being recreated.
  const updateBlockRef = useRef(updateBlock)
  updateBlockRef.current = updateBlock
  const blockChangeHandlers = useRef(new Map())
  const onChangeFor = (bid) => {
    let h = blockChangeHandlers.current.get(bid)
    if (!h) {
      h = (next) => updateBlockRef.current(bid, next)
      blockChangeHandlers.current.set(bid, h)
    }
    return h
  }
  const removeBlock = (bid) => { setBlocks(bk.blocks.filter(b => b.id !== bid), 'Delete block'); if (selectedBlockId === bid) setSelectedBlockId(null) }
  // The bin sits next to the move arrows and a mis-click costs a whole block,
  // so it asks first — unless the 5-minute quiet window is still open, which is
  // there for clearing out several blocks in a row.
  const requestRemoveBlock = (b) => {
    if (Date.now() < deleteAskAgainAt.current) { removeBlock(b.id); return }
    setPendingDelete(b)
  }
  const confirmRemoveBlock = (quietFor5Min) => {
    if (quietFor5Min) deleteAskAgainAt.current = Date.now() + 5 * 60 * 1000
    if (pendingDelete) removeBlock(pendingDelete.id)
    setPendingDelete(null)
  }
  // Move within the same section/group only (skips over blocks of other groups).
  const moveBlock = (bid, dir) => {
    const arr = [...(bk.blocks || [])]
    const i = arr.findIndex(b => b.id === bid)
    if (i < 0) return
    const tag = tagOf(arr[i])
    let j = i + dir
    while (j >= 0 && j < arr.length && tagOf(arr[j]) !== tag) j += dir
    if (j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]; setBlocks(arr, 'Move block')
  }
  // The two homework groups are a difficulty split of one list, not separate
  // documents, so a question can hop between them — rebalancing a homework
  // after writing it is the normal case. The block lands at the end of the
  // group it moves to, where ↑/↓ can then place it.
  const setHwGroup = (bid, group) => {
    const arr = [...(bk.blocks || [])]
    const i = arr.findIndex(b => b.id === bid)
    if (i < 0 || sectionOf(arr[i]) !== 'homework') return
    const [m] = arr.splice(i, 1)
    const moved = { ...m, hwGroup: group }
    // Insert after the last block already in the target group, rather than
    // leaving it at whatever index it happened to occupy in the old group.
    let last = -1
    arr.forEach((b, k) => { if (tagOf(b) === `hw:${group}`) last = k })
    arr.splice(last + 1, 0, moved)
    setBlocks(recompose(arr), 'Move block')
    setSelectedBlockId(moved.id)
  }
  // Drag-to-reorder within a section/group — plus, for homework, dragging a
  // question onto a card in the other group to move it there. Cards only start
  // a drag from the ⠿ handle — otherwise dragging inside the editor's controls
  // (the table width slider, text selection in inputs) would drag the card too.
  const dragId = useRef(null)
  const dragArmed = useRef(false)
  // Scroll container of the live preview (for card → preview double-click jumps).
  const previewScrollRef = useRef(null)
  const blocksScrollRef = useRef(null)
  const onDropOn = (targetId) => {
    const arr = [...(bk.blocks || [])]
    const from = arr.findIndex(b => b.id === dragId.current)
    const to = arr.findIndex(b => b.id === targetId)
    if (from < 0 || to < 0 || from === to) return
    // Crossing between the two homework groups is a move, not a rejected drop.
    const crossHw = tagOf(arr[from]) !== tagOf(arr[to])
      && sectionOf(arr[from]) === 'homework' && sectionOf(arr[to]) === 'homework'
    if (tagOf(arr[from]) !== tagOf(arr[to]) && !crossHw) return
    const group = arr[to].hwGroup === 'developmental' ? 'developmental' : 'foundational'
    const [m] = arr.splice(from, 1)
    arr.splice(to, 0, crossHw ? { ...m, hwGroup: group } : m)
    setBlocks(crossHw ? recompose(arr) : arr, 'Move block')
  }

  // delivery rides along so the renderer swaps writing lines for typing boxes
  // in an online workbook — live preview and PDF preview both read it here.
  // Memoised: BookletPreview re-paginates the whole booklet whenever `meta`
  // changes identity, and a fresh object literal on every render meant a full
  // pass (~47ms on a 76-block booklet) for renders that changed nothing it
  // cares about.
  const meta = useMemo(
    () => (bk ? { subject: bk.subject, year: bk.year, topic: bk.topic, name: bk.title, docType: bk.doc_type || 'booklet', cover: bk.cover || null, delivery: bk.delivery || 'physical' } : {}),
    [bk?.subject, bk?.year, bk?.topic, bk?.title, bk?.doc_type, bk?.cover, bk?.delivery],
  )

  // Handed to every BlockEditor, so a new Set each render would break their
  // memoisation. It lives up here with the other hooks because the render
  // below returns early while the booklet is loading — a hook after that point
  // is only called on some renders, which breaks the rules of hooks.
  const chemPool = useMemo(
    () => new Set(Array.isArray(bk?.syllabus_points) ? bk.syllabus_points : []),
    [bk?.syllabus_points],
  )
  const isLevelTest = bk?.doc_type === 'level_test'
  const isPreTest = bk?.doc_type === 'pre_test'
  // Exam-style docs (level tests + pre-tests) use a two-column layout: one big
  // left column (palette folded in + questions) and the live preview on the right.
  const isExamStyle = isLevelTest || isPreTest
  // Back-links land on the subject-scoped Exams page (the unscoped page was
  // retired) — the build's subject resolves to its hub family, Maths as default.
  const backScope = Object.keys(SUBJECT_FAMILIES).find(f => SUBJECT_FAMILIES[f].includes(bk?.subject)) || 'Maths'
  const back = isPreTest
    ? { href: `/tutor/resources/tests?tab=pre-tests&subject=${backScope}`, label: '← Pre-tests' }
    : isLevelTest
      ? { href: `/tutor/resources/tests?tab=level-tests&subject=${backScope}`, label: '← Level tests' }
      : { href: '/tutor/booklets/builder', label: '← Booklets' }

  const openExport = async (solutions) => {
    setExporting(true)
    try {
      const res = await exportBookletPdf({ meta, blocks: bk.blocks, solutions, preview: true })
      setPreview({ url: res.url, filename: res.filename, title: solutions ? 'Solutions copy — preview' : 'Student copy — preview' })
    } catch (e) { alert('Export failed: ' + e.message) }
    finally { setExporting(false) }
  }
  const closePreview = () => { if (preview?.url) URL.revokeObjectURL(preview.url); setPreview(null) }

  /*
   * Publish: render both PDFs, upload to the booklets bucket, upsert a booklets
   * row (so it can be assigned to a class on the curriculum page), link it back.
   *
   * WORKBOOKS ONLY. A pre-test or level test belongs to its own page, keyed to a
   * class and term — it is not curriculum a class gets assigned in a given week,
   * and publishing one filed it in the workbook database under a year/subject
   * where it read as a workbook. Those docs autosave and are reached from the
   * Pre-tests / Level tests pages; their PDFs come from the export buttons.
   */
  const publish = async () => {
    if (isExamStyle) {
      alert(`A ${isPreTest ? 'pre-test' : 'level test'} isn’t a workbook — it stays on its own page. `
        + 'Use the Student / Solutions PDF buttons for a copy to hand out.')
      return
    }
    if (!bk.year) { alert('Set a Year before saving to the curriculum.'); return }
    setPublishing(true)
    // Publishing renders TWO full PDFs and uploads them, which on a long booklet
    // takes long enough that a plain "Saving…" looks hung. Each stage owns a
    // slice of the bar; the PDF stages sub-report per page.
    setPubProgress({ pct: 0, label: 'Saving booklet…' })
    const stageProgress = (from, to) => (f, label) =>
      setPubProgress({ pct: Math.round((from + (to - from) * f) * 100), label })
    try {
      await save()
      setPubProgress({ pct: 4, label: 'Preparing student copy…' })
      // Both copies embed the same web fonts. The first export derives the CSS
      // from its own rendered pages and returns it; the second reuses it. (It
      // must come from real pages — deriving it from a synthetic probe once
      // shipped PDFs whose maths fell back to system fonts.)
      let fontEmbedCSS
      const subjectLower = (bk.subject || 'mathematics').toLowerCase()
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      const upload = async (solutions, tag, from, to) => {
        const res = await exportBookletPdf({
          meta, blocks: bk.blocks, solutions, preview: true, fontEmbedCSS,
          onProgress: stageProgress(from, to - 0.04),
        })
        const { blob } = res
        fontEmbedCSS = fontEmbedCSS || res.fontEmbedCSS
        setPubProgress({ pct: Math.round((to - 0.04) * 100), label: `Uploading ${tag} copy…` })
        const path = `y${bk.year}/${subjectLower}/${stamp}_${tag}.pdf`
        const { error } = await supabase.storage.from('booklets').upload(path, blob, { upsert: true, contentType: 'application/pdf' })
        if (error) throw error
        setPubProgress({ pct: Math.round(to * 100), label: `Uploaded ${tag} copy` })
        return path
      }
      // Online workbooks are delivered as a typeable student doc — publishing
      // links them into the curriculum but renders no PDFs at all.
      const isOnline = bk.delivery === 'online'
      const studentPath = isOnline ? null : await upload(false, 'student', 0.04, 0.50)
      const solutionsPath = isOnline ? null : await upload(true, 'solutions', 0.50, 0.94)
      const filePaths = isOnline ? [] : [studentPath, solutionsPath]
      // Name the two copies so student vs solutions (teacher) is clear in the
      // curriculum, e.g. "5.MS. Algebra 1" and "5.MT. Algebra 1". Order matches
      // filePaths (student, then solutions).
      const meta2 = { year: bk.year, subject: bk.subject, title: bk.title }
      const pdfFilenames = isOnline ? [] : [bookletPdfName(meta2, 'S'), bookletPdfName(meta2, 'T')]
      const payload = {
        booklet_name: bk.title, year: Number(bk.year), subject: bk.subject,
        topic: bk.topic || null,
        content: bk.subject === 'Chemistry' ? buildSyllabusContent(bk.blocks) : (bk.content || null),
        file_path: studentPath, file_paths: filePaths, pdf_filenames: pdfFilenames,
        delivery: isOnline ? 'online' : 'physical',
      }
      setPubProgress({ pct: 95, label: 'Updating the curriculum…' })
      let bookletId = bk.booklet_id
      let oldPaths = []
      if (bookletId) {
        // Grab the previous PDF paths so we can clean them up after re-publishing.
        const { data: existing } = await supabase.from(T_BOOKLETS).select('file_path, file_paths').eq('id', bookletId).maybeSingle()
        oldPaths = existing?.file_paths?.length ? existing.file_paths : (existing?.file_path ? [existing.file_path] : [])
        await supabase.from(T_BOOKLETS).update(payload).eq('id', bookletId)
      } else {
        const { data, error } = await supabase.from(T_BOOKLETS).insert(payload).select('id').single()
        if (error) throw error
        bookletId = data.id
      }
      await supabase.from(T_BOOKLET_BUILDS).update({ status: 'published', booklet_id: bookletId }).eq('id', bk.id)

      // Delete the booklet's previous PDFs from storage so repeated re-publishes
      // don't leave orphaned files accumulating in the bucket. (Each publish uses
      // a fresh timestamped filename, so none of the old paths are reused.)
      const orphaned = oldPaths.filter(p => p && !filePaths.includes(p))
      if (orphaned.length) await supabase.storage.from('booklets').remove(orphaned)
      setBk(b => ({ ...b, status: 'published', booklet_id: bookletId }))
      setPubProgress({ pct: 100, label: 'Saved to curriculum', done: true })
      // A publish can finish while the tab is in the background, and Chrome
      // drops alert() from a tab that isn't in front — so the finished bar is
      // the confirmation, and it stays put until the tab is looked at again
      // (see the effect below). The dialog is a foreground-only extra.
      if (!document.hidden) {
        alert('Saved to curriculum. You can now assign it to a class from the Curriculum page.')
      }
      setPublishing(false)
      return
    } catch (e) {
      setPubProgress({ pct: 100, label: `Save to curriculum failed: ${e.message}`, done: true, failed: true })
      if (!document.hidden) alert('Save to curriculum failed: ' + e.message)
    }
    setPublishing(false)
  }

  if (loading) return <div className="min-h-screen bg-white"><TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} /><p className="text-center text-[#325099] text-sm mt-20">Loading…</p></div>
  if (!bk) return <div className="min-h-screen bg-white"><TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} /><p className="text-center text-rose-500 text-sm mt-20">Booklet not found.</p></div>

  // Split blocks by section/group for the editor lists.
  const allBlocks = bk.blocks || []
  const contentBlocks = allBlocks.filter(b => sectionOf(b) === 'content')
  const foundBlocks = allBlocks.filter(b => sectionOf(b) === 'homework' && b.hwGroup !== 'developmental')
  const devBlocks = allBlocks.filter(b => sectionOf(b) === 'homework' && b.hwGroup === 'developmental')
  const hwBlocks = allBlocks.filter(b => sectionOf(b) === 'homework')   // flat list (English)
  const quizBlocks = allBlocks.filter(b => sectionOf(b) === 'revision')

  // Chemistry uses a fixed module/week naming scheme (e.g. M2W3 → "11.C. M2W3")
  // and only runs in Years 11–12.
  const isChem = bk.subject === 'Chemistry'
  // Subject-aware palette: the Maths object block is Maths-only, and the
  // reading-comprehension stimulus block is English-only.
  const isEnglish = /english/i.test(bk.subject || '')
  const isMathsSubj = /maths/i.test(bk.subject || '')
  const paletteHides = (t) => (t.type === 'mathobj' && !isMathsSubj) || (t.type === 'stimulus' && !isEnglish)
  // English and Chemistry homework are one flexible list (no Foundational /
  // Developmental split); teachers add their own subheadings, so the homework
  // palette offers one.
  const flatHomework = isEnglish || isChem
  const hwPaletteTypes = flatHomework
    ? [{ type: 'subtopic', label: 'Subheading', icon: '—' }, ...HW_BLOCK_TYPES]
    : HW_BLOCK_TYPES
  const yearOptions = isChem ? [11, 12] : YEARS
  // Chemistry booklets are named M<module>L<lesson> — Chemistry counts in lessons,
  // not weeks. Legacy "W" names still parse so older booklets keep their numbers
  // in these inputs; editing either field rewrites the title in the L form.
  const chemMatch = /^M(\d*)[LW](\d*)$/i.exec(bk.title || '')
  const chemModule = chemMatch ? chemMatch[1] : ''
  const chemLesson = chemMatch ? chemMatch[2] : ''

  // Card lookup by id (block + its global index, so move up/down still spans the
  // whole content list even across page boundaries).
  const blockById = Object.fromEntries(contentBlocks.map((b, i) => [b.id, { b, i }]))
  // Pages to render: the measured physical pages when available, otherwise a
  // single page with every (non-break) content block as a first-paint fallback.
  const contentPages = (physicalPages && physicalPages.length)
    ? physicalPages
    : [{ breakId: null, auto: false, ids: contentBlocks.filter(b => b.type !== 'pagebreak').map(b => b.id) }]

  // Chemistry pool state for the Content tab: what's ticked, and which section
  // each ticked dotpoint is allocated to (for the per-dotpoint chips).
  const chemAlloc = dotpointAllocation(allBlocks)
  const chemUnallocated = [...chemPool].filter(id => !(chemAlloc[id] || []).length).length
  const poolToggle = (id, on) => { const s = new Set(chemPool); if (on) s.add(id); else s.delete(id); setChemPool([...s]) }
  const poolToggleGroup = (main, on) => { const s = new Set(chemPool); for (const x of main.subs) { if (on) s.add(x.id); else s.delete(x.id) } setChemPool([...s]) }
  // Allocation chip for a pooled dotpoint: the section(s) it prints under, or
  // an amber "unallocated" nudge when no section has drawn it yet.
  const poolChip = (id) => {
    if (!chemPool.has(id)) return null
    const secs = chemAlloc[id] || []
    return secs.length ? (
      <span className="ml-2 shrink-0 text-[10px] font-semibold text-[#16A34A] bg-[#F0FDF4] border border-[#BBF7D0] rounded-full px-1.5 py-0.5">
        {secs.map(s => [s.number, s.title].filter(v => v != null && String(v).trim() !== '').join('. ') || 'section').join(' · ')}
      </span>
    ) : (
      <span className="ml-2 shrink-0 text-[10px] font-semibold text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-full px-1.5 py-0.5">unallocated</span>
    )
  }

  // Chemistry "Content" (summary) tab: the dotpoints each section header draws
  // from the master list, compiled by section (builder overview). Each section
  // block's `syllabus` text is generated from its drawn dotpoints.
  const chemSyllabusSections = contentBlocks
    .filter(b => b.type === 'section')
    .map(b => ({
      label: [b.number, b.title].filter(v => v != null && String(v).trim() !== '').join('. '),
      lines: String(b.syllabus || '').split('\n').map(l => ({
        sub: /^\s+/.test(l),
        text: l.replace(/^\s*[-•]\s*/, '').trim(),
      })).filter(l => l.text),
    }))
    .filter(s => s.lines.length)

  // Double-click a block card → scroll the live preview to that block's
  // rendered element (the mirror of onPreviewDblClick below). Scrolls only the
  // preview pane — not the window — and pulses the block so the eye lands on it.
  const onCardDblClick = (e, bid) => {
    // Leave double-clicks inside form controls alone (word-select while editing).
    if (e.target.closest('textarea, input, select, button, [contenteditable="true"]')) return
    const host = previewScrollRef.current
    // From inside a part's editor, land on that part in the preview — the
    // descendant selector also finds parts living in a continuation chunk.
    const pid = e.target.closest('[data-part]')?.getAttribute('data-part')
    const target = (pid && host?.querySelector(`[data-bid="${CSS.escape(bid)}"] [data-pid="${CSS.escape(pid)}"]`))
      || host?.querySelector(`[data-bid="${CSS.escape(bid)}"]`)
    if (!target) return
    setSelectedBlockId(bid)
    const hostRect = host.getBoundingClientRect()
    const tRect = target.getBoundingClientRect()
    host.scrollTo({
      top: host.scrollTop + (tRect.top - hostRect.top) - Math.max(0, (host.clientHeight - tRect.height) / 2),
      behavior: 'smooth',
    })
    target.animate?.(
      [{ boxShadow: '0 0 0 3px rgba(50,80,153,.55)' }, { boxShadow: '0 0 0 3px rgba(50,80,153,0)' }],
      { duration: 1200, easing: 'ease-out' },
    )
  }

  // Centre a block card in the blocks column. From lg up that column is its
  // own scroll container, so scroll it directly: scrollIntoView animates every
  // scrollable ancestor it can find, which is slower to get going and is what
  // made the jump feel like it stalled first. Below lg the column is not
  // scrollable and the page scroll is the right thing to move.
  const jumpToCard = (bid, pid = null) => {
    const card = document.getElementById(`blk-${bid}`)
    if (!card) return
    // A part id narrows the landing spot: double-clicking part (c) in the
    // preview centres part (c)'s editor, not the middle of a question card
    // that may be taller than the screen.
    const target = (pid && card.querySelector(`[data-part="${CSS.escape(pid)}"]`)) || card
    target.animate?.(
      [{ boxShadow: '0 0 0 3px rgba(50,80,153,.55)' }, { boxShadow: '0 0 0 3px rgba(50,80,153,0)' }],
      { duration: 1200, easing: 'ease-out' },
    )
    const host = blocksScrollRef.current
    if (!host || host.scrollHeight <= host.clientHeight + 1) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    const hostRect = host.getBoundingClientRect()
    const tRect = target.getBoundingClientRect()
    host.scrollTo({
      top: host.scrollTop + (tRect.top - hostRect.top)
        - Math.max(0, (host.clientHeight - tRect.height) / 2),
      behavior: 'smooth',
    })
  }

  // Double-click anywhere on the live preview → jump to the corresponding
  // block card (switching to its page tab first if needed) and select it.
  const onPreviewDblClick = (e) => {
    const el = e.target?.closest?.('[data-bid]')
    if (!el) return
    const bid = el.getAttribute('data-bid')
    const blk = (bk?.blocks || []).find(x => x.id === bid)
    if (!blk) return
    // Clicked inside a part? Land on that part's editor, not the block's middle.
    const pel = e.target?.closest?.('[data-pid]')
    const pid = pel && el.contains(pel) ? pel.getAttribute('data-pid') : null
    const sec = sectionOf(blk)
    // Only a tab switch has to render before the card exists. In every other
    // case — the common one — jump straight away instead of sitting out a
    // fixed delay first.
    const needsTabSwitch = !isExamStyle && activeSection !== sec
    if (needsTabSwitch) setActiveSection(sec)
    setSelectedBlockId(bid)
    if (needsTabSwitch) requestAnimationFrame(() => requestAnimationFrame(() => jumpToCard(bid, pid)))
    else jumpToCard(bid, pid)
  }

  // One block card (drag handle, type badge, move/delete, editor). `list` is the
  // group the block belongs to so up/down can disable at the group's ends.
  const renderBlockCard = (b, list, i) => {
    const selected = selectedBlockId === b.id
    // Homework questions can be regraded between the two difficulty groups.
    // English/Chemistry homework is a single flat list, so there is nowhere to
    // move to and the control is hidden.
    const hwSwap = sectionOf(b) === 'homework' && !flatHomework
      ? (b.hwGroup === 'developmental'
        ? { to: 'foundational', label: 'Foundational' }
        : { to: 'developmental', label: 'Developmental' })
      : null
    return (
    <div key={b.id}
      id={`blk-${b.id}`}
      ref={b.id === lastAddedId ? lastBlockRef : null}
      draggable
      onDragStart={e => {
        const armed = dragArmed.current
        dragArmed.current = false
        if (!armed) { e.preventDefault(); return }
        dragId.current = b.id
      }}
      onMouseUp={() => { dragArmed.current = false }}
      onDragOver={e => e.preventDefault()}
      onDrop={() => onDropOn(b.id)}
      onDoubleClick={e => onCardDblClick(e, b.id)}
      className={`rounded-xl border p-3.5 transition ${b.type === 'section'
        ? `bg-[#DCE7FB] ${selected ? 'border-[#325099] ring-2 ring-[#325099]/20' : 'border-[#9FB7E8]'}`
        : b.type === 'subtopic'
        ? `bg-[#EDE7FB] ${selected ? 'border-[#6D4FA3] ring-2 ring-[#6D4FA3]/20' : 'border-[#C9B8E8]'}`
        : `bg-white ${selected ? 'border-[#325099] ring-2 ring-[#325099]/20' : 'border-[#DEE7FF]'}`}`}>
      <div className="flex items-center justify-between mb-2.5 cursor-pointer"
        onClick={() => setSelectedBlockId(id => id === b.id ? null : b.id)}
        title="Click to insert new blocks right after this one">
        <div className="flex items-center gap-2">
          <span className="cursor-grab active:cursor-grabbing text-[#2A2035]/30 text-sm"
            title={hwSwap ? 'Drag to reorder — or drop onto the other homework group to move it there' : 'Drag to reorder'}
            onMouseDown={() => { dragArmed.current = true }}>⠿</span>
          <span className="text-[10px] font-bold tracking-wider uppercase text-[#325099] bg-[#EEF4FF] border border-[#DEE7FF] rounded-full px-2 py-0.5">{BLOCK_TYPES.find(t => t.type === b.type)?.label || b.type}</span>
          {selected && <span className="text-[10px] font-semibold text-[#325099]">↳ new blocks insert here</span>}
        </div>
        <div className="flex items-center gap-1.5 text-[#2A2035]/40">
          {hwSwap && (
            <button onClick={e => { e.stopPropagation(); setHwGroup(b.id, hwSwap.to) }}
              title={`Move this question to ${hwSwap.label} Questions`}
              className="text-[10px] font-semibold text-[#325099]/70 hover:text-[#325099] hover:bg-[#EEF4FF] border border-[#DEE7FF] rounded-full px-2 py-0.5 mr-0.5 transition whitespace-nowrap">⇄ {hwSwap.label}</button>
          )}
          <button onClick={e => { e.stopPropagation(); moveBlock(b.id, -1) }} disabled={i === 0} className="hover:text-[#325099] disabled:opacity-20 text-sm">↑</button>
          <button onClick={e => { e.stopPropagation(); moveBlock(b.id, 1) }} disabled={i === list.length - 1} className="hover:text-[#325099] disabled:opacity-20 text-sm">↓</button>
          <button onClick={e => { e.stopPropagation(); requestRemoveBlock(b) }} title="Delete this block" className="hover:text-rose-500 text-sm ml-1">🗑</button>
        </div>
      </div>
      <BlockEditor block={b} onChange={onChangeFor(b.id)} isChem={isChem} isMaths={isMathsSubj} hideMarks={isMathsSubj && !isExamStyle} syllabus={chemSyllabus} syllabusPool={isChem ? chemPool : null} />
    </div>
    )
  }

  const paletteCard = (
    <div className="bg-white rounded-xl border border-[#DEE7FF] p-3 shadow-sm">
      <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold mb-2">{isExamStyle ? 'Add questions' : 'Add a block'}</p>
      {activeSection === 'content' && isExamStyle ? (
        /* Exam-style docs (level tests + pre-tests) are question-only — no text /
           callout / layout blocks, just questions from the bank or new ones. */
        <div className="flex flex-col gap-1.5">
          <button onClick={() => setBankOpen(true)} className="w-full text-left text-xs font-semibold text-white bg-[#325099] rounded-lg px-2.5 py-1.5 hover:bg-[#062E63] transition">＋ From question bank</button>
          <button onClick={() => setNewQOpen(true)} className="w-full text-left text-xs font-semibold text-[#16A34A] border border-[#BBF7D0] bg-[#F0FDF4] rounded-lg px-2.5 py-1.5 hover:bg-[#DCFCE7] transition">＋ New question → bank</button>
        </div>
      ) : activeSection === 'content' ? (
        <div className="space-y-3">
          {BLOCK_GROUPS.map(g => (
            <div key={g}>
              <p className="text-[9px] font-bold uppercase tracking-wider text-[#2A2035]/35 mb-1">{g}</p>
              <div className="flex flex-col gap-1.5">
                {BLOCK_TYPES.filter(t => t.group === g && !paletteHides(t)).map(t => (
                  <button key={t.type} onClick={() => addBlock(t.type)} className="w-full text-left text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 hover:bg-[#F0F4FF] transition">
                    <span className="mr-1.5">{t.icon}</span>{t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : activeSection === 'homework' ? (
        <div className="space-y-2.5">
          {!flatHomework && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-[#2A2035]/35 mb-1">Adding to</p>
              <div className="flex items-stretch rounded-lg border border-[#DEE7FF] overflow-hidden text-[11px]">
                {HW_GROUPS.map((g, gi) => (
                  <button key={g.id} onClick={() => setActiveHwGroup(g.id)}
                    className={`flex-1 px-2 py-1 font-semibold ${gi > 0 ? 'border-l border-[#DEE7FF]' : ''} ${activeHwGroup === g.id ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {hwPaletteTypes.filter(t => !paletteHides(t)).map(t => (
              <button key={t.type} onClick={() => addBlock(t.type)} className="w-full text-left text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 hover:bg-[#F0F4FF] transition">
                <span className="mr-1.5">{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {HW_BLOCK_TYPES.filter(t => !paletteHides(t)).map(t => (
            <button key={t.type} onClick={() => addBlock(t.type)} className="w-full text-left text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 hover:bg-[#F0F4FF] transition">
              <span className="mr-1.5">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    // From lg up the builder is a fixed-height shell: nav + top bar at their
    // natural heights, then the columns take exactly what is left. Nothing
    // scrolls the page itself, so the nav never slides away underneath you and
    // the columns never jump to a sticky offset mid-scroll. Below lg the grid
    // is one column and the page scrolls normally.
    <div className="min-h-screen lg:h-screen lg:flex lg:flex-col lg:overflow-hidden bg-[#F7F9FF]">
      <TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} />

      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-white border-b border-[#DEE7FF]">
        <div className="max-w-[1500px] mx-auto px-5 py-3 lg:py-2 flex items-center gap-3 flex-wrap">
          <button onClick={() => router.push(back.href)} className="text-[#325099] text-sm hover:underline">{back.label}</button>
          <div className="flex-1 min-w-[200px] text-base font-semibold text-[#2A2035] px-2 py-1 truncate" title="Auto-formatted from Year · Subject · Booklet name">{formatBookletName(bk.year, bk.subject, bk.title)}</div>
          <span className={`text-[11px] ${conflict ? 'text-[#B23A3A] font-bold' : 'text-[#2A2035]/40'}`}>
            {conflict ? 'Not saved' : saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}
          </span>
          {/* Senior English: how this workbook reaches students. Online = a
              typeable student doc; publishing renders no PDFs. Shown whenever
              it applies (or is already online, so it can always be switched
              back after a subject/year change). */}
          {(bk.delivery === 'online' || (/english/i.test(bk.subject || '') && Number(bk.year) >= 7 && !isExamStyle)) && (
            <button
              onClick={() => mutate({ delivery: bk.delivery === 'online' ? 'physical' : 'online' }, 'Delivery')}
              title={bk.delivery === 'online'
                ? 'Online workbook — students type into it in their portal; publishing renders no PDFs. Click to make it a printed workbook.'
                : 'Physical workbook — printed as PDFs. Click to make it an online typeable doc.'}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-full border transition ${bk.delivery === 'online'
                ? 'bg-[#ECF9F4] text-[#0E7A5F] border-[#CBEBDF] hover:bg-[#DDF3EA]'
                : 'bg-white text-[#2A2035]/50 border-[#DEE7FF] hover:bg-[#F8FAFF]'}`}
            >
              {bk.delivery === 'online' ? '🌐 Online' : '🖨 Physical'}
            </button>
          )}
          {/* Ctrl/Cmd+Z does the same thing, but it stands down while the caret
              is in a text field (native text undo wins there) — so the button
              is the way back after a delete made mid-edit. */}
          <button
            onClick={undoLast}
            disabled={!undoTop}
            title={undoTop ? `Undo: ${undoTop.label} (Ctrl/Cmd+Z)` : 'Nothing to undo yet'}
            className="px-2.5 py-1.5 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] disabled:opacity-30 disabled:hover:bg-white"
          >
            ↩ Undo
          </button>
          <button onClick={() => openExport(false)} disabled={exporting} className="px-3 py-1.5 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] disabled:opacity-40">Student PDF</button>
          <button onClick={() => openExport(true)} disabled={exporting} className="px-3 py-1.5 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] disabled:opacity-40">Solutions PDF</button>
          {/* Workbooks only — a pre-test / level test has no place in the
              workbook database, so it isn't offered the button. */}
          {!isExamStyle && (
            <button onClick={publish} disabled={publishing} className="px-3 py-1.5 text-xs font-semibold text-white bg-[#325099] rounded-lg hover:bg-[#062E63] disabled:opacity-40">{publishing ? `Saving… ${pubProgress?.pct ?? 0}%` : bk.status === 'published' ? 'Update curriculum' : 'Save to curriculum'}</button>
          )}
        </div>
        {/* Saving to the curriculum renders and uploads two PDFs, so it can take
            a while on a long booklet. The bar reports the real stage rather than
            leaving the button spinning with no sign of life. */}
        {pubProgress && (
          <div className="max-w-[1500px] mx-auto px-5 pb-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-[#EEF2FB] overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-300 ease-out"
                  style={{ width: `${pubProgress.pct}%`, background: pubProgress.failed ? '#B23A3A' : pubProgress.done ? '#047857' : '#325099' }}
                  role="progressbar"
                  aria-valuenow={pubProgress.pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Saving to curriculum"
                />
              </div>
              {!pubProgress.done && <span className="text-[11px] font-bold text-[#325099] tabular-nums w-10 text-right">{pubProgress.pct}%</span>}
              <span className={`text-[11px] min-w-[150px] ${pubProgress.failed ? 'text-[#B23A3A] font-semibold' : pubProgress.done ? 'text-[#047857] font-semibold' : 'text-[#2A2035]/55'}`}>
                {pubProgress.done && !pubProgress.failed ? '✓ ' : ''}{pubProgress.label}
              </span>
            </div>
          </div>
        )}
        {/* Someone else saved this workbook while it was open here. Autosave has
            stopped rather than overwrite them; the choice of which copy to keep
            is the user's, so nothing is discarded automatically. */}
        {conflict && (
          <div className="max-w-[1500px] mx-auto px-5 pb-3">
            <div className="rounded-xl border border-[#FDE68A] bg-[#FEF3C7] px-4 py-3 flex flex-wrap items-center gap-3">
              <span className="text-lg leading-none">⚠</span>
              <p className="text-[11px] font-semibold text-[#92400E] flex-1 min-w-[240px]">
                This workbook was saved somewhere else while you had it open, so your changes have
                <strong> not</strong> been saved — saving now would wipe out that other version.
                Reload to get the newer copy (your unsaved edits here will be lost), or copy anything
                you need out first.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="shrink-0 px-3 py-1.5 text-xs font-semibold text-white bg-[#B45309] rounded-lg hover:bg-[#92400E] transition"
              >Reload the newer version</button>
            </div>
          </div>
        )}

        {/* Meta row — Year is a dropdown; Booklet name is typed. The subject is
            fixed per workbook (set from its subject hub on creation) and shown
            read-only. The full name auto-formats as "Year.SubjectCode. Name". */}
        <div className="max-w-[1500px] mx-auto px-5 pb-3 lg:pb-2 flex items-center gap-2 flex-wrap text-sm">
          {bk.subject && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#EEF4FF] border border-[#DEE7FF] px-2.5 py-1.5 text-xs font-semibold text-[#325099]"
              title="Subject is fixed per workbook — change it in the database explorer if needed">
              {SUBJECTS.find(s => s.value === bk.subject)?.label || bk.subject}
            </span>
          )}
          <select value={bk.year ?? ''} onChange={e => mutate({ year: e.target.value ? Number(e.target.value) : null }, 'Year')}
            className="w-28 border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-[#325099]">
            <option value="">Year…</option>
            {yearOptions.map(y => <option key={y} value={y}>Year {y}</option>)}
          </select>
          {isChem ? (
            <div className="flex items-center gap-2">
              <input type="number" min="1" value={chemModule}
                onChange={e => mutate({ title: `M${e.target.value.replace(/\D/g, '')}L${chemLesson}` }, 'Module', 'title')}
                placeholder="Module #"
                className="w-28 border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-[#325099]" />
              <input type="number" min="1" value={chemLesson}
                onChange={e => mutate({ title: `M${chemModule}L${e.target.value.replace(/\D/g, '')}` }, 'Lesson', 'title')}
                placeholder="Lesson #"
                className="w-28 border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-[#325099]" />
            </div>
          ) : isPreTest || isLevelTest ? (
            /* Pre-test and level-test names are fixed automatically — no manual name input. */
            null
          ) : (
            <input value={bk.title || ''} onChange={e => mutate({ title: e.target.value }, 'Name', 'title')}
              placeholder="Booklet name (e.g. Algebra)"
              className="flex-1 min-w-[180px] max-w-[380px] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-[#325099]" />
          )}
          {/* Which copy the preview shows. It lives up here rather than above
              the preview pane so that pane can use the full height of the
              column — with the page no longer scrolling, a header row inside
              the column was 32px the preview could not spare. */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold">Preview</span>
            <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden text-xs">
              <button onClick={() => setSolnView(false)} className={`px-2.5 py-1 font-semibold ${!solnView ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>Student</button>
              <button onClick={() => setSolnView(true)} className={`px-2.5 py-1 font-semibold border-l border-[#DEE7FF] ${solnView ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>Solutions</button>
            </div>
          </div>
        </div>
      </div>

      <div className={`w-full max-w-[1560px] mx-auto px-5 py-5 lg:py-3 grid grid-cols-1 gap-5 lg:flex-1 lg:min-h-0 ${isExamStyle ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)]' : 'lg:grid-cols-[minmax(0,1fr)_208px_minmax(0,560px)]'}`}>
        {/* Blocks column — the added building blocks. min-w-0 lets this flexible
            column compress instead of forcing the whole page to scroll sideways.
            From lg up it scrolls on its own, capped to the same height as the
            preview beside it: this column is what drives the page's height, so
            without a cap the only way to reach the last block was to scroll the
            whole page, and the last card sat flush against the bottom edge. The
            trailing padding leaves that card some room to breathe. Below lg the
            grid is a single column, where ordinary page scrolling is right. */}
        <div ref={blocksScrollRef} className="min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-2 lg:pb-24">
          {/* Exam-style docs: choose which topics the test covers, then fold the
              question palette into the top of this column. */}
          {isExamStyle && (
            <div className="mb-4 bg-white rounded-xl border border-[#DEE7FF] p-3 shadow-sm">
              <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold mb-2">Topics in this test</p>
              {!bk.subject || !bk.year ? (
                <p className="text-xs text-[#2A2035]/40 italic">Set a subject and year first.</p>
              ) : scopeTopics.length === 0 ? (
                <p className="text-xs text-[#2A2035]/40 italic">No topics for this subject/year.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {scopeTopics.map(t => {
                    const on = (bk.qbank_topic_ids || []).includes(t.id)
                    return (
                      <button key={t.id} onClick={() => toggleTestTopic(t.id)}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${on ? 'bg-[#325099] text-white border-[#325099]' : 'bg-white text-[#2A2035]/60 border-[#DEE7FF] hover:border-[#325099]'}`}>
                        {t.name}
                      </button>
                    )
                  })}
                </div>
              )}
              <p className="text-[10px] text-[#2A2035]/40 mt-2">The question bank below shows only these topics. Leave all off to allow any topic for the year.</p>
            </div>
          )}
          {/* Exam-style docs: editable cover page (title, subtitle, instruction and
              Total Marks lines — e.g. the working time). Clearing a list hides
              that section on the cover entirely. */}
          {isExamStyle && (
            <div className="mb-4 bg-white rounded-xl border border-[#DEE7FF] p-3 shadow-sm">
              <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold mb-2">Cover page</p>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="block text-[10px] font-semibold text-[#2A2035]/50 mb-0.5">Title</label>
                  <input value={bk.cover?.title ?? ''} placeholder={`${bk.year ? `Year ${bk.year} ` : ''}${bk.subject === 'Maths' ? 'Mathematics' : bk.subject || ''}`}
                    onChange={e => mutate({ cover: { ...(bk.cover || {}), title: e.target.value } }, 'Cover', 'cover:title')}
                    className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-[#325099]" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[#2A2035]/50 mb-0.5">Subtitle</label>
                  <input value={bk.cover?.subtitle ?? ''} placeholder={isPreTest ? 'Pre-Test' : 'Level Test'}
                    onChange={e => mutate({ cover: { ...(bk.cover || {}), subtitle: e.target.value } }, 'Cover', 'cover:subtitle')}
                    className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-[#325099]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-[#2A2035]/50 mb-0.5">General instructions (one per line — e.g. the working time)</label>
                  <textarea rows={4} value={(bk.cover?.instructions ?? DEFAULT_LT_INSTRUCTIONS).join('\n')}
                    onChange={e => mutate({ cover: { ...(bk.cover || {}), instructions: e.target.value.split('\n') } }, 'Cover', 'cover:instructions')}
                    className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-[#325099]" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[#2A2035]/50 mb-0.5">Total Marks lines (one per line — clear all to hide the section)</label>
                  <textarea rows={4} value={(bk.cover?.totals ?? DEFAULT_LT_TOTALS).join('\n')}
                    onChange={e => mutate({ cover: { ...(bk.cover || {}), totals: e.target.value.split('\n') } }, 'Cover', 'cover:totals')}
                    className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-[#325099]" />
                </div>
              </div>
            </div>
          )}
          {/* Exam-style docs fold the question palette into the top of this column. */}
          {isExamStyle && activeSection !== 'summary' && (
            <div className="mb-4">{paletteCard}</div>
          )}
          {/* Page tabs — Cover is automatic (page 1); Content + Homework are editable.
              Exam-style docs (level tests + pre-tests) are a single page of
              questions, so they have no page tabs. */}
          {!isExamStyle && (
            <div className="flex items-center gap-1 mb-3 bg-white border border-[#DEE7FF] rounded-xl p-1 w-fit">
              {[{ id: 'content', label: 'Content page' }, { id: 'homework', label: 'Homework page' }, { id: 'revision', label: 'Revision Quiz' }, { id: 'summary', label: 'Content' }].map(s => (
                <button key={s.id} onClick={() => { setActiveSection(s.id); setSelectedBlockId(null) }}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition ${activeSection === s.id ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Add palette — sticky so it stays reachable as the block list grows.
              The page-coloured band starts higher than the card (top-[96px] +
              pt-4 keeps the card at ~112px) so it tucks under the opaque header
              and there's no see-through gap; blocks scroll cleanly behind it.
              Hidden on the "Content" (summary) tab, which has no blocks. */}
          {activeSection === 'content' && contentPages.length > 1 && (
            <div className="sticky top-[96px] lg:top-0 z-20 bg-[#F7F9FF] pt-4 pb-3">
              <div className="bg-white rounded-xl border border-[#DEE7FF] p-2 shadow-sm flex items-center gap-1.5 flex-wrap">
                <span className="text-[9px] font-bold uppercase tracking-wider text-[#2A2035]/35 mr-0.5">Jump to page</span>
                {contentPages.map((pg, pi) => (
                  <button key={pi} onClick={() => document.getElementById(`bk-page-anchor-${pi}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    title={pg.auto ? 'Automatic overflow page' : 'Page'}
                    className="text-[11px] font-semibold text-[#325099] border border-[#DEE7FF] rounded-md px-2 py-0.5 hover:bg-[#F0F4FF] transition">
                    {pi + 1}{pg.auto && <span className="text-[#2A2035]/30">·</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Blocks */}
          {activeSection === 'content' ? (
            contentBlocks.length === 0 ? (
              <div className="text-center py-16 text-sm text-[#2A2035]/40 bg-white rounded-xl border border-dashed border-[#DEE7FF]">No content blocks yet — add one from the palette.</div>
            ) : (
              /* One flat list: page headers are siblings of the block cards, not
                 wrappers around them. Grouping the cards under a per-page <div>
                 meant that re-measuring the page breaks (which happens on every
                 keystroke) moved a card into a different parent, and React
                 remounts a subtree that changes parent however stable its key
                 is. That threw away each textarea's DOM node — losing the
                 height the user had dragged it to, and the caret with it. Kept
                 flat, a card whose page changes is only re-ordered among its
                 siblings, so the same node is moved and its size survives. */
              <div className="space-y-3">
                {contentPages.flatMap((pg, pi) => [
                  <div key={`pg-hdr-${pi}`} id={`bk-page-anchor-${pi}`} className="scroll-mt-[230px] lg:scroll-mt-[76px] flex items-center gap-2 pt-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#325099] bg-[#EEF4FF] border border-[#DEE7FF] rounded-full px-2.5 py-0.5">Page {pi + 1}</span>
                    {pg.auto && <span className="text-[9px] font-semibold uppercase tracking-wider text-[#2A2035]/35" title="Starts automatically because the previous page is full">auto</span>}
                    <div className="h-px flex-1 bg-[#DEE7FF]" />
                    {pg.breakId && <button onClick={() => removeBlock(pg.breakId)} className="text-[10px] font-semibold text-rose-500 hover:underline">✕ remove break</button>}
                  </div>,
                  ...(pg.ids.length === 0
                    ? [<div key={`pg-empty-${pi}`} className="text-center py-5 text-xs text-[#2A2035]/40 bg-white rounded-xl border border-dashed border-[#DEE7FF]">Empty page — add blocks from the palette or remove this break.</div>]
                    : pg.ids.map(bid => { const e = blockById[bid]; return e ? renderBlockCard(e.b, contentBlocks, e.i) : null })),
                ])}
              </div>
            )
          ) : activeSection === 'homework' ? (
            flatHomework ? (
              // English & Chemistry: one flexible homework list with teacher-authored subheadings.
              hwBlocks.length === 0 ? (
                <div className="text-center py-16 text-sm text-[#2A2035]/40 bg-white rounded-xl border border-dashed border-[#DEE7FF]">No homework yet — add questions and your own subheadings from the palette.</div>
              ) : (
                <div className="space-y-3">
                  {hwBlocks.map((b, i) => renderBlockCard(b, hwBlocks, i))}
                </div>
              )
            ) : (
            <div className="space-y-6">
              {HW_GROUPS.map(g => {
                const list = g.id === 'developmental' ? devBlocks : foundBlocks
                return (
                  <div key={g.id}>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#325099] mb-2">{g.label}</p>
                    {list.length === 0 ? (
                      <div className="text-center py-8 text-xs text-[#2A2035]/40 bg-white rounded-xl border border-dashed border-[#DEE7FF]">No questions yet — pick “{g.label}” above and add one.</div>
                    ) : (
                      <div className="space-y-3">{list.map((b, i) => renderBlockCard(b, list, i))}</div>
                    )}
                  </div>
                )
              })}
            </div>
            )
          ) : activeSection === 'revision' ? (
            quizBlocks.length === 0 ? (
              <div className="text-center py-16 text-sm text-[#2A2035]/40 bg-white rounded-xl border border-dashed border-[#DEE7FF]">No quiz questions yet — add one from the palette.</div>
            ) : (
              <div className="space-y-3">
                {quizBlocks.map((b, i) => renderBlockCard(b, quizBlocks, i))}
              </div>
            )
          ) : (
            <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5">
              <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold mb-2">Booklet content</p>
              {isChem ? (
                <>
                  <p className="text-xs text-[#2A2035]/55 mb-3">Tick every dotpoint from the master <Link href="/tutor/resources/syllabus?subject=Chemistry" className="underline text-[#325099]">Syllabus</Link> this booklet covers — that pool is the booklet’s content. Then allocate the ticked dotpoints to section headers on the <span className="font-semibold">Content page</span> (select a section block → “Syllabus dotpoints”, which offers only what’s ticked here). Unticking a dotpoint also removes it from its section.</p>
                  {chemSyllabus.length === 0 ? (
                    <p className="text-xs text-[#2A2035]/40 italic">No master syllabus for this year yet — add it on the <Link href="/tutor/resources/syllabus?subject=Chemistry" className="underline">Syllabus</Link> page.</p>
                  ) : (
                    <>
                      <p className="text-[11px] font-semibold text-[#325099] mb-2">
                        {countSelected(chemSyllabus, chemPool)} dotpoint{countSelected(chemSyllabus, chemPool) === 1 ? '' : 's'} in this booklet
                        {chemUnallocated > 0 && <span className="ml-2 font-semibold text-[#B45309]">· {chemUnallocated} not yet allocated to a section</span>}
                      </p>
                      <div className="rounded-xl border border-[#DEE7FF] bg-[#FBFCFF] px-4 py-3 mb-5 space-y-2 max-h-[520px] overflow-y-auto">
                        {chemSyllabus.map(mod => (
                          <div key={mod.id}>
                            <p className="text-[12px] font-bold text-[#062E63] mt-1">{mod.name}</p>
                            {mod.topics.map(tp => (
                              <div key={tp.id} className="mb-1.5">
                                <p className="text-[11px] font-semibold text-[#325099]">{tp.name}</p>
                                {tp.dotpoints.map(dp => {
                                  const cb = 'mt-0.5 shrink-0 accent-[#325099]'
                                  if (dp.subs.length === 0) {
                                    return (
                                      <label key={dp.id} className="flex items-start gap-1.5 py-0.5 cursor-pointer">
                                        <input type="checkbox" className={cb} checked={chemPool.has(dp.id)} onChange={e => poolToggle(dp.id, e.target.checked)} />
                                        <LatexContent className="text-[13px] text-[#2A2035]" text={dp.text} />
                                        {poolChip(dp.id)}
                                      </label>
                                    )
                                  }
                                  const all = dp.subs.every(s => chemPool.has(s.id))
                                  const some = dp.subs.some(s => chemPool.has(s.id))
                                  return (
                                    <div key={dp.id}>
                                      <label className="flex items-start gap-1.5 py-0.5 cursor-pointer">
                                        <input type="checkbox" className={cb} checked={all} ref={el => { if (el) el.indeterminate = some && !all }} onChange={e => poolToggleGroup(dp, e.target.checked)} />
                                        <LatexContent className="text-[13px] font-medium text-[#2A2035]" text={dp.text} />
                                      </label>
                                      <div className="pl-5">
                                        {dp.subs.map(s => (
                                          <label key={s.id} className="flex items-start gap-1.5 py-0.5 cursor-pointer">
                                            <input type="checkbox" className={cb} checked={chemPool.has(s.id)} onChange={e => poolToggle(s.id, e.target.checked)} />
                                            <LatexContent className="text-[12px] text-[#2A2035]/80" text={s.text} />
                                            {poolChip(s.id)}
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold mb-2">What prints under each section</p>
                    </>
                  )}
                  {chemSyllabus.length > 0 && chemSyllabusSections.length === 0 ? (
                    <p className="text-xs text-[#2A2035]/40 italic">Nothing allocated yet — add section headers on the Content page and draw pooled dotpoints into each.</p>
                  ) : (
                    <div className="space-y-4">
                      {chemSyllabusSections.map((s, i) => (
                        <div key={i}>
                          {s.label && <p className="text-sm font-semibold text-[#062E63] mb-1">{s.label}</p>}
                          <div className="space-y-1">
                            {s.lines.map((l, j) => (
                              <div key={j} className={`flex gap-2 text-sm text-[#2A2035]/80 ${l.sub ? 'pl-10' : 'pl-3'}`}>
                                <span className="shrink-0">{l.sub ? '—' : '•'}</span>
                                <span>{l.text}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-xs text-[#2A2035]/55 mb-3">A summary of what this booklet covers. Teachers see this via the “Content” link in the curriculum (it doesn’t appear in the printed booklet).</p>
                  <textarea
                    value={bk.content || ''}
                    onChange={e => mutate({ content: e.target.value }, 'Content', 'content')}
                    rows={12}
                    placeholder={'e.g.\n• Area of triangles\n• Area of composite shapes\n• 12 practice questions'}
                    className="w-full border border-[#DEE7FF] rounded-xl px-4 py-3 text-sm text-[#2A2035] focus:outline-none focus:border-[#325099] resize-y"
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* Palette column (booklets only) — exam-style docs fold it into the left column. */}
        {!isExamStyle && (
          <div className="lg:h-full lg:min-h-0 lg:overflow-y-auto">
            {activeSection !== 'summary' && paletteCard}
          </div>
        )}

        {/* Preview column */}
        <div className="min-w-0 lg:h-full lg:min-h-0">
          <div className="lg:h-full lg:min-h-0 lg:flex lg:flex-col">
            <div ref={previewScrollRef} className="bg-[#E9EDF6] rounded-xl p-4 overflow-auto max-h-[calc(100vh-160px)] lg:max-h-none lg:flex-1 lg:min-h-0"
              onDoubleClick={onPreviewDblClick}
              title="Double-click any part of the preview to jump to its block">
              <BookletPreview meta={meta} blocks={bk.blocks} solutions={solnView} />
            </div>
          </div>
        </div>
      </div>

      {pendingDelete && (() => {
        const label = BLOCK_TYPES.find(t => t.type === pendingDelete.type)?.label || pendingDelete.type
        // Enough of the block to recognise which one is about to go.
        const gist = (pendingDelete.title || pendingDelete.prompt || pendingDelete.body
                   || pendingDelete.text || pendingDelete.caption || '').replace(/\s+/g, ' ').trim()
        const parts = (pendingDelete.parts || []).length
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={e => { if (e.target === e.currentTarget) setPendingDelete(null) }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
              // Enter is left to the focused Delete button. Handling it here too
              // fired the delete twice and cost two Ctrl+Z presses to undo.
              onKeyDown={e => { if (e.key === 'Escape') setPendingDelete(null) }}>
              <div className="px-6 pt-5 pb-4">
                <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold">Delete block</p>
                <h2 className="text-base font-bold text-[#062E63] mt-1">Delete this {label.toLowerCase()}?</h2>
                {(gist || parts > 0) && (
                  <div className="mt-3 rounded-lg bg-[#F7F9FF] border border-[#DEE7FF] px-3 py-2">
                    {gist && <p className="text-xs text-[#2A2035] line-clamp-3">{gist.slice(0, 180)}{gist.length > 180 ? '…' : ''}</p>}
                    {parts > 0 && <p className="text-[11px] text-[#325099]/70 mt-1">{parts} part{parts === 1 ? '' : 's'} will go with it.</p>}
                  </div>
                )}
                <p className="text-[11px] text-[#2A2035]/55 mt-3">You can bring it back with Ctrl/Cmd+Z.</p>
              </div>
              <div className="px-6 py-3 bg-[#F8FAFF] border-t border-[#DEE7FF] flex flex-wrap items-center justify-end gap-2">
                <button onClick={() => setPendingDelete(null)}
                  className="px-4 py-2 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-white transition">Cancel</button>
                <button onClick={() => confirmRemoveBlock(true)}
                  title="Delete this one and stop asking for the next 5 minutes"
                  className="px-3 py-2 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-white transition">
                  Delete · don&rsquo;t ask for 5 min
                </button>
                <button onClick={() => confirmRemoveBlock(false)} autoFocus
                  className="px-4 py-2 text-xs font-bold text-white bg-rose-600 rounded-lg hover:bg-rose-700 transition">Delete</button>
              </div>
            </div>
          </div>
        )
      })()}

      {bankOpen && <BankPicker booklet={bk} onClose={() => setBankOpen(false)} onPick={(blk) => insertBlock(blk)} />}
      {newQOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
          onClick={(e) => { if (e.target === e.currentTarget) setNewQOpen(false) }}>
          <div className="bg-[#F7F9FF] rounded-2xl shadow-2xl w-full max-w-3xl my-8 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-[#062E63]">New question → bank &amp; booklet</h2>
              <button onClick={() => setNewQOpen(false)} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg">✕</button>
            </div>
            <p className="text-[11px] text-[#2A2035]/50 mb-4">Saved to the question bank and added to this booklet as a block.</p>
            <QuestionEditor staffName={staff?.full_name}
              defaults={{ year: bk.year, subjectName: bk.subject, audience: 'exam' }}
              onSaved={onNewQuestionSaved} onCancel={() => setNewQOpen(false)} />
          </div>
        </div>
      )}
      {preview && <PdfPreviewModal url={preview.url} filename={preview.filename} title={preview.title} onClose={closePreview} />}
    </div>
  )
}

// ── Question-bank picker ────────────────────────────────────────────────────────
function bankToBlock(q) {
  const imgs = (q.qbank_question_images || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const firstImg = imgs.filter(im => (im.role || 'stem') !== 'solution')[0]?.storage_path || ''
  const firstSolImg = imgs.filter(im => im.role === 'solution')[0]?.storage_path || ''
  if (q.qtype === 'mcq') {
    const opts = Array.isArray(q.options) ? q.options : []
    // Bank options are stored as { label, latex } — match by label (falling back
    // to position, and to legacy string / .text shapes) so the option text
    // actually carries across.
    const optText = (o) => {
      if (o == null) return ''
      if (typeof o === 'string') return o
      return o.latex ?? o.text ?? o.t ?? ''
    }
    const options = ['A', 'B', 'C', 'D'].map((k, i) => {
      const o = opts.find(x => String(x?.label ?? x?.k ?? '').toUpperCase() === k) ?? opts[i]
      return { k, t: optText(o) }
    })
    // qbank_question_id keeps the link to the bank so level-test marking can draw
    // the question's topic + marks for the topical analysis.
    return { ...newBlock('mcq'), qbank_question_id: q.id, prompt: q.stem_latex || '', image: firstImg, options, answer: (q.correct_option || '').toString().toUpperCase().slice(0, 1), explanation: q.solution_latex || '', marks: q.marks ? String(q.marks) : '' }
  }
  const parts = (q.qbank_question_parts || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map(p => ({ prompt: p.prompt_latex || '', image: '', solution: p.solution_latex || '', marks: p.marks != null ? String(p.marks) : '' }))
  // Carry the bank question's marks so the pre-test total is auto-calculated:
  // multipart questions sum their parts, single questions use their own marks.
  const partTotal = parts.reduce((s, p) => s + (Number(p.marks) || 0), 0)
  const marks = partTotal > 0 ? String(partTotal) : (q.marks != null ? String(q.marks) : '')
  return { ...newBlock('question'), qbank_question_id: q.id, prompt: q.stem_latex || '', image: firstImg, marks, solution: q.solution_latex || '', solutionImage: firstSolImg, parts }
}

// Group a subject name into a family so "Maths" matches Adv/Ext/Standard Maths.
const subjectFamily = (s) => {
  const v = (s || '').toLowerCase()
  if (/chem/.test(v)) return 'chem'
  if (/eng|eald/.test(v)) return 'eng'
  if (/math/.test(v)) return 'math'
  return v.trim()
}

function BankPicker({ booklet, onClose, onPick }) {
  const [qs, setQs] = useState(null)
  const [tax, setTax] = useState(null)
  const [search, setSearch] = useState('')
  const [qtype, setQtype] = useState('')

  useEffect(() => {
    supabase.from(T_QBANK_QUESTIONS)
      .select('*, qbank_question_parts(*), qbank_question_images(id, storage_path, alt, sort_order, role)')
      .then(({ data }) => setQs(data || []))
    fetchTaxonomy().then(setTax)
  }, [])

  // Resolve each question's subject via skill/subtopic/topic → subject.
  const maps = useMemo(() => {
    if (!tax) return null
    return {
      skill: Object.fromEntries((tax.skills || []).map(s => [s.id, s])),
      subtopic: Object.fromEntries((tax.subtopics || []).map(s => [s.id, s])),
      topic: Object.fromEntries((tax.topics || []).map(t => [t.id, t])),
      subject: Object.fromEntries((tax.subjects || []).map(s => [s.id, s])),
    }
  }, [tax])
  const qTopicId = useCallback((q) => {
    if (!maps) return null
    return maps.skill[q.skill_id]?.topic_id || maps.subtopic[q.subtopic_id]?.topic_id || q.topic_id || null
  }, [maps])
  const qSubject = useCallback((q) => (maps ? maps.subject[maps.topic[qTopicId(q)]?.subject_id] || null : null), [maps, qTopicId])

  const targetFam = subjectFamily(booklet?.subject)
  // Tests (level/pre) also restrict to the chosen year level.
  const isTest = booklet?.doc_type === 'pre_test' || booklet?.doc_type === 'level_test'
  const targetYear = isTest && booklet?.year != null ? Number(booklet.year) : null
  // If specific topics are chosen for the test, only pull from those.
  const targetTopics = Array.isArray(booklet?.qbank_topic_ids) && booklet.qbank_topic_ids.length
    ? new Set(booklet.qbank_topic_ids) : null
  const filtered = (qs || []).filter(q => {
    if (qtype && q.qtype !== qtype) return false
    if (search && !((q.stem_latex || '').toLowerCase().includes(search.toLowerCase()))) return false
    // Only pull from the chosen subject's (and, for tests, year's + topics') bank.
    if ((targetFam || targetYear != null || targetTopics) && maps) {
      const subj = qSubject(q)
      if (!subj) return false
      if (targetFam && subjectFamily(subj.name) !== targetFam) return false
      if (targetYear != null && Number(subj.year_level) !== targetYear) return false
      if (targetTopics && !targetTopics.has(qTopicId(q))) return false
    }
    return true
  }).slice(0, 80)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#DEE7FF] flex items-center gap-2">
          <h2 className="text-base font-bold text-[#2A2035] mr-auto">Add from question bank</h2>
          <select value={qtype} onChange={e => setQtype(e.target.value)} className="border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs focus:outline-none">
            <option value="">All types</option><option value="mcq">MCQ</option><option value="extended">Written</option>
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="border border-[#DEE7FF] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#325099]" />
          <button onClick={onClose} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg ml-1">✕</button>
        </div>
        <div className="overflow-y-auto p-3 space-y-1.5">
          {qs === null ? <p className="text-center text-xs text-[#2A2035]/40 py-8">Loading…</p>
            : filtered.length === 0 ? <p className="text-center text-xs text-[#2A2035]/40 py-8">No matching questions.</p>
            : filtered.map(q => (
              <button key={q.id} onClick={() => { onPick(bankToBlock(q)); onClose() }} className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg border border-[#E8EDF8] hover:border-[#BACBFF] hover:bg-[#F8FAFF] transition">
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#EEF4FF] text-[#325099] shrink-0">{q.qtype}</span>
                <span className="flex-1 min-w-0 text-xs text-[#2A2035] truncate">{(q.stem_latex || '(no text)').replace(/\$/g, '').slice(0, 110)}</span>
                {q.difficulty && <span className="text-[10px] text-[#2A2035]/40 shrink-0">D{q.difficulty}</span>}
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
