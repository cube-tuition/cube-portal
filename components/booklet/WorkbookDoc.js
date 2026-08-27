'use client'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { bookletRenderItems, BOOKLET_CSS } from '../../lib/bookletRender'
import { splitToFit } from '../../lib/paginate'
import { blockElements, checkQuote, paintRange, rangeToOffsets, unpaint } from './textAnchor'

/*
 * WorkbookDoc — an online workbook as real A4 pages, with each answer space a
 * live field. Three modes:
 *
 *   solutions   the teacher's reference copy: the workbook with its solutions
 *               and notes printed under each question. Nothing to type into.
 *   own         a student's copy: they type, it autosaves, teacher comments
 *               show in the margin.
 *   review      a teacher reading one student's copy: the work is read-only,
 *               and selecting any of it raises a "Comment" button — the comment
 *               anchors to that highlighted range and sits in the right margin.
 *
 * Pagination is the same measure-and-place loop the builder preview and the PDF
 * exporter use, so the pages break in the same places everywhere.
 */

const PAGE_W = 794
const GUTTER_W = 250   // comment margin; the balance strip mirrors it
const PAGE_H = 1123
const SPREAD_GAP = 24  // between the two pages of an open-book spread
const SAVE_DELAY = 900

const BOX_RE = /<div class="bk-answer-box"[^>]*style="min-height:(\d+)px"[^>]*><\/div>/g

function splitAtBoxes(html) {
  const out = []
  let last = 0, m
  BOX_RE.lastIndex = 0
  while ((m = BOX_RE.exec(html)) !== null) {
    out.push({ html: html.slice(last, m.index) })
    out.push({ box: true, minHeight: Number(m[1]) })
    last = m.index + m[0].length
  }
  out.push({ html: html.slice(last) })
  return out
}

// Answer spaces in document order — the renderer's own ordering, so the nth box
// on the page belongs to the nth slot here.
function answerSlots(blocks) {
  const slots = []
  const sec = (b) => (b?.section === 'homework' ? 'homework' : b?.section === 'revision' ? 'revision' : 'content')
  const grp = (b) => (b?.hwGroup === 'developmental' ? 'developmental' : 'foundational')
  const ordered = [
    ...blocks.filter(b => sec(b) === 'content'),
    ...blocks.filter(b => sec(b) === 'homework' && grp(b) === 'foundational'),
    ...blocks.filter(b => sec(b) === 'homework' && grp(b) === 'developmental'),
    ...blocks.filter(b => sec(b) === 'revision'),
  ]
  for (const b of ordered) {
    if (b.type === 'writing') { slots.push({ blockId: b.id, partId: '' }); continue }
    // A Teacher's Notes block is a slot the TEACHER owns: typed on the Workbook
    // tab, mirrored read-only into everyone else's copy.
    if (b.type === 'teachernotes') { slots.push({ blockId: b.id, partId: '', teacher: true }); continue }
    if (b.type !== 'question') continue
    const parts = b.parts || []
    if (parts.length) {
      parts.forEach((p, i) => {
        if (p.options && p.options.length) return
        if (p.answerType === 'object' && p.answerObj) return
        // Every part carries a stable id, but fall back to its index rather
        // than '' if one ever doesn't — an empty id would collapse all of a
        // question's parts onto one key and let answers overwrite each other.
        slots.push({ blockId: b.id, partId: p.id || `#${i}` })
      })
    } else {
      if (b.answerType === 'object' && b.answerObj) continue
      slots.push({ blockId: b.id, partId: '' })
    }
  }
  return slots
}

/* Word-level diff between the student's answer and the teacher's marked-up
   version. Tokens are words + the whitespace between them, so a changed word
   strikes just that word. Classic LCS table — answers are short; if two texts
   are ever long enough to make the table silly, fall back to a prefix/suffix
   trim so the UI never stalls. */
function diffWords(a, b) {
  const A = a.split(/(\s+)/).filter(Boolean), B = b.split(/(\s+)/).filter(Boolean)
  const out = []
  const push = (t, text) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last.t === t) last.text += text
    else out.push({ t, text })
  }
  if (A.length * B.length > 250000) {
    let i = 0
    while (i < A.length && i < B.length && A[i] === B[i]) i++
    let j = 0
    while (j < A.length - i && j < B.length - i && A[A.length - 1 - j] === B[B.length - 1 - j]) j++
    push('eq', A.slice(0, i).join(''))
    push('del', A.slice(i, A.length - j).join(''))
    push('ins', B.slice(i, B.length - j).join(''))
    push('eq', A.slice(A.length - j).join(''))
    return out
  }
  const n = A.length, m = B.length
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  let i = 0, j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('eq', A[i]); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', A[i++])
    else push('ins', B[j++])
  }
  while (i < n) push('del', A[i++])
  while (j < m) push('ins', B[j++])
  return out
}

/* Map a selection made on the DISPLAYED diff back to student-text offsets.
   eq/del segments are student text (they advance the source offset); ins
   segments are the teacher's words and anchor nothing. */
function displayedToSource(segs, ds, de) {
  let disp = 0, src = 0, start = null, end = null
  for (const seg of segs) {
    const len = seg.text.length
    if (seg.t !== 'ins') {
      const s = Math.max(ds, disp), e = Math.min(de, disp + len)
      if (e > s) {
        if (start === null) start = src + (s - disp)
        end = src + (e - disp)
      }
      src += len
    }
    disp += len
  }
  return start === null || end === null || end <= start ? null : { start, end }
}

/* Render diff segments with highlight marks laid over them. Marks live in
   student-text space, so they can only ever cover eq/del segments — which
   together ARE the student's text, in order. */
function renderSegs(segs, marks, onMarkClick) {
  const sorted = [...marks].sort((x, y) => x.start - y.start)
  const out = []
  let src = 0
  segs.forEach((seg, si) => {
    if (seg.t === 'ins') { out.push(<ins key={si} className="bk-ins">{seg.text}</ins>); return }
    const segStart = src, segEnd = src + seg.text.length
    src = segEnd
    let at = segStart
    const pieces = []
    for (const m of sorted) {
      const ms = Math.max(at, Math.min(m.start, segEnd))
      const me = Math.max(ms, Math.min(m.end, segEnd))
      if (me <= ms) continue
      if (ms > at) pieces.push({ text: seg.text.slice(at - segStart, ms - segStart) })
      pieces.push({ text: seg.text.slice(ms - segStart, me - segStart), m })
      at = me
    }
    if (at < segEnd) pieces.push({ text: seg.text.slice(at - segStart) })
    const kids = pieces.map((pc, i) => pc.m
      ? <mark key={i} className={pc.m.cls} onClick={() => onMarkClick?.(pc.m.id)}>{pc.text}</mark>
      : <span key={i}>{pc.text}</span>)
    out.push(seg.t === 'del'
      ? <del key={si} className="bk-del">{kids}</del>
      : <span key={si}>{kids}</span>)
  })
  return out
}

/* How a teacher edit relates to the answer as it now stands.
     'none'  — no edit, or the edit matches the answer exactly (nothing to show)
     'fresh' — the answer still equals the text the edit marked (or the edit
               predates base tracking): the tracked-changes diff is faithful
     'stale' — the student has written on since the edit was made: diffing the
               edit against the current answer would strike out every new word
               as if the teacher crossed it out, so the markup is shown as a
               frozen earlier version instead. */
function editStateOf(text, editText, editBase) {
  if (editText == null || editText === text) return 'none'
  if (editBase != null && editBase !== text) return 'stale'
  return 'fresh'
}

/* Student's answer, read-only, with commented ranges highlighted. Selecting
   text inside it offers to attach a comment to that selection. */
function ReviewAnswer({ minHeight, text, editText, editBase, comments, onAnchor, activeId, onActivate, onEdit, registerRef }) {
  const ref = useRef(null)
  const taRef = useRef(null)
  const [sel, setSel] = useState(null)       // { start, end, quote, top }
  const [editing, setEditing] = useState(false)
  // Stale markup starts folded away; the toggle shows the frozen earlier version.
  const [showOld, setShowOld] = useState(false)
  // The student text this editing session started from — saved with every
  // keystroke of the edit, so the markup stays pinned to the version it marked
  // even if the student types while the editor is open.
  const baseRef = useRef(null)

  const editState = editStateOf(text, editText, editBase)
  const frozen = editState === 'stale' && showOld && !editing

  // The displayed text: the tracked-changes diff while the edit is fresh; the
  // student's own text once they have written past it (no false strikeouts);
  // or the frozen base-vs-edit diff when the teacher opens the earlier version.
  const segs = useMemo(() => {
    if (frozen) return diffWords(editBase, editText)
    if (editState !== 'fresh') return [{ t: 'eq', text }]
    return diffWords(text, editText)
  }, [frozen, editState, text, editText, editBase])

  const pickSelection = () => {
    // The frozen view shows an EARLIER version of the answer — offsets there
    // don't exist in the current text, so nothing can anchor to them.
    if (frozen) { setSel(null); return }
    const s = window.getSelection()
    if (!s || s.isCollapsed || !ref.current || !ref.current.contains(s.anchorNode)) { setSel(null); return }
    const range = s.getRangeAt(0)
    const pre = range.cloneRange()
    pre.selectNodeContents(ref.current)
    pre.setEnd(range.startContainer, range.startOffset)
    const dispStart = pre.toString().length
    const dispQuote = range.toString()
    if (!dispQuote.trim()) { setSel(null); return }
    // Displayed offsets → student-text offsets. Anything selected inside the
    // teacher's red insertions anchors to nothing and is dropped.
    const hit = displayedToSource(segs, dispStart, dispStart + dispQuote.length)
    if (!hit) { setSel(null); return }
    const quote = text.slice(hit.start, hit.end)
    if (!quote.trim()) { setSel(null); return }
    const box = ref.current.getBoundingClientRect()
    const r = range.getBoundingClientRect()
    // The button this positions sits INSIDE the (possibly zoomed) spread, so
    // its px are scaled on the way back out — divide the visual delta by the
    // effective zoom (visual width / layout width) to land where measured.
    const z = box.width / (ref.current.offsetWidth || 1) || 1
    setSel({ ...hit, quote, top: (r.top - box.top) / z })
  }

  const marks = useMemo(() => comments
    .filter(c => Number.isFinite(c.range_start) && Number.isFinite(c.range_end))
    .map(c => ({ start: c.range_start, end: c.range_end, id: c.id,
      cls: `bk-hl${c.resolved ? ' bk-hl-res' : ''}${activeId === c.id ? ' bk-hl-on' : ''}` })), [comments, activeId])

  const grow = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`
  }
  useEffect(() => { if (editing) { grow(); taRef.current?.focus({ preventScroll: true }) } })

  if (editing) return (
    <div className="bk-answer-live" style={{ position: 'relative' }}>
      <div className="bk-edit-tools">
        <button className="bk-tool bk-tool-on" onClick={() => setEditing(false)}>Done</button>
      </div>
      <textarea ref={taRef} className="bk-answer-input bk-edit-ta" style={{ minHeight }}
        value={editText ?? text} placeholder="Rewrite the answer…"
        onChange={(e) => { onEdit(e.target.value, baseRef.current ?? text); grow() }} />
    </div>
  )

  const openEditor = () => {
    baseRef.current = text
    // Markup made against an older answer can't be extended meaningfully —
    // start the re-mark from what the student has actually written now.
    if (editState === 'stale') onEdit(text, text)
    setShowOld(false)
    setEditing(true)
  }

  return (
    <div className="bk-answer-live" style={{ position: 'relative' }}>
      <div className="bk-edit-tools">
        {editState === 'stale' && (
          <button className="bk-tool" onClick={() => setShowOld(v => !v)}
            title="The student has written more since this markup was made">
            {showOld ? 'Current answer' : 'Marked version'}
          </button>
        )}
        <button className="bk-tool" title="Edit the student’s answer — deletions are struck through, your words show in red"
          onClick={openEditor}>✏️ Edit</button>
      </div>
      {editState === 'stale' && (
        <div className="bk-edit-stale">
          {showOld
            ? 'The version you marked — the student has written more since.'
            : 'Marked on an earlier version — the student has written more since.'}
        </div>
      )}
      <div
        ref={(el) => { ref.current = el; registerRef?.(el) }}
        className="bk-answer-input bk-answer-ro"
        style={{ minHeight }}
        onMouseUp={pickSelection}
        onKeyUp={pickSelection}
      >
        {text || editText
          ? renderSegs(segs, frozen ? [] : marks, onActivate)
          : <span className="bk-answer-empty">Not answered yet</span>}
      </div>
      {sel && (
        <button
          className="bk-comment-add"
          style={{ top: Math.max(0, sel.top - 6) }}
          onMouseDown={(e) => { e.preventDefault(); onAnchor(sel); setSel(null); window.getSelection()?.removeAllRanges() }}
        >💬 Comment</button>
      )}
    </div>
  )
}

/* Split a string at the ranges some notes point at. */
function paintText(text, marks) {
  if (!marks.length) return [{ text }]
  const out = []
  let at = 0
  for (const m of [...marks].sort((a, b) => a.start - b.start)) {
    const s = Math.max(at, Math.min(m.start, text.length))
    const e = Math.max(s, Math.min(m.end, text.length))
    if (s > at) out.push({ text: text.slice(at, s) })
    out.push({ text: text.slice(s, e), mark: m })
    at = e
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out
}

/* A textarea can't hold a <mark>, so the highlights are painted on a backdrop
   sitting exactly under it: same font, same padding, same wrapping, its own
   text invisible. The textarea on top is transparent, so what shows through is
   the highlight behind the student's real, editable text. */
function OwnAnswer({ minHeight, value, editText, editBase, marks = [], onChange, onSelect, registerRef }) {
  const ref = useRef(null)
  const [editing, setEditing] = useState(false)
  // Stale teacher markup is folded away behind a chip rather than diffed
  // against text it never marked.
  const [showOld, setShowOld] = useState(false)
  const grow = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`
  }, [minHeight])
  useEffect(() => { grow() }, [grow, value, editing])
  useEffect(() => { if (editing) ref.current?.focus({ preventScroll: true }) }, [editing])
  // A teacher-marked answer opens on the marked-up view — the student's words
  // with deletions struck through and the teacher's in red — but only while the
  // answer still matches the version the teacher marked. Once the student
  // writes past it the markup goes stale: diffing it against the new text
  // would strike out every word they just typed as if the teacher had crossed
  // it out. A stale edit folds away behind "Teacher's markup (earlier
  // version)" and the student types on a perfectly normal answer box.
  const editState = editStateOf(value, editText, editBase)
  if (editState === 'fresh' && !editing) {
    const segs = diffWords(value, editText)
    return (
      <div className="bk-answer-live" style={{ position: 'relative' }}>
        <div className="bk-edit-tools">
          <button className="bk-tool" title="Keep writing — your teacher’s markup stays alongside"
            onClick={() => setEditing(true)}>✏️ Edit</button>
        </div>
        <div ref={registerRef} className="bk-answer-input bk-answer-ro" style={{ minHeight }}>
          {renderSegs(segs, marks.map(m => ({ ...m, cls: `bk-note-hl${m.stale ? ' bk-note-hl-stale' : ''}${m.active ? ' bk-note-hl-on' : ''}`, id: m.id })), m => m?.onClick?.())}
        </div>
      </div>
    )
  }
  // The frozen earlier version: what the answer said when the teacher marked
  // it, with their tracked changes — read-only, clearly labelled, and the
  // current answer is one tap away.
  if (editState === 'stale' && showOld && !editing) {
    const segs = diffWords(editBase, editText)
    return (
      <div className="bk-answer-live" style={{ position: 'relative' }}>
        <div className="bk-edit-tools">
          <button className="bk-tool bk-tool-on" onClick={() => setShowOld(false)}>Back to my answer</button>
        </div>
        <div className="bk-edit-stale">Your teacher marked an earlier version of this answer.</div>
        <div ref={registerRef} className="bk-answer-input bk-answer-ro" style={{ minHeight }}>
          {renderSegs(segs, [], null)}
        </div>
      </div>
    )
  }
  return (
    <div className="bk-answer-live bk-answer-stack">
      {editState === 'fresh' && (
        <div className="bk-edit-tools">
          <button className="bk-tool bk-tool-on" onClick={() => setEditing(false)}>Done</button>
        </div>
      )}
      {editState === 'stale' && (
        <div className="bk-edit-tools">
          <button className="bk-tool" onClick={() => setShowOld(true)}
            title="See the version your teacher marked">Teacher’s markup (earlier version)</button>
        </div>
      )}
      <div className="bk-answer-input bk-answer-back" aria-hidden="true" style={{ minHeight }}>
        {paintText(value, marks).map((p, i) => (p.mark
          ? <mark key={i} className={`bk-note-hl${p.mark.stale ? ' bk-note-hl-stale' : ''}${p.mark.active ? ' bk-note-hl-on' : ''}`}>{p.text}</mark>
          : <span key={i}>{p.text}</span>))}
      </div>
      <textarea
        ref={(el) => { ref.current = el; registerRef?.(el) }}
        className="bk-answer-input bk-answer-front" style={{ minHeight }}
        value={value} placeholder="Type your answer…"
        onChange={(e) => { onChange(e.target.value); grow() }}
        onMouseUp={(e) => onSelect?.(e.target)}
        onKeyUp={(e) => onSelect?.(e.target)}
      />
    </div>
  )
}

export default function WorkbookDoc({
  booklet, blocks, classId, ownerId,
  mode = 'own',                 // 'solutions' | 'own' | 'review' | 'model'
  commentStudentId = null,
  staffId = null,
}) {
  const solutions = mode === 'solutions'
  // The teacher's class workbook: the student-facing layout, typeable, with
  // everything typed broadcast to the whole class ("Teacher's working").
  const isModel = mode === 'model'
  const [answers, setAnswers] = useState({})
  const [comments, setComments] = useState([])
  const [loaded, setLoaded] = useState(solutions)
  const [unsaved, setUnsaved] = useState(0)
  const [failing, setFailing] = useState(false)
  const [pages, setPages] = useState(null)
  // Page navigator: which page the reader is on, and whether the jump list is open.
  const [curPage, setCurPage] = useState(0)
  const [jumpOpen, setJumpOpen] = useState(false)
  const navRef = useRef(null)
  /* Booklet view: two consecutive pages side by side, like an open book — a
     lot of the work is "read the text on one page, answer on the next", and a
     spread saves the scrolling back and forth. Off by default; the choice
     sticks per browser. Scaling is CSS zoom, which reflows — pagination still
     measures at full size, so pages break exactly where print does.

     Zoom is Docs-style: "Fit" scales to the container (the default), or the
     reader types/steps a percentage, which sticks per browser too. Fit
     measures the actual scroll box, NOT the window — staff pages carry a
     sidebar, and measuring the window over-sized the spread so its left edge
     was cut off. If a manual zoom does overflow, min-width on the outer row
     grows to match (computed below), so the overflow is scrollable instead of
     centre-clipped. */
  const [spread, setSpread] = useState(false)
  const [zoomPct, setZoomPct] = useState('fit')  // 'fit' | percent number
  const [fitZoom, setFitZoom] = useState(1)
  const [zoomField, setZoomField] = useState(null)  // input text while editing
  const zoom = zoomPct === 'fit' ? fitZoom : Math.max(0.4, Math.min(2, zoomPct / 100))
  useEffect(() => {
    let savedSpread = false, savedZoom = null
    try {
      savedSpread = localStorage.getItem('wb:spread') === '1'
      savedZoom = localStorage.getItem('wb:zoom')
    } catch { /* no store */ }
    if (!savedSpread && !savedZoom) return undefined
    const raf = requestAnimationFrame(() => {
      if (savedSpread) setSpread(true)
      if (savedZoom && savedZoom !== 'fit') {
        const n = parseInt(savedZoom, 10)
        if (Number.isFinite(n)) setZoomPct(Math.max(40, Math.min(200, n)))
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  const toggleSpread = useCallback(() => {
    setSpread(s => {
      try { localStorage.setItem('wb:spread', s ? '0' : '1') } catch { /* no store */ }
      return !s
    })
  }, [])
  const setZoom = useCallback((v) => {
    setZoomPct(v)
    try { localStorage.setItem('wb:zoom', String(v)) } catch { /* no store */ }
  }, [])
  const bumpZoom = (d) => setZoom(Math.max(40, Math.min(200, Math.round(zoom * 10) * 10 + d)))
  const commitZoom = () => {
    if (zoomField === null) return
    const n = parseInt(zoomField, 10)
    setZoomField(null)
    if (Number.isFinite(n)) setZoom(Math.max(40, Math.min(200, n)))
  }
  // Fit factor for the current view, tracked against the scroll box's real
  // width (sidebars open and close; windows resize).
  useEffect(() => {
    const scrollEl = pagesRef.current?.closest('.bk-doc-scroll')
    if (!scrollEl) return undefined
    const calc = () => {
      const avail = scrollEl.clientWidth - GUTTER_W - 3 * 18 - 24
      const needed = spread ? PAGE_W * 2 + SPREAD_GAP : PAGE_W
      setFitZoom(Math.max(0.4, Math.min(1, avail / needed)))
    }
    const ro = new ResizeObserver(calc)
    ro.observe(scrollEl)
    const raf = requestAnimationFrame(calc)
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [spread])
  const [activeComment, setActiveComment] = useState(null)
  const [draft, setDraft] = useState(null)     // { key, slot, start, end, quote, body }
  // The student's own highlights. Private to them, so they are never loaded on
  // the teacher's tabs — `notes` simply stays empty there.
  const [notes, setNotes] = useState([])
  const [noteDraft, setNoteDraft] = useState(null)  // { target, blockId, partId, start, end, quote, body }
  const [activeNote, setActiveNote] = useState(null)
  const [selection, setSelection] = useState(null)  // live selection awaiting the Note button
  // Notes whose anchor no longer covers the words they were written about,
  // because the booklet was edited after the fact.
  const [staleNotes, setStaleNotes] = useState(() => new Set())
  // The teacher's marked-up versions of this student's answers, keyed like
  // `answers`. Loaded for both sides: the teacher edits them, the student
  // sees them rendered as tracked changes.
  const [edits, setEdits] = useState({})
  const [editingNote, setEditingNote] = useState(null)  // { id, body }
  // The teacher's class-wide annotations on the workbook text itself —
  // exemplar responses, glosses on a definition box. One set per class:
  // painted on every copy, students included, and kept live.
  const [classNotes, setClassNotes] = useState([])
  const [classDraft, setClassDraft] = useState(null)      // { blockId, start, end, quote, body }
  const [activeClassNote, setActiveClassNote] = useState(null)
  const [editingClassNote, setEditingClassNote] = useState(null)  // { id, body }
  // The teacher's class-wide model answers: typed on the Workbook tab, shown
  // read-only in green under each matching answer box on student copies.
  const [models, setModels] = useState({})
  const pendingRef = useRef({})     // slot key (t:<key> for teacher edits) → unsent payload
  const flushTimer = useRef(null)
  const retryAttempt = useRef(0)
  const boxRefs = useRef({})
  const markRefs = useRef({})
  const draftInputRef = useRef(null)
  const noteInputRef = useRef(null)
  const noteEditRef = useRef(null)
  const pagesRef = useRef(null)
  const gutterRef = useRef(null)
  const classDraftRef = useRef(null)
  const classEditRef = useRef(null)
  const canNote = mode === 'own'
  // Staff annotate the workbook text for the whole class from their teaching
  // tabs. The solutions copy is a pure reference: nothing is authored there.
  const canAnnotate = !!staffId && (isModel || mode === 'review')

  const meta = useMemo(() => ({
    subject: booklet?.subject, year: booklet?.year, topic: booklet?.topic,
    name: booklet?.booklet_name, delivery: 'online',
  }), [booklet])

  const items = useMemo(() => bookletRenderItems(blocks || [], { solutions, meta }), [blocks, solutions, meta])
  const slots = useMemo(() => answerSlots(blocks || []), [blocks])
  const keyOf = (s) => `${s.blockId}::${s.partId}`

  // ── paginate exactly as the builder/exporter do ───────────────────────────
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (!items.length) { setPages([]); return }
      const stage = document.createElement('div')
      stage.className = 'bk-root'
      stage.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1;visibility:hidden'
      const style = document.createElement('style')
      style.textContent = BOOKLET_CSS
      stage.appendChild(style)
      document.body.appendChild(stage)

      const newPage = () => {
        const page = document.createElement('article')
        page.className = 'bk-page'
        const inner = document.createElement('div')
        inner.className = 'bk-content'
        page.appendChild(inner); stage.appendChild(page)
        return { page, inner, html: [] }
      }
      const result = []
      let cur = newPage(); result.push(cur)
      let count = 0
      const placeChunks = (it) => {
        for (const ch of it.chunks) {
          const t = document.createElement('div'); t.innerHTML = ch
          const el = t.firstElementChild; if (!el) continue
          if (el.getAttribute('data-break') === '1' && count > 0) { cur = newPage(); result.push(cur); count = 0 }
          cur.inner.appendChild(el)
          if (cur.page.scrollHeight > PAGE_H && count > 0) {
            cur.inner.removeChild(el); cur = newPage(); result.push(cur); cur.inner.appendChild(el); count = 0
          }
          cur.html.push(ch); count++
        }
      }
      for (const it of items) {
        const t = document.createElement('div'); t.innerHTML = it.html
        const el = t.firstElementChild; if (!el) continue
        if (it.pageBreakBefore && count > 0) { cur = newPage(); result.push(cur); count = 0 }
        if (it.forceChunks && it.chunks) { placeChunks(it); continue }
        cur.inner.appendChild(el)
        if (cur.page.scrollHeight > PAGE_H && count > 0) {
          cur.inner.removeChild(el); cur = newPage(); result.push(cur); cur.inner.appendChild(el); count = 0
        }
        if (cur.page.scrollHeight > PAGE_H) {
          if (it.chunks) { cur.inner.removeChild(el); placeChunks(it); continue }
          const fits = () => cur.page.scrollHeight <= PAGE_H
          let rest = splitToFit(el, fits)
          cur.html.push(el.outerHTML); count++
          let guard = 0
          while (rest && guard++ < 200) {
            cur = newPage(); result.push(cur); count = 0
            cur.inner.appendChild(rest)
            const more = splitToFit(rest, fits)
            cur.html.push(rest.outerHTML); count++
            if (more === rest) break
            rest = more
          }
          continue
        }
        cur.html.push(it.html); count++
      }
      document.body.removeChild(stage)
      setPages(result.map(p => p.html))
    })
    return () => cancelAnimationFrame(raf)
  }, [items])

  // ── page navigator ────────────────────────────────────────────────────────
  // A workbook runs to twenty-odd pages, so scrolling to "the homework" or
  // "question 7" is a chore. Each page gets the heading it sits under, taken
  // from the same html the page is built from, and the reader can jump.
  // Pages are only in the DOM once this is true — until then the doc shows
  // "Loading…" and there is nothing to observe or scroll to.
  const ready = pages !== null && (solutions || loaded)

  // The rendered pages, read straight from the container that holds them.
  const pageNodes = useCallback(
    () => Array.from(pagesRef.current?.querySelectorAll('.bk-doc-page') || []), [])

  const pageLabels = useMemo(() => {
    if (!pages) return []
    const HEADS = [
      [/class="[^"]*bk-quiz-head/, () => 'Revision Quiz'],
      [/class="[^"]*bk-section-hw/, () => 'Homework'],
      [/class="bk-block bk-section-wrap"[\s\S]*?class="bk-section-title">([\s\S]*?)<\/span>/, (m) => m[1]],
      [/class="bk-block bk-subtopic">([\s\S]*?)<\/div>/, (m) => m[1]],
    ]
    const strip = (h) => String(h).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim()
    let carried = ''
    return pages.map((chunks) => {
      const html = chunks.join('')
      for (const [re, pick] of HEADS) {
        const m = html.match(re)
        if (m) { carried = strip(pick(m)); break }
      }
      return carried
    })
  }, [pages])

  // Which page is the reader on? The last one whose top has passed a reading
  // line just below the sticky header. Measured from the scroll position
  // rather than an observer band: a band has to be sized as a share of the
  // viewport, which collapses to nothing on a short window, whereas this is
  // correct at any height.
  //
  // `ready` matters — the pages enter the DOM only when it flips, which on a
  // student's copy happens AFTER their answers load. Watching `pages` alone
  // measured an empty document and never looked again, so the pill sat on
  // page 1 for the whole workbook.
  useEffect(() => {
    if (!ready) return undefined
    const nodes = pageNodes()
    if (!nodes.length) return undefined
    let frame = 0
    const measure = () => {
      frame = 0
      const line = 140
      let best = 0
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].getBoundingClientRect().top > line) break
        best = i
      }
      // In the spread, both pages of a pair share a top — report the left one.
      setCurPage(spread ? best - (best % 2) : best)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    // The workbook scrolls with the window on most screens, but its <main>
    // wrapper carries overflow (which makes it a scroll box of its own), so
    // every scrollable ancestor is listened to as well.
    const targets = [window]
    for (let el = pagesRef.current?.parentElement; el; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY
      if (oy === 'auto' || oy === 'scroll') targets.push(el)
    }
    targets.forEach(t => t.addEventListener('scroll', onScroll, { passive: true }))
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      targets.forEach(t => t.removeEventListener('scroll', onScroll))
      window.removeEventListener('resize', onScroll)
    }
  }, [pages, ready, pageNodes, spread])

  // Dismiss the jump list on an outside click or Escape. Not on mouse-leave:
  // the pointer can clip the corner of the pill on its way to an item, and a
  // touch device never fires it at all.
  useEffect(() => {
    if (!jumpOpen) return undefined
    const onDown = (e) => { if (!navRef.current?.contains(e.target)) setJumpOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setJumpOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [jumpOpen])

  // scrollIntoView would tuck the page top under the sticky header, so the
  // offset is applied by hand — to whichever box actually scrolls.
  const goToPage = useCallback((i) => {
    const el = pageNodes()[i]
    if (!el) return
    setJumpOpen(false)
    let box = null
    for (let a = el.parentElement; a; a = a.parentElement) {
      const oy = getComputedStyle(a).overflowY
      if ((oy === 'auto' || oy === 'scroll') && a.scrollHeight > a.clientHeight + 2) { box = a; break }
    }
    if (box) {
      box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 12,
        behavior: 'smooth' })
    } else {
      window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 74, behavior: 'smooth' })
    }
  }, [pageNodes])

  /* ── saving, with a safety net ──────────────────────────────────────────
     Every keystroke lands in a pending queue keyed by answer slot (teacher
     edits under t:<key>), is mirrored to localStorage, and flushes after a
     short debounce. A failed flush KEEPS the entry queued, says so in the
     status line, and retries on an exponential backoff — plus immediately
     when the browser comes back online. The mirror survives a closed tab:
     reopening the page restores anything that never reached the server.
     Without this, a dropped wifi or an expired session would sit under
     "All changes saved" while nothing landed. */
  const draftStoreKey = `wbdraft:${booklet.id}:${classId}:${ownerId}`
  const mirror = useCallback(() => {
    try {
      const pnd = pendingRef.current
      if (Object.keys(pnd).length) localStorage.setItem(draftStoreKey, JSON.stringify(pnd))
      else localStorage.removeItem(draftStoreKey)
    } catch { /* storage blocked or full — the retry queue still holds the text */ }
  }, [draftStoreKey])

  const flushRef = useRef(null)
  const flush = useCallback(async () => {
    clearTimeout(flushTimer.current)
    const entries = Object.entries(pendingRef.current)
    if (!entries.length) { setUnsaved(0); setFailing(false); return }
    let anyFail = false
    await Promise.all(entries.map(async ([pk, e]) => {
      const { error } = e.model
        ? await supabase.from('workbook_model_answers').upsert({
            booklet_id: booklet.id, class_id: classId, block_id: e.blockId, part_id: e.partId,
            body: e.body, author_id: staffId, updated_at: new Date().toISOString(),
          }, { onConflict: 'booklet_id,class_id,block_id,part_id' })
        : await supabase.from('workbook_answers').upsert({
            booklet_id: booklet.id, class_id: classId, owner_id: ownerId, is_teacher: !!e.isTeacher,
            block_id: e.blockId, part_id: e.partId, body: e.body,
            base_body: e.isTeacher ? (e.base ?? null) : null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'booklet_id,class_id,owner_id,block_id,part_id,is_teacher' })
      if (error) { anyFail = true; return }
      // Clear the slot only if nothing newer was typed while this was in flight.
      if (pendingRef.current[pk] === e) delete pendingRef.current[pk]
    }))
    mirror()
    const left = Object.keys(pendingRef.current).length
    setUnsaved(left)
    setFailing(anyFail)
    if (!anyFail) retryAttempt.current = 0
    if (left) {
      const delay = anyFail ? Math.min(30000, 2000 * 2 ** retryAttempt.current++) : SAVE_DELAY
      flushTimer.current = setTimeout(() => flushRef.current?.(), delay)
    }
  }, [booklet.id, classId, ownerId, staffId, mirror])
  useEffect(() => { flushRef.current = flush }, [flush])

  const queueSave = useCallback((k, blockId, partId, isTeacher, body, base) => {
    pendingRef.current[isTeacher ? `t:${k}` : k] = { blockId, partId, isTeacher, body, ...(isTeacher ? { base: base ?? null } : {}) }
    mirror()
    setUnsaved(Object.keys(pendingRef.current).length)
    clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(flush, SAVE_DELAY)
  }, [flush, mirror])

  const saveAnswer = useCallback((k, blockId, partId, body) => queueSave(k, blockId, partId, false, body), [queueSave])
  // The class model answer — same debounced pipeline, its own table.
  const saveModel = useCallback((k, blockId, partId, body) => {
    pendingRef.current[`m:${k}`] = { blockId, partId, model: true, body }
    mirror()
    setUnsaved(Object.keys(pendingRef.current).length)
    clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(flush, SAVE_DELAY)
  }, [flush, mirror])
  // The teacher's tracked-changes copy: same table, is_teacher = true. `base`
  // is the student text the markup was written against — rendering shows the
  // tracked changes only while the answer still matches it.
  const saveEdit = useCallback((k, blockId, partId, body, base) => queueSave(k, blockId, partId, true, body, base), [queueSave])

  // Leaving with unsent text gets the browser's are-you-sure prompt, and
  // coming back online flushes straight away instead of waiting out a backoff.
  useEffect(() => {
    const warn = (e) => { if (Object.keys(pendingRef.current).length) { e.preventDefault(); e.returnValue = '' } }
    const onUp = () => flush()
    window.addEventListener('beforeunload', warn)
    window.addEventListener('online', onUp)
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('online', onUp) }
  }, [flush])



  // ── load answers + comments ───────────────────────────────────────────────
  useEffect(() => {
    if (solutions) return
    let alive = true
    ;(async () => {
      // The teacher's Workbook tab only needs the class model answers — no
      // per-student rows, no comments, no personal notes.
      if (isModel) {
        const m = await supabase.from('workbook_model_answers')
          .select('block_id, part_id, body')
          .eq('booklet_id', booklet.id).eq('class_id', classId)
        const mmap = {}
        for (const r of m.data || []) mmap[`${r.block_id}::${r.part_id}`] = r.body
        try {
          const raw = localStorage.getItem(`wbdraft:${booklet.id}:${classId}:${ownerId}`)
          if (raw) {
            let restored = 0
            for (const [pk, e] of Object.entries(JSON.parse(raw))) {
              if (!e.model) continue
              const k = pk.replace(/^m:/, '')
              if ((mmap[k] ?? '') !== e.body) { mmap[k] = e.body; pendingRef.current[pk] = e; restored++ }
            }
            if (restored) { setUnsaved(restored); flushTimer.current = setTimeout(flush, 1500) }
          }
        } catch { /* unreadable mirror — server state stands */ }
        if (!alive) return
        setModels(mmap); setLoaded(true)
        return
      }
      const a = await supabase.from('workbook_answers')
        .select('block_id, part_id, body, base_body, is_teacher')
        .eq('booklet_id', booklet.id).eq('class_id', classId).eq('owner_id', ownerId)
      const map = {}, emap = {}
      for (const r of a.data || []) {
        const k = `${r.block_id}::${r.part_id}`
        if (r.is_teacher) emap[k] = { text: r.body, base: r.base_body ?? null }
        else map[k] = r.body
      }
      let cs = []
      if (commentStudentId) {
        const c = await supabase.from('workbook_comments')
          .select('*').eq('booklet_id', booklet.id).eq('class_id', classId).eq('student_id', commentStudentId)
          .order('created_at')
        cs = c.data || []
      }
      let ns = []
      if (canNote) {
        const n = await supabase.from('workbook_notes')
          .select('*').eq('booklet_id', booklet.id).eq('class_id', classId).eq('owner_id', ownerId)
          .order('created_at')
        ns = n.data || []
      }
      // The teacher's live working, shown in green under the matching boxes.
      let mmap = {}
      if (mode === 'own' || mode === 'review') {
        const m = await supabase.from('workbook_model_answers')
          .select('block_id, part_id, body')
          .eq('booklet_id', booklet.id).eq('class_id', classId)
        for (const r of m.data || []) mmap[`${r.block_id}::${r.part_id}`] = r.body
      }
      // Anything a previous session never got to the server (tab closed during
      // an outage) comes back from the localStorage mirror and re-queues.
      try {
        const raw = localStorage.getItem(`wbdraft:${booklet.id}:${classId}:${ownerId}`)
        if (raw) {
          let restored = 0
          for (const [pk, e] of Object.entries(JSON.parse(raw))) {
            const k = pk.replace(/^t:/, '')
            if (e.isTeacher) {
              if ((emap[k]?.text ?? '') !== e.body) {
                emap[k] = { text: e.body, base: e.base ?? emap[k]?.base ?? null }
                pendingRef.current[pk] = e; restored++
              }
            } else if ((map[k] ?? '') !== e.body) {
              map[k] = e.body; pendingRef.current[pk] = e; restored++
            }
          }
          if (restored) { setUnsaved(restored); flushTimer.current = setTimeout(flush, 1500) }
          else localStorage.removeItem(`wbdraft:${booklet.id}:${classId}:${ownerId}`)
        }
      } catch { /* unreadable mirror — server state stands */ }
      if (!alive) return
      setAnswers(map); setEdits(emap); setComments(cs); setNotes(ns); setModels(mmap); setLoaded(true)
    })()
    return () => { alive = false }
  }, [solutions, isModel, mode, booklet.id, classId, ownerId, commentStudentId, canNote, flush])

  /* Pull current server state on demand — the safety net around realtime.
     A postgres_changes channel can die without ever reporting an error: the
     websocket drops while the tab is backgrounded (iPads are aggressive about
     this), or the JWT it was opened with expires mid-lesson. Either way the
     page keeps saying SUBSCRIBED locally while receiving nothing, and the only
     cure used to be a hard refresh. So the channel is treated as a fast path
     only; correctness comes from refetching whenever the tab wakes up, the
     channel (re)joins, and on a slow heartbeat. Unsent local keystrokes
     (pendingRef) always win over whatever the server returns. */
  const lastRefreshRef = useRef(0)
  const refresh = useCallback(async (force = false) => {
    if (solutions) return
    const now = Date.now()
    if (!force && now - lastRefreshRef.current < 2500) return
    lastRefreshRef.current = now
    const overlayModels = (rows) => {
      const mmap = {}
      for (const r of rows || []) mmap[`${r.block_id}::${r.part_id}`] = r.body
      for (const [pk, e] of Object.entries(pendingRef.current)) {
        if (e.model) mmap[pk.replace(/^m:/, '')] = e.body
      }
      setModels(prev => (JSON.stringify(prev) === JSON.stringify(mmap) ? prev : mmap))
    }
    supabase.from('workbook_class_notes').select('*')
      .eq('booklet_id', booklet.id).eq('class_id', classId).order('created_at')
      .then(r => { if (r.data) setClassNotes(prev => (JSON.stringify(prev) === JSON.stringify(r.data) ? prev : r.data)) })
    if (isModel) {
      const m = await supabase.from('workbook_model_answers')
        .select('block_id, part_id, body')
        .eq('booklet_id', booklet.id).eq('class_id', classId)
      if (m.data) overlayModels(m.data)
      return
    }
    const [a, c, n, m] = await Promise.all([
      supabase.from('workbook_answers')
        .select('block_id, part_id, body, base_body, is_teacher')
        .eq('booklet_id', booklet.id).eq('class_id', classId).eq('owner_id', ownerId),
      commentStudentId
        ? supabase.from('workbook_comments')
            .select('*').eq('booklet_id', booklet.id).eq('class_id', classId)
            .eq('student_id', commentStudentId).order('created_at')
        : Promise.resolve({ data: null }),
      canNote
        ? supabase.from('workbook_notes')
            .select('*').eq('booklet_id', booklet.id).eq('class_id', classId)
            .eq('owner_id', ownerId).order('created_at')
        : Promise.resolve({ data: null }),
      (mode === 'own' || mode === 'review')
        ? supabase.from('workbook_model_answers')
            .select('block_id, part_id, body')
            .eq('booklet_id', booklet.id).eq('class_id', classId)
        : Promise.resolve({ data: null }),
    ])
    if (a.data) {
      const map = {}, emap = {}
      for (const r of a.data) {
        const k = `${r.block_id}::${r.part_id}`
        if (r.is_teacher) emap[k] = { text: r.body, base: r.base_body ?? null }
        else map[k] = r.body
      }
      for (const [pk, e] of Object.entries(pendingRef.current)) {
        if (e.model) continue
        const k = pk.replace(/^t:/, '')
        if (e.isTeacher) emap[k] = { text: e.body, base: e.base ?? emap[k]?.base ?? null }
        else map[k] = e.body
      }
      setAnswers(prev => (JSON.stringify(prev) === JSON.stringify(map) ? prev : map))
      setEdits(prev => (JSON.stringify(prev) === JSON.stringify(emap) ? prev : emap))
    }
    if (c.data) setComments(prev => (JSON.stringify(prev) === JSON.stringify(c.data) ? prev : c.data))
    if (n.data) setNotes(prev => (JSON.stringify(prev) === JSON.stringify(n.data) ? prev : n.data))
    if (m.data) overlayModels(m.data)
  }, [solutions, isModel, mode, booklet.id, classId, ownerId, commentStudentId, canNote])

  // Wake-up + heartbeat: refetch when the tab comes back to the front (that's
  // when a dead socket is most likely) and every 30 s while visible, so a
  // silently broken channel converges within seconds instead of never.
  useEffect(() => {
    if (solutions) return undefined
    const onWake = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('online', onWake)
    const beat = setInterval(onWake, 30000)
    return () => {
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('online', onWake)
      clearInterval(beat)
    }
  }, [solutions, refresh])

  // ── live refresh ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (solutions) return undefined
    let joined = false
    const ch = supabase.channel(`wb:${booklet.id}:${classId}:${ownerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workbook_answers', filter: `owner_id=eq.${ownerId}` }, (p) => {
        const r = p.new
        if (!r || r.booklet_id !== booklet.id || String(r.class_id) !== String(classId)) return
        const k = `${r.block_id}::${r.part_id}`
        const tk = r.is_teacher ? `t:${k}` : k
        if (pendingRef.current[tk]) return
        if (r.is_teacher) {
          setEdits(m => (m[k]?.text === r.body && (m[k]?.base ?? null) === (r.base_body ?? null)
            ? m : { ...m, [k]: { text: r.body, base: r.base_body ?? null } }))
        } else {
          setAnswers(m => (m[k] === r.body ? m : { ...m, [k]: r.body }))
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workbook_comments', filter: `student_id=eq.${commentStudentId || ownerId}` }, async () => {
        const c = await supabase.from('workbook_comments')
          .select('*').eq('booklet_id', booklet.id).eq('class_id', classId)
          .eq('student_id', commentStudentId || ownerId).order('created_at')
        setComments(c.data || [])
      })
      .subscribe((status) => {
        // A re-join after a dropped socket means events were missed while the
        // channel was down — pull the gap. The first join is skipped: the
        // initial-load effect has just fetched everything.
        if (status === 'SUBSCRIBED') { if (joined) refresh(true); joined = true }
      })
    return () => { supabase.removeChannel(ch) }
  }, [solutions, booklet.id, classId, ownerId, commentStudentId, refresh])

  useEffect(() => () => clearTimeout(flushTimer.current), [])

  // ── class-wide annotations: load + live ───────────────────────────────────
  // Runs in every mode, the solutions tab included — this is the teacher's
  // broadcast channel, so every open copy follows the same rows.
  useEffect(() => {
    let alive = true
    const load = async () => {
      const r = await supabase.from('workbook_class_notes').select('*')
        .eq('booklet_id', booklet.id).eq('class_id', classId).order('created_at')
      if (alive && r.data) setClassNotes(r.data)
    }
    load()
    const loadModels = async () => {
      const m = await supabase.from('workbook_model_answers')
        .select('block_id, part_id, body')
        .eq('booklet_id', booklet.id).eq('class_id', classId)
      if (!alive || !m.data) return
      const mmap = {}
      for (const r of m.data) mmap[`${r.block_id}::${r.part_id}`] = r.body
      setModels(prev => {
        // The teacher's own unsent keystrokes win over an echo of an older save.
        for (const [pk, e] of Object.entries(pendingRef.current)) {
          if (e.model) mmap[pk.replace(/^m:/, '')] = e.body
        }
        return JSON.stringify(prev) === JSON.stringify(mmap) ? prev : mmap
      })
    }
    let joined = false
    const ch = supabase.channel(`wbclass:${booklet.id}:${classId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workbook_class_notes', filter: `class_id=eq.${classId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workbook_model_answers', filter: `class_id=eq.${classId}` }, loadModels)
      .subscribe((status) => {
        // Catch up after a reconnect (first join already loaded above).
        if (status === 'SUBSCRIBED') { if (joined) { load(); loadModels() } joined = true }
      })
    return () => { alive = false; supabase.removeChannel(ch) }
  }, [booklet.id, classId])

  const addComment = async () => {
    if (!draft?.body.trim()) { setDraft(null); return }
    const { data } = await supabase.from('workbook_comments').insert({
      booklet_id: booklet.id, class_id: classId, student_id: commentStudentId,
      block_id: draft.slot.blockId, part_id: draft.slot.partId,
      body: draft.body.trim(), quote: draft.quote,
      range_start: draft.start, range_end: draft.end, author_id: staffId,
    }).select('*').single()
    if (data) setComments(cs => [...cs, data])
    setDraft(null)
  }
  const removeComment = async (id) => {
    await supabase.from('workbook_comments').delete().eq('id', id)
    setComments(cs => cs.filter(c => c.id !== id))
  }
  // Ticking a comment off (or reopening it). Students go through an RPC that
  // can flip only this one field — they have no update rights on the row.
  const toggleResolved = async (c) => {
    const next = !c.resolved
    setComments(cs => cs.map(x => (x.id === c.id ? { ...x, resolved: next } : x)))
    const { error } = await supabase.rpc('resolve_comment', { p_id: c.id, p_resolved: next })
    if (error) setComments(cs => cs.map(x => (x.id === c.id ? { ...x, resolved: !next } : x)))
  }

  // ── the student's own highlights ──────────────────────────────────────────

  /* Anything the student selects on the page can be highlighted. Text in the
     workbook itself is anchored by block; text they typed is anchored by
     answer slot, where the textarea already knows the exact offsets. */
  const onPageSelect = useCallback((e) => {
    if (!canNote && !canAnnotate) return
    // Answer fields handle their own selection, and this listener sits on their
    // ancestor — without this guard the bubbling mouseup would clear the
    // selection the textarea just reported.
    if (e?.target?.closest?.('.bk-answer-live')) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) { setSelection(null); return }
    const range = sel.getRangeAt(0)
    const host = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)
      ?.closest('[data-bid]')
    if (!host || !pagesRef.current?.contains(host)) { setSelection(null); return }
    const blockId = host.dataset.bid
    const hit = rangeToOffsets(blockElements(pagesRef.current, blockId), range)
    if (!hit) { setSelection(null); return }
    const r = range.getBoundingClientRect()
    const pbox = pagesRef.current.getBoundingClientRect()
    // Note button renders inside the (possibly zoomed) spread — see AnswerArea.
    const z = pbox.width / (pagesRef.current.offsetWidth || 1) || 1
    setSelection({
      target: 'text', blockId, partId: '', ...hit,
      top: (r.top - (pbox.top || 0)) / z,
    })
  }, [canNote, canAnnotate])

  // A selection inside an answer box. Offsets come straight from the textarea,
  // so they need no DOM walking — and they match what a teacher comment stores.
  const onAnswerSelect = useCallback((slot, el) => {
    if (!canNote) return
    const { selectionStart: a, selectionEnd: b, value } = el
    if (a == null || b <= a || !value.slice(a, b).trim()) { setSelection(null); return }
    const r = el.getBoundingClientRect()
    const pbox = pagesRef.current?.getBoundingClientRect()
    const z = (pbox?.width || 0) / (pagesRef.current?.offsetWidth || 1) || 1
    setSelection({
      target: 'answer', blockId: slot.blockId, partId: slot.partId,
      start: a, end: b, quote: value.slice(a, b),
      top: (r.top - (pbox?.top || 0)) / z,
    })
  }, [canNote])

  const addNote = async () => {
    if (!noteDraft?.body.trim()) { setNoteDraft(null); return }
    const { data, error } = await supabase.from('workbook_notes').insert({
      booklet_id: booklet.id, class_id: classId, owner_id: ownerId,
      target: noteDraft.target, block_id: noteDraft.blockId, part_id: noteDraft.partId,
      quote: noteDraft.quote, range_start: noteDraft.start, range_end: noteDraft.end,
      body: noteDraft.body.trim(),
    }).select('*').single()
    if (!error && data) setNotes(ns => [...ns, data])
    setNoteDraft(null)
  }
  const removeNote = async (id) => {
    await supabase.from('workbook_notes').delete().eq('id', id)
    setNotes(ns => ns.filter(n => n.id !== id))
  }
  const saveNoteEdit = async () => {
    const body = editingNote?.body.trim()
    if (!body) { setEditingNote(null); return }
    await supabase.from('workbook_notes').update({ body, updated_at: new Date().toISOString() })
      .eq('id', editingNote.id)
    setNotes(ns => ns.map(x => (x.id === editingNote.id ? { ...x, body } : x)))
    setEditingNote(null)
  }

  // ── class-wide annotation CRUD (staff only — RLS enforces it too) ─────────
  const addClassNote = async () => {
    if (!classDraft?.body.trim()) { setClassDraft(null); return }
    const { data, error } = await supabase.from('workbook_class_notes').insert({
      booklet_id: booklet.id, class_id: classId, block_id: classDraft.blockId,
      quote: classDraft.quote, range_start: classDraft.start, range_end: classDraft.end,
      body: classDraft.body.trim(), author_id: staffId,
    }).select('*').single()
    if (!error && data) setClassNotes(ns => [...ns, data])
    setClassDraft(null)
  }
  const removeClassNote = async (id) => {
    await supabase.from('workbook_class_notes').delete().eq('id', id)
    setClassNotes(ns => ns.filter(n => n.id !== id))
  }
  const saveClassNoteEdit = async () => {
    const body = editingClassNote?.body.trim()
    if (!body) { setEditingClassNote(null); return }
    await supabase.from('workbook_class_notes').update({ body, updated_at: new Date().toISOString() })
      .eq('id', editingClassNote.id)
    setClassNotes(ns => ns.map(x => (x.id === editingClassNote.id ? { ...x, body } : x)))
    setEditingClassNote(null)
  }

  // A click on an MCQ option is that part's answer. Click it again to clear.
  // The options carry data-opt / data-pid straight from the renderer, so this
  // is plain event delegation — no per-option React component.
  const onPageClick = useCallback((e) => {
    if (mode !== 'own') return
    const opt = e.target.closest?.('[data-opt]')
    if (!opt) return
    const bid = opt.closest('[data-bid]')?.dataset.bid
    if (!bid) return
    const pid = opt.closest('.bk-opts')?.dataset.pid ?? ''
    const key = `${bid}::${pid}`
    // next is computed outside the updater: an updater must stay pure, and
    // StrictMode double-invokes it — a save scheduled inside would fire twice.
    const next = answers[key] === opt.dataset.opt ? '' : opt.dataset.opt
    setAnswers(m => ({ ...m, [key]: next }))
    saveAnswer(key, bid, pid, next)
  }, [mode, answers, saveAnswer])

  /* Paint the highlights into the rendered HTML after every render — no dep
     list, deliberately, so a highlight can never be lost to a render path we
     didn't anticipate. React owns these chunks through dangerouslySetInnerHTML;
     unpaint-then-repaint keeps the pass idempotent. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const root = pagesRef.current
    if (!root) return undefined
    // MCQ selections — the chosen option gets its pill on both the student's
    // copy and the teacher's review tab.
    if (!solutions) {
      root.querySelectorAll('.bk-opts[data-pid]').forEach(el => {
        const bid = el.closest('[data-bid]')?.dataset.bid
        const chosen = bid ? answers[`${bid}::${el.dataset.pid}`] : ''
        el.querySelectorAll('[data-opt]').forEach(o =>
          o.classList.toggle('bk-opt-sel', !!chosen && o.dataset.opt === chosen))
      })
    }
    // The teacher's class annotations paint in EVERY mode; the student's own
    // notes only on their copy. Both share one pass per block, so the
    // back-to-front offset rule below holds across the merged list.
    const byBlock = {}
    for (const n of classNotes) (byBlock[n.block_id] ||= []).push({ ...n, __class: true })
    if (canNote) {
      for (const n of notes) if (n.target === 'text') (byBlock[n.block_id] ||= []).push(n)
      if (noteDraft?.target === 'text') (byBlock[noteDraft.blockId] ||= []).push({
        ...noteDraft, range_start: noteDraft.start, range_end: noteDraft.end, id: '__draft' })
      // The live selection too: React rewrites these chunks' innerHTML on every
      // re-render, which collapses the browser's own selection the instant the
      // Note button appears. Painting the pending range here keeps the student's
      // highlight visibly stuck to the words until they note it or click away.
      else if (selection?.target === 'text') (byBlock[selection.blockId] ||= []).push({
        ...selection, range_start: selection.start, range_end: selection.end, id: '__sel' })
    }
    if (canAnnotate) {
      if (classDraft) (byBlock[classDraft.blockId] ||= []).push({
        ...classDraft, range_start: classDraft.start, range_end: classDraft.end, id: '__classdraft', __class: true })
      else if (selection?.target === 'text') (byBlock[selection.blockId] ||= []).push({
        ...selection, range_start: selection.start, range_end: selection.end, id: '__sel', __class: true })
    }

    const touched = []
    const stalies = new Set()
    if (canNote) for (const n of notes) {
      if (n.target !== 'answer') continue
      const body = answers[`${n.block_id}::${n.part_id}`] ?? ''
      if (n.quote && body.slice(n.range_start, n.range_end) !== n.quote) stalies.add(n.id)
    }
    for (const [blockId, list] of Object.entries(byBlock)) {
      const els = blockElements(root, blockId)
      if (!els.length) continue
      touched.push(els)
      // Later highlights first: painting splits text nodes, and going
      // back-to-front keeps the earlier offsets pointing where they did.
      for (const n of [...list].sort((a, b) => b.range_start - a.range_start)) {
        const isDraftish = n.id === '__draft' || n.id === '__sel' || n.id === '__classdraft'
        const stale = !isDraftish && !checkQuote(els, n)
        if (stale) stalies.add(n.id)
        const base = n.__class ? 'bk-class-hl' : 'bk-note-hl'
        const active = n.__class ? activeClassNote === n.id : activeNote === n.id
        const el = paintRange(els, {
          start: n.range_start ?? n.start, end: n.range_end ?? n.end, id: n.id,
          className: `${base}${stale ? ` ${base}-stale` : ''}${active ? ` ${base}-on` : ''}`,
          onClick: n.__class ? () => setActiveClassNote(n.id) : () => setActiveNote(n.id),
        })
        if (el) markRefs.current[n.id] = el
      }
    }
    // Staleness feeds the warning line on the margin cards. Guarded — it only
    // sets state when the stale set genuinely changed — so this every-render
    // effect settles instead of re-triggering itself.
    setStaleNotes(prev => (prev.size === stalies.size && [...stalies].every(i => prev.has(i)) ? prev : stalies))
    return () => touched.forEach(unpaint)
  })

  // Align each margin card with the answer it points at. Positions are written
  // straight to the DOM rather than through state: they are derived from layout,
  // and setting state here would re-render on every measure.
  const noteRefs = useRef({})
  useLayoutEffect(() => {
    const base = gutterRef.current?.getBoundingClientRect().top ?? 0
    // Each card wants to sit level with the text it points at, but several
    // comments can share one answer (or sit a line apart), and pinning them all
    // to their anchor stacks them exactly on top of each other — which reads as
    // "only one comment per page". So: take the wanted positions in order and
    // push each one down past the previous card, the way Google Docs cascades
    // a cluster of margin notes.
    const cards = []
    const at = (id, el) => {
      const note = noteRefs.current[id]
      if (el && note) cards.push({ note, top: Math.max(0, el.getBoundingClientRect().top - base) })
    }
    const want = (id, key) => at(id, boxRefs.current[key])
    for (const c of comments) want(c.id, `${c.block_id}::${c.part_id}`)
    if (draft) want('__draft', draft.key)
    // A student's note points at the highlight itself when it sits in the
    // workbook's text, and at the answer box when it sits in their own writing.
    for (const n of notes) {
      at(n.id, n.target === 'answer' ? boxRefs.current[`${n.block_id}::${n.part_id}`] : markRefs.current[n.id])
    }
    if (noteDraft) at('__notedraft', noteDraft.target === 'answer'
      ? boxRefs.current[`${noteDraft.blockId}::${noteDraft.partId}`] : markRefs.current.__draft)
    for (const n of classNotes) at(n.id, markRefs.current[n.id])
    if (classDraft) at('__classdraft', markRefs.current.__classdraft)
    cards.sort((a, b) => a.top - b.top)
    let floor = -Infinity
    for (const c of cards) {
      const top = Math.max(c.top, floor)
      c.note.style.top = `${top}px`
      floor = top + c.note.offsetHeight + 10   // 10px breathing room between cards
    }
  })

  /* Focus a freshly opened draft card by hand rather than with autoFocus.
     React applies autoFocus while committing, which is BEFORE the effect above
     gives the card its `top` — so the browser sees an unpositioned card at the
     very top of the margin and scrolls the whole page up to reveal it. Focusing
     here means the card is already beside its highlight, and preventScroll
     stops the browser moving the page even so. Keyed on the anchor, not the
     draft object, or every keystroke would re-focus. */
  const draftKey = draft ? `c:${draft.key}:${draft.start}:${draft.end}` : ''
  const noteKey = noteDraft
    ? `n:${noteDraft.target}:${noteDraft.blockId}:${noteDraft.partId}:${noteDraft.start}:${noteDraft.end}` : ''
  const classKey = classDraft ? `cd:${classDraft.blockId}:${classDraft.start}:${classDraft.end}` : ''
  useLayoutEffect(() => {
    if (!draftKey && !noteKey && !classKey) return
    const el = draftInputRef.current || noteInputRef.current || classDraftRef.current
    el?.focus({ preventScroll: true })
  }, [draftKey, noteKey, classKey])
  const editingNoteId = editingNote?.id || ''
  useLayoutEffect(() => {
    if (editingNoteId) noteEditRef.current?.focus({ preventScroll: true })
  }, [editingNoteId])
  const editingClassId = editingClassNote?.id || ''
  useLayoutEffect(() => {
    if (editingClassId) classEditRef.current?.focus({ preventScroll: true })
  }, [editingClassId])

  // ── render ────────────────────────────────────────────────────────────────
  /* Each chunk renders as: wrapper div (owns the block id + the 32px block
     gap) → html pieces cut at every answer box → live field components between
     them, in the same React tree.

     Why not portal the fields into the renderer's placeholder boxes and keep
     the html intact? Tried; in React 19 a portal whose container lives inside
     a dangerouslySetInnerHTML subtree makes React re-set that innerHTML on
     every commit — the container detaches and the page eats itself (verified
     with a 20-line repro). So the html is cut, and the seams the cut creates
     are healed in CSS instead: every .bk-block's own bottom margin is zeroed
     inside the doc (a cut root would drop that margin at a seam that doesn't
     exist in print — part (a)'s box sat 32px under its prompt while later
     parts sat 12px, and the real between-question gap collapsed to 6px) and
     the wrapper carries the 32px, where no cut can misplace it. */
  let slotIdx = 0
  const BID_RE = /\sdata-bid="([^"]+)"/
  const renderChunk = (html, k) => {
    const bid = BID_RE.exec(html)?.[1]
    return (
    <div key={k} data-bid={bid || undefined} className="bk-chunk">
      {splitAtBoxes(bid ? html.replace(BID_RE, '') : html).map((piece, j) => {
        if (!piece.box) return <div key={j} dangerouslySetInnerHTML={{ __html: piece.html }} />
        const slot = slots[slotIdx++] || { blockId: `?${slotIdx}`, partId: '' }
        const key = keyOf(slot)
        const reg = (el) => { if (el) boxRefs.current[key] = el }
        if (isModel) {
          return <OwnAnswer key={j} minHeight={piece.minHeight} value={models[key] ?? ''} registerRef={reg}
            editText={null} marks={[]}
            onChange={(v) => { setModels(m => ({ ...m, [key]: v })); saveModel(key, slot.blockId, slot.partId, v) }} />
        }
        // A Teacher's Notes slot on any other tab: the teacher's text, read-only,
        // live — one-directional by construction (there is nothing to type into).
        if (slot.teacher) {
          const txt = (models[key] ?? '').trim()
          return (
            <div key={j} ref={reg} className="bk-model bk-tnotes-view" style={{ minHeight: piece.minHeight }}>
              {txt
                ? <div className="bk-model-b">{txt}</div>
                : <span className="bk-answer-empty">Your teacher hasn&rsquo;t written here yet.</span>}
            </div>
          )
        }
        if (mode === 'review') {
          const mine = comments.filter(c => `${c.block_id}::${c.part_id}` === key)
          return <ReviewAnswer key={j} minHeight={piece.minHeight} text={answers[key] ?? ''}
            editText={edits[key]?.text ?? null} editBase={edits[key]?.base ?? null}
            comments={mine} activeId={activeComment} onActivate={setActiveComment} registerRef={reg}
            onEdit={(v, base) => {
              setEdits(m => ({ ...m, [key]: { text: v, base: base ?? null } }))
              saveEdit(key, slot.blockId, slot.partId, v, base ?? null)
            }}
            onAnchor={(sel) => { setDraft({ key, slot, ...sel, body: '' }); setActiveComment(null) }} />
        }
        const myMarks = [
          ...notes.filter(n => n.target === 'answer' && `${n.block_id}::${n.part_id}` === key)
            .map(n => ({ start: n.range_start, end: n.range_end, active: activeNote === n.id,
              onClick: () => setActiveNote(n.id),
              stale: (answers[key] ?? '').slice(n.range_start, n.range_end) !== n.quote })),
          ...(noteDraft?.target === 'answer' && `${noteDraft.blockId}::${noteDraft.partId}` === key
            ? [{ start: noteDraft.start, end: noteDraft.end, active: true }] : []),
          // The pending selection, so the highlight survives the textarea
          // losing focus before the Note button is clicked.
          ...(!noteDraft && selection?.target === 'answer' && `${selection.blockId}::${selection.partId}` === key
            ? [{ start: selection.start, end: selection.end, active: true }] : []),
        ]
        const modelText = (models[key] ?? '').trim()
        return (
          <div key={j}>
            <OwnAnswer minHeight={piece.minHeight} value={answers[key] ?? ''} registerRef={reg}
              editText={edits[key]?.text ?? null} editBase={edits[key]?.base ?? null}
              marks={myMarks} onSelect={(el) => onAnswerSelect(slot, el)}
              onChange={(v) => { setAnswers(m => ({ ...m, [key]: v })); saveAnswer(key, slot.blockId, slot.partId, v) }} />
            {modelText && (
              <div className="bk-model">
                <span className="bk-model-t">Teacher&rsquo;s working</span>
                <div className="bk-model-b">{modelText}</div>
              </div>
            )}
          </div>
        )
      })}
    </div>
    )
  }


  return (
    <div className="bk-doc-scroll">
      <div className="bk-doc-outer">
      <style>{`${BOOKLET_CSS}
        .bk-doc-scroll{ overflow-x:auto; }
        /* Centring the page + margin as one block leaves the A4 page itself
           sitting left of centre by half the margin. A balance strip mirroring
           the margin puts the page in the true middle, and it shrinks
           (flex:0 1) so a narrow window spends its width on the page instead.
           min-width is exactly what CANNOT shrink — page + margin + gaps — so
           the flex line never overflows its own box and justify-content:center
           is safe here; with the old width:max-content it would have overflowed
           BOTH ways and slid the page off the left edge. */
        .bk-doc-outer{ display:flex; gap:18px; align-items:flex-start; justify-content:center;
          width:100%; min-width:${Math.ceil((spread ? PAGE_W * 2 + SPREAD_GAP : PAGE_W) * zoom) + GUTTER_W + 36}px; }
        .bk-doc-balance{ flex:0 1 ${GUTTER_W + 18}px; min-width:0; }
        .bk-doc-pages{ width:${PAGE_W}px; flex:0 0 auto; }
        /* Booklet view: pages flow two-up like an open book. The container is
           zoomed to fit the window (inline style), which reflows — every rect
           measurement stays consistent because they are all visual deltas. */
        .bk-doc-pages.bk-spread{ width:${PAGE_W * 2 + SPREAD_GAP}px; flex:0 0 auto;
          display:flex; flex-wrap:wrap; gap:0 ${SPREAD_GAP}px; align-content:flex-start; }
        .bk-doc-pages.bk-spread > p{ width:100%; }
        .bk-doc-page{ position:relative; width:${PAGE_W}px; min-height:${PAGE_H}px; background:#fff;
          box-shadow:0 1px 4px rgba(16,32,64,.14); border-radius:4px; margin:0 0 20px;
          padding:48px; box-sizing:border-box; }
        .bk-doc-pageno{ position:absolute; bottom:14px; right:20px; font-size:10px; color:#9aa4bb; }
        .bk-gutter{ width:${GUTTER_W}px; flex:0 0 ${GUTTER_W}px; position:relative; }
        /* Seam-safe block spacing: the html is cut at every answer box, and a
           cut root drops its own bottom margin at the seam. So inside the doc
           NO block carries its own bottom margin — the chunk wrapper does,
           where a cut can't misplace it. Same 32px per block as print. */
        .bk-doc-pages .bk-content .bk-block{ margin-bottom:0; }
        .bk-doc-pages .bk-content > .bk-chunk{ margin-bottom:32px; }
        .bk-doc-pages .bk-content > .bk-chunk:last-child{ margin-bottom:0; }
        .bk-answer-live{ margin:12px 0 6px; }
        /* overflow-wrap is stated rather than left to default: a textarea
           computes break-word and a div computes normal, so leaving it out
           makes the highlight backdrop wrap differently from the text in front
           of it and the highlights slide off the words. */
        .bk-answer-input{ display:block; width:100%; box-sizing:border-box; font:inherit; font-size:15px;
          line-height:26px; color:#1c1c1c; border:1px solid #c3cee6; border-radius:8px; background:#fcfdff;
          padding:8px 12px; resize:none; overflow:hidden; white-space:pre-wrap; overflow-wrap:break-word; }
        textarea.bk-answer-input:focus{ outline:none; border-color:#325099; box-shadow:0 0 0 3px rgba(50,80,153,.12); background:#fff; }
        .bk-answer-ro{ background:#f7f9fd; cursor:text; }
        .bk-answer-empty{ color:#9aa4bb; font-style:italic; }
        .bk-hl{ background:#FDECC8; border-bottom:2px solid #E4B34A; color:inherit; cursor:pointer; }
        .bk-hl-on{ background:#FBD87F; }
        /* A resolved comment fades: its highlight to a whisper, its card kept
           but visibly done — the open ones are what catch the eye. */
        .bk-hl-res{ background:#F4F1E8; border-bottom-color:#DDD5C0; }
        .bk-note-res{ opacity:.62; border-left-color:#7FBFA5; }
        .bk-note-res .bk-note-b{ color:#6b6b6b; }
        .bk-note-done{ display:block; font-size:9px; font-weight:800; letter-spacing:.09em;
          text-transform:uppercase; color:#0E7A5F; margin-bottom:3px; }
        .bk-comment-add{ position:absolute; right:-8px; transform:translateX(100%); z-index:5;
          background:#325099; color:#fff; border:0; border-radius:8px; padding:4px 10px;
          font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap; }
        .bk-note{ position:absolute; width:238px; background:#fff; border:1px solid #E8D6A8;
          border-left:3px solid #E4B34A; border-radius:8px; padding:8px 10px; box-shadow:0 1px 3px rgba(16,32,64,.10);
          transition:top .15s ease; }
        .bk-note-on{ border-color:#D9A227; box-shadow:0 2px 10px rgba(180,83,9,.18); }
        .bk-note-q{ display:block; font-size:11px; color:#8a6d1f; background:#FFFBEF; border-radius:4px;
          padding:2px 6px; margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .bk-note-b{ margin:0; font-size:13px; line-height:19px; color:#3b3b3b; white-space:pre-wrap; }
        .bk-note-x{ float:right; border:0; background:transparent; color:#b9a06a; cursor:pointer; font-size:12px; line-height:1; }
        .bk-note-input{ width:100%; box-sizing:border-box; border:1px solid #E8D6A8; border-radius:6px;
          font:inherit; font-size:13px; padding:5px 7px; resize:vertical; min-height:52px; }
        .bk-note-input:focus{ outline:none; border-color:#D9A227; }

        /* The student's own highlights and notes. Deliberately blue against the
           teacher's amber, so at a glance it is obvious which marks are theirs
           and which came back from the teacher. */
        .bk-note-hl{ background:#C9DDFF; color:inherit; cursor:pointer; }
        .bk-note-hl-on{ background:#A9C8FF; }
        /* The booklet was edited after this was highlighted, so the range no
           longer covers the words it was written about. Shown, not hidden. */
        .bk-note-hl-stale{ background:#E3E9F2; }
        .bk-note-btn{ position:absolute; right:-8px; transform:translateX(100%); z-index:6;
          background:#0E7A5F; color:#fff; border:0; border-radius:8px; padding:4px 10px;
          font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap; }
        .bk-mine{ border-color:#CBD9F5; border-left-color:#5B85D6; }
        .bk-mine.bk-note-on{ border-color:#325099; box-shadow:0 2px 10px rgba(50,80,153,.18); }
        .bk-mine .bk-note-q{ color:#325099; background:#F4F8FF; }
        .bk-mine .bk-note-x{ color:#8fa6cf; }
        .bk-mine .bk-note-input{ border-color:#CBD9F5; }
        .bk-mine .bk-note-input:focus{ border-color:#325099; }
        .bk-note-who{ display:block; font-size:9px; font-weight:800; letter-spacing:.09em;
          text-transform:uppercase; color:#8fa6cf; margin-bottom:3px; }

        /* The teacher's class-wide annotations: green on every copy, so they
           read as a third voice — distinct from the teacher's per-student amber
           and the student's own blue. */
        .bk-class-hl{ background:#C8EEDC; color:inherit; cursor:pointer; }
        .bk-class-hl-on{ background:#A2E3C6; }
        .bk-class-hl-stale{ background:#E2EDE7; }
        .bk-class{ border-color:#BFE5D2; border-left-color:#0E7A5F; }
        .bk-class.bk-note-on{ border-color:#0E7A5F; box-shadow:0 2px 10px rgba(14,122,95,.18); }
        .bk-class .bk-note-q{ color:#0E7A5F; background:#EEFBF5; }
        .bk-class .bk-note-who{ color:#54b391; }
        .bk-class .bk-note-x{ color:#7cc0a5; }
        .bk-class .bk-note-input{ border-color:#BFE5D2; }
        .bk-class .bk-note-input:focus{ border-color:#0E7A5F; }
        .bk-class-btn{ background:#0E7A5F; }
        /* The teacher's live working, mirrored under the student's own box. */
        .bk-model{ margin:6px 0 0; border:1px solid #BFE5D2; border-left:3px solid #0E7A5F;
          background:#F3FBF7; border-radius:8px; padding:7px 12px 9px; }
        .bk-model-t{ display:block; font-size:9px; font-weight:800; letter-spacing:.09em;
          text-transform:uppercase; color:#54b391; margin-bottom:2px; }
        .bk-model-b{ font-size:14px; line-height:23px; color:#1c3d33; white-space:pre-wrap; overflow-wrap:break-word; }
        .bk-tnotes-view{ margin:12px 0 6px; box-sizing:border-box; }
        .bk-note-stale{ display:block; font-size:10px; color:#9a6a2f; margin-top:4px; }

        /* Highlight backdrop for the student's own answer box: identical box
           metrics to the textarea in front of it, its own text invisible. Any
           divergence in font, padding or wrapping shows up as highlights
           sliding out of line with the words. */
        .bk-answer-stack{ position:relative; }
        .bk-answer-back{ position:absolute; inset:0; color:transparent; overflow:hidden;
          pointer-events:none; border-color:transparent; }
        .bk-answer-back mark{ color:transparent; }
        textarea.bk-answer-front{ position:relative; background:transparent; }
        textarea.bk-answer-front:focus{ background:transparent; }

        /* MCQ options are clickable on the student's copy; the chosen one wears
           a pill on both the student's copy and the teacher's review tab. */
        .bk-doc-own .bk-opts[data-pid] [data-opt]{ cursor:pointer; border:1px solid transparent;
          border-radius:8px; padding:2px 8px; margin-left:-9px; }
        .bk-doc-own .bk-opts[data-pid] [data-opt]:hover{ background:#F2F6FF; }
        .bk-opt-sel{ background:#EAF1FF !important; border:1px solid #7FA3E8 !important;
          border-radius:8px; padding:2px 8px; margin-left:-9px; }

        /* The teacher's tracked changes: struck-through deletions keep the
           student's words legible; the teacher's own words are red. */
        .bk-edit-stale{ font-size:11px; color:#8a6d1a; background:#FDF6E3; border:1px solid #F1E3B4; border-radius:8px; padding:3px 10px; margin-bottom:6px; width:fit-content; }
        .bk-del{ text-decoration:line-through; text-decoration-color:#C22D2D; color:#8b8f9a; }
        .bk-ins{ text-decoration:none; color:#C22D2D; }
        .bk-del mark, .bk-ins mark{ color:inherit; }
        .bk-edit-tools{ position:absolute; top:-11px; right:10px; display:flex; gap:6px; z-index:4; }
        /* Page navigator: a pill fixed to the foot of the window, with the
           jump list opening upwards above it. Fixed (not sticky) so it stays
           reachable no matter how far down the workbook the reader is. */
        .bk-nav{ position:fixed; left:50%; bottom:18px; transform:translateX(-50%);
          z-index:40; display:flex; flex-direction:column; align-items:center; gap:6px; }
        .bk-nav-bar{ display:flex; align-items:stretch; background:#fff; border:1px solid #DEE7FF;
          border-radius:999px; box-shadow:0 4px 16px rgba(16,32,64,.16); overflow:hidden; }
        .bk-nav-arrow{ width:34px; font-size:18px; line-height:1; color:#325099; background:#fff;
          border:0; cursor:pointer; }
        .bk-nav-arrow:hover:not(:disabled){ background:#F0F4FF; }
        .bk-nav-arrow:disabled{ color:#c9cfdd; cursor:default; }
        .bk-nav-view{ width:44px; font-size:13px; letter-spacing:1px; border-left:1px solid #EEF2FF; }
        .bk-nav-view[aria-pressed="true"]{ background:#EAF1FF; }
        .bk-nav-zbtn{ font-size:14px; border-left:1px solid #EEF2FF; }
        .bk-nav-zin{ width:46px; border:0; text-align:center; font:inherit; font-size:12px;
          font-weight:700; color:#2A2035; padding:0; background:#fff; }
        .bk-nav-zin:focus{ outline:none; background:#F8FAFF; }
        .bk-nav-fit{ width:auto; font-size:11px; font-weight:700; padding:0 10px;
          border-left:1px solid #EEF2FF; }
        .bk-nav-fit[aria-pressed="true"]{ background:#EAF1FF; }
        .bk-nav-cur{ border:0; border-left:1px solid #EEF2FF; border-right:1px solid #EEF2FF;
          background:#fff; padding:7px 14px; font-size:12px; font-weight:700; color:#2A2035;
          cursor:pointer; white-space:nowrap; }
        .bk-nav-cur:hover{ background:#F8FAFF; }
        .bk-nav-of{ font-weight:500; color:#2A2035; opacity:.45; }
        .bk-nav-here{ font-weight:600; color:#325099; margin-left:8px; padding-left:8px;
          border-left:1px solid #E4EAF8; max-width:230px; overflow:hidden; text-overflow:ellipsis;
          display:inline-block; vertical-align:bottom; }
        .bk-nav-list{ max-height:min(52vh,420px); overflow-y:auto; width:290px; background:#fff;
          border:1px solid #DEE7FF; border-radius:12px; box-shadow:0 8px 24px rgba(16,32,64,.18);
          padding:5px; }
        .bk-nav-item{ display:flex; align-items:center; gap:9px; width:100%; text-align:left;
          background:none; border:0; border-radius:8px; padding:5px 8px; cursor:pointer;
          font-size:12px; color:#2A2035; }
        .bk-nav-item:hover{ background:#F0F4FF; }
        .bk-nav-item-on{ background:#325099; color:#fff; }
        .bk-nav-n{ flex:0 0 26px; font-weight:700; font-size:11px; text-align:right; opacity:.75; }
        .bk-nav-lbl{ flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        @media print{ .bk-nav{ display:none; } }
        .bk-tool{ border:1px solid #c3cee6; background:#fff; color:#325099; border-radius:8px;
          padding:2px 9px; font-size:11px; font-weight:700; cursor:pointer; }
        .bk-tool:hover{ border-color:#325099; }
        .bk-tool-on{ background:#325099; color:#fff; border-color:#325099; }
        textarea.bk-edit-ta{ border-color:#325099; background:#fff; }
      `}</style>

      {/* Mirrors the comment margin so the page lands in the true centre. */}
      <div className="bk-doc-balance" aria-hidden="true" />

      <div className={`bk-root bk-doc-pages${spread ? ' bk-spread' : ''}${mode === 'own' ? ' bk-doc-own' : ''}`} ref={pagesRef}
        style={{ position: 'relative', zoom: zoom !== 1 ? zoom : undefined }}
        onMouseUp={canNote || canAnnotate ? onPageSelect : undefined}
        onClick={mode === 'own' ? onPageClick : undefined}>
        {(canNote || canAnnotate) && selection && !noteDraft && !classDraft && (
          <button
            className={canAnnotate ? 'bk-note-btn bk-class-btn' : 'bk-note-btn'}
            style={{ top: Math.max(0, selection.top - 8) }}
            onMouseDown={(e) => {
              e.preventDefault()
              if (canAnnotate) {
                setClassDraft({ blockId: selection.blockId, start: selection.start,
                  end: selection.end, quote: selection.quote, body: '' })
                setActiveClassNote(null)
              } else {
                setNoteDraft({ ...selection, body: '' }); setActiveNote(null)
              }
              setSelection(null)
              window.getSelection()?.removeAllRanges()
            }}
          >{canAnnotate ? '📢 Class note' : '🖍 Note'}</button>
        )}
        {!ready ? <p className="text-sm text-[#2A2035]/40 py-10 text-center">Loading…</p>
          : pages.map((chunks, pi) => (
            <article key={pi} className="bk-doc-page">
              <div className="bk-content">{chunks.map((h, ci) => renderChunk(h, ci))}</div>
              <span className="bk-doc-pageno">Page {pi + 1} of {pages.length}</span>
            </article>
          ))}
        {!solutions && (
          <p className="text-center text-[11px] text-[#2A2035]/40 pb-6">
            {failing ? <span className="text-[#B23A3A] font-semibold">Not saved — retrying…</span>
              : unsaved > 0 ? 'Saving…' : ready ? 'All changes saved' : ''}
          </p>
        )}
      </div>

      {/* Page navigator — floats over the foot of the window on every copy
          (student, teacher, model, solutions). Hidden for a one-page doc,
          where there is nothing to navigate to. */}
      {ready && pages.length > 1 && (
        <div className="bk-nav" ref={navRef}>
          {jumpOpen && (
            <div className="bk-nav-list" role="listbox" aria-label="Go to page">
              {pages.map((_c, i) => (
                <button key={i} role="option" aria-selected={i === curPage}
                  className={`bk-nav-item${i === curPage ? ' bk-nav-item-on' : ''}`}
                  onClick={() => goToPage(i)}>
                  <span className="bk-nav-n">{i + 1}</span>
                  <span className="bk-nav-lbl">{pageLabels[i] || ''}</span>
                </button>
              ))}
            </div>
          )}
          <div className="bk-nav-bar">
            <button className="bk-nav-arrow" title="Previous page" aria-label="Previous page"
              disabled={curPage === 0}
              onClick={() => goToPage(Math.max(0, (spread ? curPage - (curPage % 2) : curPage) - (spread ? 2 : 1)))}>‹</button>
            <button className="bk-nav-cur" onClick={() => setJumpOpen(o => !o)}
              aria-expanded={jumpOpen} title="Go to page">
              Page {curPage + 1} <span className="bk-nav-of">of {pages.length}</span>
              {pageLabels[curPage] ? <span className="bk-nav-here">{pageLabels[curPage]}</span> : null}
            </button>
            <button className="bk-nav-arrow" title="Next page" aria-label="Next page"
              disabled={(spread ? curPage - (curPage % 2) + 2 : curPage + 1) > pages.length - 1}
              onClick={() => goToPage(Math.min(pages.length - 1, (spread ? curPage - (curPage % 2) : curPage) + (spread ? 2 : 1)))}>›</button>
            <button className="bk-nav-arrow bk-nav-zbtn" title="Zoom out" aria-label="Zoom out"
              disabled={Math.round(zoom * 100) <= 40} onClick={() => bumpZoom(-10)}>−</button>
            <input className="bk-nav-zin" aria-label="Zoom percentage" inputMode="numeric"
              value={zoomField !== null ? zoomField : `${Math.round(zoom * 100)}%`}
              onFocus={(e) => { const t = e.target; requestAnimationFrame(() => t.select()) }}
              onChange={(e) => setZoomField(e.target.value)}
              onBlur={commitZoom}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { commitZoom(); e.target.blur() }
                if (e.key === 'Escape') { setZoomField(null); e.target.blur() }
              }} />
            <button className="bk-nav-arrow bk-nav-zbtn" title="Zoom in" aria-label="Zoom in"
              disabled={Math.round(zoom * 100) >= 200} onClick={() => bumpZoom(10)}>+</button>
            <button className="bk-nav-arrow bk-nav-fit" onClick={() => setZoom('fit')} aria-pressed={zoomPct === 'fit'}
              title="Fit to window" aria-label="Fit to window">Fit</button>
            <button className="bk-nav-arrow bk-nav-view" onClick={toggleSpread} aria-pressed={spread}
              title={spread ? 'One page at a time' : 'Booklet view — two pages side by side'}
              aria-label={spread ? 'Switch to single page view' : 'Switch to booklet view'}>
              {spread ? '▯' : '▯▯'}
            </button>
          </div>
        </div>
      )}

      {/* The comment margin is always laid out — even on the solutions copy,
          where it stays empty — so the page sits in the same place on every
          tab instead of jumping sideways when comments appear. */}
      <div className="bk-gutter" ref={gutterRef}>
        {classDraft && (
          <div className="bk-note bk-class bk-note-on" ref={(el) => { noteRefs.current.__classdraft = el }}>
            <span className="bk-note-who">To the whole class</span>
            <span className="bk-note-q">“{classDraft.quote}”</span>
            <textarea ref={classDraftRef} className="bk-note-input" value={classDraft.body}
              placeholder="Annotation, exemplar response…"
              onChange={(e) => setClassDraft(d => ({ ...d, body: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addClassNote(); if (e.key === 'Escape') setClassDraft(null) }} />
            <div className="flex justify-end gap-2 mt-1.5">
              <button onClick={() => setClassDraft(null)} className="text-[11px] text-[#2A2035]/45">Cancel</button>
              <button onClick={addClassNote} className="text-[11px] font-bold text-[#0E7A5F]">Post to class</button>
            </div>
          </div>
        )}
        {classNotes.map(n => (
          <div key={n.id} className={`bk-note bk-class${activeClassNote === n.id ? ' bk-note-on' : ''}`}
            ref={(el) => { noteRefs.current[n.id] = el }} onClick={() => setActiveClassNote(n.id)}>
            {canAnnotate && editingClassNote?.id !== n.id && (
              <span className="float-right flex gap-1.5">
                <button className="bk-note-x" title="Edit annotation" onClick={(e) => {
                  e.stopPropagation(); setEditingClassNote({ id: n.id, body: n.body }); setActiveClassNote(n.id)
                }}>✏️</button>
                <button className="bk-note-x" title="Delete annotation"
                  onClick={(e) => { e.stopPropagation(); removeClassNote(n.id) }}>✕</button>
              </span>
            )}
            <span className="bk-note-who">{canAnnotate ? 'To the whole class' : 'Teacher — for everyone'}</span>
            {n.quote && <span className="bk-note-q">“{n.quote}”</span>}
            {editingClassNote?.id === n.id ? (
              <>
                <textarea ref={classEditRef} className="bk-note-input" value={editingClassNote.body}
                  onChange={(e) => setEditingClassNote(d => ({ ...d, body: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveClassNoteEdit(); if (e.key === 'Escape') setEditingClassNote(null) }} />
                <div className="flex justify-end gap-2 mt-1.5">
                  <button onClick={(e) => { e.stopPropagation(); setEditingClassNote(null) }} className="text-[11px] text-[#2A2035]/45">Cancel</button>
                  <button onClick={(e) => { e.stopPropagation(); saveClassNoteEdit() }} className="text-[11px] font-bold text-[#0E7A5F]">Save</button>
                </div>
              </>
            ) : (
              <p className="bk-note-b">{n.body}</p>
            )}
            {staleNotes.has(n.id) && (
              <span className="bk-note-stale">⚠ The workbook changed here — this may no longer line up.</span>
            )}
          </div>
        ))}
        {mode !== 'solutions' && (
          <>
          {draft && (
            <div className="bk-note bk-note-on" ref={(el) => { noteRefs.current.__draft = el }}>
              <span className="bk-note-q">“{draft.quote}”</span>
              <textarea ref={draftInputRef} className="bk-note-input" value={draft.body}
                placeholder="Comment on this…"
                onChange={(e) => setDraft(d => ({ ...d, body: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment(); if (e.key === 'Escape') setDraft(null) }} />
              <div className="flex justify-end gap-2 mt-1.5">
                <button onClick={() => setDraft(null)} className="text-[11px] text-[#2A2035]/45">Cancel</button>
                <button onClick={addComment} className="text-[11px] font-bold text-[#325099]">Comment</button>
              </div>
            </div>
          )}
          {comments.map(c => (
            <div key={c.id} className={`bk-note${c.resolved ? ' bk-note-res' : ''}${activeComment === c.id ? ' bk-note-on' : ''}`}
              ref={(el) => { noteRefs.current[c.id] = el }} onClick={() => setActiveComment(c.id)}>
              {mode === 'review' && <button className="bk-note-x" title="Delete comment"
                onClick={(e) => { e.stopPropagation(); removeComment(c.id) }}>✕</button>}
              {mode === 'own' && <span className="bk-note-who" style={{ color: '#b9a06a' }}>Teacher</span>}
              {c.resolved && <span className="bk-note-done">✓ Resolved</span>}
              {c.quote && <span className="bk-note-q">“{c.quote}”</span>}
              <p className="bk-note-b">{c.body}</p>
              <div className="flex justify-end mt-1.5">
                <button
                  className={`text-[11px] font-bold ${c.resolved ? 'text-[#2A2035]/40' : 'text-[#0E7A5F]'}`}
                  title={c.resolved ? 'Reopen this comment' : 'Mark as done'}
                  onClick={(e) => { e.stopPropagation(); toggleResolved(c) }}
                >{c.resolved ? '↩ Reopen' : '✓ Resolve'}</button>
              </div>
            </div>
          ))}

          {/* The student's own notes — nobody else ever loads these. */}
          {noteDraft && (
            <div className="bk-note bk-mine bk-note-on" ref={(el) => { noteRefs.current.__notedraft = el }}>
              <span className="bk-note-who">Your note</span>
              <span className="bk-note-q">“{noteDraft.quote}”</span>
              <textarea ref={noteInputRef} className="bk-note-input" value={noteDraft.body}
                placeholder="Write a note…"
                onChange={(e) => setNoteDraft(d => ({ ...d, body: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote(); if (e.key === 'Escape') setNoteDraft(null) }} />
              <div className="flex justify-end gap-2 mt-1.5">
                <button onClick={() => setNoteDraft(null)} className="text-[11px] text-[#2A2035]/45">Cancel</button>
                <button onClick={addNote} className="text-[11px] font-bold text-[#325099]">Save note</button>
              </div>
            </div>
          )}
          {notes.map(n => (
            <div key={n.id} className={`bk-note bk-mine${activeNote === n.id ? ' bk-note-on' : ''}`}
              ref={(el) => { noteRefs.current[n.id] = el }} onClick={() => setActiveNote(n.id)}>
              {editingNote?.id !== n.id && (
                <span className="float-right flex gap-1.5">
                  <button className="bk-note-x" title="Edit note" onClick={(e) => {
                    e.stopPropagation(); setEditingNote({ id: n.id, body: n.body }); setActiveNote(n.id)
                  }}>✏️</button>
                  <button className="bk-note-x" title="Delete note"
                    onClick={(e) => { e.stopPropagation(); removeNote(n.id) }}>✕</button>
                </span>
              )}
              <span className="bk-note-who">Your note</span>
              {n.quote && <span className="bk-note-q">“{n.quote}”</span>}
              {editingNote?.id === n.id ? (
                <>
                  <textarea ref={noteEditRef} className="bk-note-input" value={editingNote.body}
                    onChange={(e) => setEditingNote(d => ({ ...d, body: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNoteEdit(); if (e.key === 'Escape') setEditingNote(null) }} />
                  <div className="flex justify-end gap-2 mt-1.5">
                    <button onClick={(e) => { e.stopPropagation(); setEditingNote(null) }} className="text-[11px] text-[#2A2035]/45">Cancel</button>
                    <button onClick={(e) => { e.stopPropagation(); saveNoteEdit() }} className="text-[11px] font-bold text-[#325099]">Save</button>
                  </div>
                </>
              ) : (
                <p className="bk-note-b">{n.body}</p>
              )}
              {staleNotes.has(n.id) && (
                <span className="bk-note-stale">⚠ The workbook changed here — this may no longer line up.</span>
              )}
            </div>
          ))}
          </>
        )}
      </div>
      </div>
    </div>
  )
}
