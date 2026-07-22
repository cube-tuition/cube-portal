'use client'
import Link from 'next/link'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '../../../../../lib/supabase'
import { getAuthProfile } from '../../../../../lib/getProfile'
import TutorNav from '../../../../../components/TutorNav'
import { T_BOOKLET_BUILDS, T_BOOKLETS, T_QBANK_QUESTIONS, T_TERMS } from '../../../../../lib/tables'
import { BLOCK_TYPES, BLOCK_GROUPS, HW_BLOCK_TYPES, HW_GROUPS, newBlock, blockHtml, questionChunksHtml, BOOKLET_CSS, DEFAULT_LT_INSTRUCTIONS, DEFAULT_LT_TOTALS } from '../../../../../lib/bookletRender'
import { exportBookletPdf } from '../../../../../lib/bookletExport'
import BlockEditor from '../../../../../components/booklet/BlockEditor'
import BookletPreview from '../../../../../components/booklet/BookletPreview'
import PdfPreviewModal from '../../../../../components/qbank/PdfPreviewModal'
import QuestionEditor from '../../../../../components/qbank/QuestionEditor'
import { fetchTaxonomy, SUBJECT_FAMILIES } from '../../../../../lib/qbank'
import { fetchSyllabus } from '../../../../../lib/syllabus'
import { buildSyllabusContent } from '../../../../../lib/bookletContent'

// Standard year/subject options so metadata is consistent across booklets.
// Topics are loaded per year+subject from the shared `topics` table. The stored
// value stays canonical ('Maths') to match the topics table / master database,
// while the dropdown shows the friendlier "Mathematics" label.
const YEARS = [5, 6, 7, 8, 9, 10, 11, 12]
const SUBJECTS = [
  { value: 'Maths', label: 'Mathematics' },
  { value: 'English', label: 'English' },
  { value: 'Chemistry', label: 'Chemistry' },
]
// Subject codes for the standardised booklet name (mirrors the Master Database).
const SUBJECT_CODE = {
  Maths: 'M', English: 'ET', Chemistry: 'C',
  'Standard Maths': 'MS', 'Adv Maths': 'MA', 'Ext 1 Maths': 'M1', 'Ext 2 Maths': 'M2', Physics: 'P',
}
const subjectCode = (s) => SUBJECT_CODE[s] || (s || '')[0]?.toUpperCase() || ''
// Standardised display name: "X.Y. Name" (year . subject-code . name).
// Chemistry names like "M3W2" display as "M3L2" (Chemistry counts in Lessons).
const formatBookletName = (year, subject, name) => {
  let base = (name || '').trim() || 'Untitled booklet'
  if (/chem/i.test(String(subject || ''))) base = base.replace(/^(M\d+)W(\d+)$/i, '$1L$2')
  return (year && subject) ? `${year}.${subjectCode(subject)}. ${base}` : base
}

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
  const [chemSyllabus, setChemSyllabus] = useState([])   // master syllabus for this booklet's year (Chemistry)
  const [tax, setTax] = useState(null)                   // qbank taxonomy (for the test topic scope)
  useEffect(() => { fetchTaxonomy().then(setTax) }, [])

  const bkRef = useRef(null)
  useEffect(() => { bkRef.current = bk })
  const savingRef = useRef(false), pendingRef = useRef(false)

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
        setBk({
          ...data,
          title,
          blocks: Array.isArray(data.blocks) ? data.blocks : [],
          syllabus_points: Array.isArray(data.syllabus_points) ? data.syllabus_points : [],
        })
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
        // Booklet-level syllabus_points = union of every section's drawn dotpoints
        // (drives the Syllabus page's auto coverage).
        const allPoints = [...new Set((b.blocks || []).flatMap(bl => (bl.type === 'section' && Array.isArray(bl.syllabus_points)) ? bl.syllabus_points : []))]
        // Chemistry: the content summary is generated from the sections' drawn
        // dotpoints (section header + its points). Other subjects keep free text.
        const contentVal = b.subject === 'Chemistry' ? buildSyllabusContent(b.blocks) : (b.content ?? null)
        await supabase.from(T_BOOKLET_BUILDS).update({
          title: b.title, year: b.year ? Number(b.year) : null, subject: b.subject, topic: b.topic,
          content: contentVal, blocks: b.blocks,
          cover: b.cover ?? null,
          syllabus_points: allPoints,
          qbank_topic_ids: Array.isArray(b.qbank_topic_ids) ? b.qbank_topic_ids : null,
          updated_at: new Date().toISOString(),
        }).eq('id', b.id)
      } while (pendingRef.current)
      setDirty(false)
    } finally { savingRef.current = false; setSaving(false) }
  }, [])

  useEffect(() => {
    if (loading || !dirty) return
    const t = setTimeout(() => save(), 900)
    return () => clearTimeout(t)
  }, [dirty, bk, loading, save])

  // Measure where content actually breaks into A4 pages — identical stage + logic
  // to the live preview / PDF export (lib/bookletExport) — and group the content
  // blocks into those same physical pages. Each page records whether it began
  // from a manual "New page" (breakId, removable) or automatic overflow (auto).
  useEffect(() => {
    if (loading || !bk) return
    const raf = requestAnimationFrame(() => {
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
    })
    return () => cancelAnimationFrame(raf)
  }, [bk, solnView, loading])

  const mutate = (patch) => { setBk(b => ({ ...b, ...patch })); setDirty(true) }
  const setBlocks = (blocks) => mutate({ blocks })

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
    mutate({ qbank_topic_ids: [...set] })
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
    setBlocks(recompose(arr))
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
  const updateBlock = (bid, next) => setBlocks(bk.blocks.map(b => b.id === bid ? next : b))
  const removeBlock = (bid) => { setBlocks(bk.blocks.filter(b => b.id !== bid)); if (selectedBlockId === bid) setSelectedBlockId(null) }
  // Move within the same section/group only (skips over blocks of other groups).
  const moveBlock = (bid, dir) => {
    const arr = [...(bk.blocks || [])]
    const i = arr.findIndex(b => b.id === bid)
    if (i < 0) return
    const tag = tagOf(arr[i])
    let j = i + dir
    while (j >= 0 && j < arr.length && tagOf(arr[j]) !== tag) j += dir
    if (j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]; setBlocks(arr)
  }
  // Drag-to-reorder (only within the same section/group). Cards only start a
  // drag from the ⠿ handle — otherwise dragging inside the editor's controls
  // (the table width slider, text selection in inputs) would drag the card too.
  const dragId = useRef(null)
  const dragArmed = useRef(false)
  const onDropOn = (targetId) => {
    const arr = [...(bk.blocks || [])]
    const from = arr.findIndex(b => b.id === dragId.current)
    const to = arr.findIndex(b => b.id === targetId)
    if (from < 0 || to < 0 || from === to) return
    if (tagOf(arr[from]) !== tagOf(arr[to])) return
    const [m] = arr.splice(from, 1); arr.splice(to, 0, m); setBlocks(arr)
  }

  const meta = bk ? { subject: bk.subject, year: bk.year, topic: bk.topic, name: bk.title, docType: bk.doc_type || 'booklet', cover: bk.cover || null } : {}
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

  // Publish: render both PDFs, upload to the booklets bucket, upsert a booklets
  // row (so it can be assigned to a class on the curriculum page), link it back.
  const publish = async () => {
    if (!bk.year) { alert('Set a Year before saving to the curriculum.'); return }
    setPublishing(true)
    try {
      await save()
      const subjectLower = (bk.subject || 'mathematics').toLowerCase()
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      const upload = async (solutions, tag) => {
        const { blob } = await exportBookletPdf({ meta, blocks: bk.blocks, solutions, preview: true })
        const path = `y${bk.year}/${subjectLower}/${stamp}_${tag}.pdf`
        const { error } = await supabase.storage.from('booklets').upload(path, blob, { upsert: true, contentType: 'application/pdf' })
        if (error) throw error
        return path
      }
      const studentPath = await upload(false, 'student')
      const solutionsPath = await upload(true, 'solutions')
      const filePaths = [studentPath, solutionsPath]
      const payload = {
        booklet_name: bk.title, year: Number(bk.year), subject: bk.subject,
        topic: bk.topic || null,
        content: bk.subject === 'Chemistry' ? buildSyllabusContent(bk.blocks) : (bk.content || null),
        file_path: studentPath, file_paths: filePaths,
      }
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
      alert('Saved to curriculum. You can now assign it to a class from the Curriculum page.')
    } catch (e) { alert('Save to curriculum failed: ' + e.message) }
    finally { setPublishing(false) }
  }

  if (loading) return <div className="min-h-screen bg-white"><TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} /><p className="text-center text-[#325099] text-sm mt-20">Loading…</p></div>
  if (!bk) return <div className="min-h-screen bg-white"><TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} /><p className="text-center text-rose-500 text-sm mt-20">Booklet not found.</p></div>

  // Split blocks by section/group for the editor lists.
  const allBlocks = bk.blocks || []
  const contentBlocks = allBlocks.filter(b => sectionOf(b) === 'content')
  const foundBlocks = allBlocks.filter(b => sectionOf(b) === 'homework' && b.hwGroup !== 'developmental')
  const devBlocks = allBlocks.filter(b => sectionOf(b) === 'homework' && b.hwGroup === 'developmental')
  const quizBlocks = allBlocks.filter(b => sectionOf(b) === 'revision')

  // Chemistry uses a fixed module/week naming scheme (e.g. M2W3 → "11.C. M2W3")
  // and only runs in Years 11–12.
  const isChem = bk.subject === 'Chemistry'
  // Subject-aware palette: the Maths object block is Maths-only, and the
  // reading-comprehension stimulus block is English-only.
  const isEnglish = /english/i.test(bk.subject || '')
  const isMathsSubj = /maths/i.test(bk.subject || '')
  const paletteHides = (t) => (t.type === 'mathobj' && !isMathsSubj) || (t.type === 'stimulus' && !isEnglish)
  const yearOptions = isChem ? [11, 12] : YEARS
  const chemMatch = /^M(\d*)W(\d*)$/i.exec(bk.title || '')
  const chemModule = chemMatch ? chemMatch[1] : ''
  const chemWeek = chemMatch ? chemMatch[2] : ''

  // Card lookup by id (block + its global index, so move up/down still spans the
  // whole content list even across page boundaries).
  const blockById = Object.fromEntries(contentBlocks.map((b, i) => [b.id, { b, i }]))
  // Pages to render: the measured physical pages when available, otherwise a
  // single page with every (non-break) content block as a first-paint fallback.
  const contentPages = (physicalPages && physicalPages.length)
    ? physicalPages
    : [{ breakId: null, auto: false, ids: contentBlocks.filter(b => b.type !== 'pagebreak').map(b => b.id) }]

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

  // Double-click anywhere on the live preview → jump to the corresponding
  // block card (switching to its page tab first if needed) and select it.
  const onPreviewDblClick = (e) => {
    const el = e.target?.closest?.('[data-bid]')
    if (!el) return
    const bid = el.getAttribute('data-bid')
    const blk = (bk?.blocks || []).find(x => x.id === bid)
    if (!blk) return
    const sec = sectionOf(blk)
    if (!isExamStyle && activeSection !== sec) setActiveSection(sec)
    setSelectedBlockId(bid)
    // Give a tab switch a beat to render the card before scrolling to it.
    setTimeout(() => {
      document.getElementById(`blk-${bid}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
  }

  // One block card (drag handle, type badge, move/delete, editor). `list` is the
  // group the block belongs to so up/down can disable at the group's ends.
  const renderBlockCard = (b, list, i) => {
    const selected = selectedBlockId === b.id
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
      className={`rounded-xl border p-3.5 transition ${b.type === 'section'
        ? `bg-[#DCE7FB] ${selected ? 'border-[#325099] ring-2 ring-[#325099]/20' : 'border-[#9FB7E8]'}`
        : b.type === 'subtopic'
        ? `bg-[#EDE7FB] ${selected ? 'border-[#6D4FA3] ring-2 ring-[#6D4FA3]/20' : 'border-[#C9B8E8]'}`
        : `bg-white ${selected ? 'border-[#325099] ring-2 ring-[#325099]/20' : 'border-[#DEE7FF]'}`}`}>
      <div className="flex items-center justify-between mb-2.5 cursor-pointer"
        onClick={() => setSelectedBlockId(id => id === b.id ? null : b.id)}
        title="Click to insert new blocks right after this one">
        <div className="flex items-center gap-2">
          <span className="cursor-grab active:cursor-grabbing text-[#2A2035]/30 text-sm" title="Drag to reorder"
            onMouseDown={() => { dragArmed.current = true }}>⠿</span>
          <span className="text-[10px] font-bold tracking-wider uppercase text-[#325099] bg-[#EEF4FF] border border-[#DEE7FF] rounded-full px-2 py-0.5">{BLOCK_TYPES.find(t => t.type === b.type)?.label || b.type}</span>
          {selected && <span className="text-[10px] font-semibold text-[#325099]">↳ new blocks insert here</span>}
        </div>
        <div className="flex items-center gap-1.5 text-[#2A2035]/40">
          <button onClick={e => { e.stopPropagation(); moveBlock(b.id, -1) }} disabled={i === 0} className="hover:text-[#325099] disabled:opacity-20 text-sm">↑</button>
          <button onClick={e => { e.stopPropagation(); moveBlock(b.id, 1) }} disabled={i === list.length - 1} className="hover:text-[#325099] disabled:opacity-20 text-sm">↓</button>
          <button onClick={e => { e.stopPropagation(); removeBlock(b.id) }} className="hover:text-rose-500 text-sm ml-1">🗑</button>
        </div>
      </div>
      <BlockEditor block={b} onChange={next => updateBlock(b.id, next)} isChem={isChem} syllabus={chemSyllabus} />
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
          <div className="flex flex-col gap-1.5">
            {HW_BLOCK_TYPES.filter(t => !paletteHides(t)).map(t => (
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
    <div className="min-h-screen bg-[#F7F9FF]">
      <TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} />

      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-white border-b border-[#DEE7FF]">
        <div className="max-w-[1500px] mx-auto px-5 py-3 flex items-center gap-3 flex-wrap">
          <button onClick={() => router.push(back.href)} className="text-[#325099] text-sm hover:underline">{back.label}</button>
          <div className="flex-1 min-w-[200px] text-base font-semibold text-[#2A2035] px-2 py-1 truncate" title="Auto-formatted from Year · Subject · Booklet name">{formatBookletName(bk.year, bk.subject, bk.title)}</div>
          <span className="text-[11px] text-[#2A2035]/40">{saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}</span>
          <button onClick={() => openExport(false)} disabled={exporting} className="px-3 py-1.5 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] disabled:opacity-40">Student PDF</button>
          <button onClick={() => openExport(true)} disabled={exporting} className="px-3 py-1.5 text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg hover:bg-[#F0F4FF] disabled:opacity-40">Solutions PDF</button>
          <button onClick={publish} disabled={publishing} className="px-3 py-1.5 text-xs font-semibold text-white bg-[#325099] rounded-lg hover:bg-[#062E63] disabled:opacity-40">{publishing ? 'Saving…' : bk.status === 'published' ? 'Update curriculum' : 'Save to curriculum'}</button>
        </div>
        {/* Meta row — Subject + Year are dropdowns; Booklet name is typed.
            The full name auto-formats as "Year.SubjectCode. Name" (shown above). */}
        <div className="max-w-[1500px] mx-auto px-5 pb-3 flex items-center gap-2 flex-wrap text-sm">
          <select value={bk.subject || ''} onChange={e => {
              const s = e.target.value
              const patch = { subject: s }
              if (s === 'Chemistry' && ![11, 12].includes(Number(bk.year))) patch.year = null
              mutate(patch)
            }}
            className="w-44 border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-[#325099]">
            <option value="">Subject…</option>
            {SUBJECTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            {bk.subject && !SUBJECTS.some(s => s.value === bk.subject) && <option value={bk.subject}>{bk.subject}</option>}
          </select>
          <select value={bk.year ?? ''} onChange={e => mutate({ year: e.target.value ? Number(e.target.value) : null })}
            className="w-28 border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-[#325099]">
            <option value="">Year…</option>
            {yearOptions.map(y => <option key={y} value={y}>Year {y}</option>)}
          </select>
          {isChem ? (
            <div className="flex items-center gap-2">
              <input type="number" min="1" value={chemModule}
                onChange={e => mutate({ title: `M${e.target.value.replace(/\D/g, '')}W${chemWeek}` })}
                placeholder="Module #"
                className="w-28 border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-[#325099]" />
              <input type="number" min="1" value={chemWeek}
                onChange={e => mutate({ title: `M${chemModule}W${e.target.value.replace(/\D/g, '')}` })}
                placeholder="Week #"
                className="w-28 border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-[#325099]" />
            </div>
          ) : isPreTest || isLevelTest ? (
            /* Pre-test and level-test names are fixed automatically — no manual name input. */
            null
          ) : (
            <input value={bk.title || ''} onChange={e => mutate({ title: e.target.value })}
              placeholder="Booklet name (e.g. Algebra)"
              className="flex-1 min-w-[180px] border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-[#325099]" />
          )}
        </div>
      </div>

      <div className={`max-w-[1560px] mx-auto px-5 py-5 grid grid-cols-1 gap-5 ${isExamStyle ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)]' : 'lg:grid-cols-[minmax(0,1fr)_208px_minmax(0,560px)]'}`}>
        {/* Blocks column — the added building blocks. min-w-0 lets this flexible
            column compress instead of forcing the whole page to scroll sideways. */}
        <div className="min-w-0">
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
                    onChange={e => mutate({ cover: { ...(bk.cover || {}), title: e.target.value } })}
                    className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-[#325099]" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[#2A2035]/50 mb-0.5">Subtitle</label>
                  <input value={bk.cover?.subtitle ?? ''} placeholder={isPreTest ? 'Pre-Test' : 'Level Test'}
                    onChange={e => mutate({ cover: { ...(bk.cover || {}), subtitle: e.target.value } })}
                    className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-[#325099]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-[#2A2035]/50 mb-0.5">General instructions (one per line — e.g. the working time)</label>
                  <textarea rows={4} value={(bk.cover?.instructions ?? DEFAULT_LT_INSTRUCTIONS).join('\n')}
                    onChange={e => mutate({ cover: { ...(bk.cover || {}), instructions: e.target.value.split('\n') } })}
                    className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-[#325099]" />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[#2A2035]/50 mb-0.5">Total Marks lines (one per line — clear all to hide the section)</label>
                  <textarea rows={4} value={(bk.cover?.totals ?? DEFAULT_LT_TOTALS).join('\n')}
                    onChange={e => mutate({ cover: { ...(bk.cover || {}), totals: e.target.value.split('\n') } })}
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
            <div className="sticky top-[96px] z-20 bg-[#F7F9FF] pt-4 pb-3">
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
              <div className="space-y-3">
                {contentPages.map((pg, pi) => (
                  <div key={pi} id={`bk-page-anchor-${pi}`} style={{ scrollMarginTop: 230 }} className="space-y-3">
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#325099] bg-[#EEF4FF] border border-[#DEE7FF] rounded-full px-2.5 py-0.5">Page {pi + 1}</span>
                      {pg.auto && <span className="text-[9px] font-semibold uppercase tracking-wider text-[#2A2035]/35" title="Starts automatically because the previous page is full">auto</span>}
                      <div className="h-px flex-1 bg-[#DEE7FF]" />
                      {pg.breakId && <button onClick={() => removeBlock(pg.breakId)} className="text-[10px] font-semibold text-rose-500 hover:underline">✕ remove break</button>}
                    </div>
                    {pg.ids.length === 0 ? (
                      <div className="text-center py-5 text-xs text-[#2A2035]/40 bg-white rounded-xl border border-dashed border-[#DEE7FF]">Empty page — add blocks from the palette or remove this break.</div>
                    ) : (
                      pg.ids.map(bid => { const e = blockById[bid]; return e ? renderBlockCard(e.b, contentBlocks, e.i) : null })
                    )}
                  </div>
                ))}
              </div>
            )
          ) : activeSection === 'homework' ? (
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
                  <p className="text-xs text-[#2A2035]/55 mb-3">The syllabus dotpoints each section draws from the master <Link href="/tutor/resources/syllabus?subject=Chemistry" className="underline text-[#325099]">Syllabus</Link> list, grouped by section header. Draw them per section on the <span className="font-semibold">Content page</span> (select a section block → “Syllabus dotpoints”). These print under each section header in the booklet.</p>
                  {chemSyllabusSections.length === 0 ? (
                    <p className="text-xs text-[#2A2035]/40 italic">No dotpoints drawn yet — add section headers on the Content page and draw dotpoints into each.</p>
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
                    onChange={e => mutate({ content: e.target.value })}
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
          <div>
            {activeSection !== 'summary' && (
              <div className="sticky top-[96px]">{paletteCard}</div>
            )}
          </div>
        )}

        {/* Preview column */}
        <div className="min-w-0">
          <div className="sticky top-[112px]">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold">Live preview</p>
              <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden text-xs">
                <button onClick={() => setSolnView(false)} className={`px-2.5 py-1 font-semibold ${!solnView ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>Student</button>
                <button onClick={() => setSolnView(true)} className={`px-2.5 py-1 font-semibold border-l border-[#DEE7FF] ${solnView ? 'bg-[#325099] text-white' : 'text-[#325099]'}`}>Solutions</button>
              </div>
            </div>
            <div className="bg-[#E9EDF6] rounded-xl p-4 overflow-auto max-h-[calc(100vh-160px)]"
              onDoubleClick={onPreviewDblClick}
              title="Double-click any part of the preview to jump to its block">
              <BookletPreview meta={meta} blocks={bk.blocks} solutions={solnView} />
            </div>
          </div>
        </div>
      </div>

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
