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

/* Student's answer, read-only, with commented ranges highlighted. Selecting
   text inside it offers to attach a comment to that selection. */
function ReviewAnswer({ minHeight, text, editText, comments, onAnchor, activeId, onActivate, onEdit, onClearEdit, registerRef }) {
  const ref = useRef(null)
  const taRef = useRef(null)
  const [sel, setSel] = useState(null)       // { start, end, quote, top }
  const [editing, setEditing] = useState(false)

  // The displayed text is the diff of the student's answer against the
  // teacher's marked-up version; with no edit the "diff" is one eq segment
  // and everything below collapses to the plain-text behaviour.
  const segs = useMemo(() => (editText == null || editText === text
    ? [{ t: 'eq', text }] : diffWords(text, editText)), [text, editText])

  const pickSelection = () => {
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
    setSel({ ...hit, quote, top: r.top - box.top })
  }

  const marks = useMemo(() => comments
    .filter(c => Number.isFinite(c.range_start) && Number.isFinite(c.range_end))
    .map(c => ({ start: c.range_start, end: c.range_end, id: c.id,
      cls: `bk-hl${activeId === c.id ? ' bk-hl-on' : ''}` })), [comments, activeId])

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
        onChange={(e) => { onEdit(e.target.value); grow() }} />
    </div>
  )

  return (
    <div className="bk-answer-live" style={{ position: 'relative' }}>
      <div className="bk-edit-tools">
        {editText != null && editText !== text && (
          <button className="bk-tool" title="Remove your edits and show the student’s original"
            onClick={onClearEdit}>↺ Original</button>
        )}
        <button className="bk-tool" title="Edit the student’s answer — deletions are struck through, your words show in red"
          onClick={() => setEditing(true)}>✏️ Edit</button>
      </div>
      <div
        ref={(el) => { ref.current = el; registerRef?.(el) }}
        className="bk-answer-input bk-answer-ro"
        style={{ minHeight }}
        onMouseUp={pickSelection}
        onKeyUp={pickSelection}
      >
        {text || editText
          ? renderSegs(segs, marks, onActivate)
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
function OwnAnswer({ minHeight, value, editText, marks = [], onChange, onSelect, registerRef }) {
  const ref = useRef(null)
  const grow = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`
  }, [minHeight])
  useEffect(() => { grow() }, [grow, value])
  // Once the teacher has marked this answer, the student sees the marked-up
  // version — their words with deletions struck through and the teacher's in
  // red — rather than an editable box. Their own text is untouched underneath;
  // the teacher's ↺ Original restores the editable box.
  if (editText != null && editText !== value) {
    const segs = diffWords(value, editText)
    return (
      <div className="bk-answer-live" style={{ position: 'relative' }}>
        <div ref={registerRef} className="bk-answer-input bk-answer-ro" style={{ minHeight }}>
          {renderSegs(segs, marks.map(m => ({ ...m, cls: `bk-note-hl${m.stale ? ' bk-note-hl-stale' : ''}${m.active ? ' bk-note-hl-on' : ''}`, id: m.id })), m => m?.onClick?.())}
        </div>
        <p className="bk-marked-tag">✏️ Marked by your teacher</p>
      </div>
    )
  }
  return (
    <div className="bk-answer-live bk-answer-stack">
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
  mode = 'own',                 // 'solutions' | 'own' | 'review'
  commentStudentId = null,
  staffId = null,
}) {
  const solutions = mode === 'solutions'
  const [answers, setAnswers] = useState({})
  const [comments, setComments] = useState([])
  const [loaded, setLoaded] = useState(solutions)
  const [saving, setSaving] = useState(0)
  const [pages, setPages] = useState(null)
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
  const timers = useRef({})
  const boxRefs = useRef({})
  const markRefs = useRef({})
  const draftInputRef = useRef(null)
  const noteInputRef = useRef(null)
  const noteEditRef = useRef(null)
  const pagesRef = useRef(null)
  const gutterRef = useRef(null)
  const canNote = mode === 'own'

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

  // ── load answers + comments ───────────────────────────────────────────────
  useEffect(() => {
    if (solutions) return
    let alive = true
    ;(async () => {
      const a = await supabase.from('workbook_answers')
        .select('block_id, part_id, body, is_teacher')
        .eq('booklet_id', booklet.id).eq('class_id', classId).eq('owner_id', ownerId)
      const map = {}, emap = {}
      for (const r of a.data || []) (r.is_teacher ? emap : map)[`${r.block_id}::${r.part_id}`] = r.body
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
      if (!alive) return
      setAnswers(map); setEdits(emap); setComments(cs); setNotes(ns); setLoaded(true)
    })()
    return () => { alive = false }
  }, [solutions, booklet.id, classId, ownerId, commentStudentId, canNote])

  // ── live refresh ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (solutions) return undefined
    const ch = supabase.channel(`wb:${booklet.id}:${classId}:${ownerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workbook_answers', filter: `owner_id=eq.${ownerId}` }, (p) => {
        const r = p.new
        if (!r || r.booklet_id !== booklet.id || String(r.class_id) !== String(classId)) return
        const k = `${r.block_id}::${r.part_id}`
        const tk = r.is_teacher ? `t:${k}` : k
        if (timers.current[tk]) return
        const set = r.is_teacher ? setEdits : setAnswers
        set(m => (m[k] === r.body ? m : { ...m, [k]: r.body }))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workbook_comments', filter: `student_id=eq.${commentStudentId || ownerId}` }, async () => {
        const c = await supabase.from('workbook_comments')
          .select('*').eq('booklet_id', booklet.id).eq('class_id', classId)
          .eq('student_id', commentStudentId || ownerId).order('created_at')
        setComments(c.data || [])
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [solutions, booklet.id, classId, ownerId, commentStudentId])

  useEffect(() => { const t = timers.current; return () => Object.values(t).forEach(clearTimeout) }, [])

  const saveAnswer = useCallback((k, blockId, partId, body) => {
    clearTimeout(timers.current[k]); setSaving(n => n + 1)
    timers.current[k] = setTimeout(async () => {
      await supabase.from('workbook_answers').upsert({
        booklet_id: booklet.id, class_id: classId, owner_id: ownerId, is_teacher: false,
        block_id: blockId, part_id: partId, body, updated_at: new Date().toISOString(),
      }, { onConflict: 'booklet_id,class_id,owner_id,block_id,part_id,is_teacher' })
      delete timers.current[k]; setSaving(n => Math.max(0, n - 1))
    }, SAVE_DELAY)
  }, [booklet.id, classId, ownerId])

  // The teacher's tracked-changes copy: same table, is_teacher = true.
  const saveEdit = useCallback((k, blockId, partId, body) => {
    const tk = `t:${k}`
    clearTimeout(timers.current[tk]); setSaving(n => n + 1)
    timers.current[tk] = setTimeout(async () => {
      await supabase.from('workbook_answers').upsert({
        booklet_id: booklet.id, class_id: classId, owner_id: ownerId, is_teacher: true,
        block_id: blockId, part_id: partId, body, updated_at: new Date().toISOString(),
      }, { onConflict: 'booklet_id,class_id,owner_id,block_id,part_id,is_teacher' })
      delete timers.current[tk]; setSaving(n => Math.max(0, n - 1))
    }, SAVE_DELAY)
  }, [booklet.id, classId, ownerId])

  const clearEdit = useCallback(async (k, blockId, partId) => {
    clearTimeout(timers.current[`t:${k}`]); delete timers.current[`t:${k}`]
    setEdits(m => { const n = { ...m }; delete n[k]; return n })
    await supabase.from('workbook_answers').delete().match({
      booklet_id: booklet.id, class_id: classId, owner_id: ownerId,
      block_id: blockId, part_id: partId, is_teacher: true,
    })
  }, [booklet.id, classId, ownerId])

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

  // ── the student's own highlights ──────────────────────────────────────────

  /* Anything the student selects on the page can be highlighted. Text in the
     workbook itself is anchored by block; text they typed is anchored by
     answer slot, where the textarea already knows the exact offsets. */
  const onPageSelect = useCallback((e) => {
    if (!canNote) return
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
    setSelection({
      target: 'text', blockId, partId: '', ...hit,
      top: r.top - (pagesRef.current.getBoundingClientRect().top || 0),
    })
  }, [canNote])

  // A selection inside an answer box. Offsets come straight from the textarea,
  // so they need no DOM walking — and they match what a teacher comment stores.
  const onAnswerSelect = useCallback((slot, el) => {
    if (!canNote) return
    const { selectionStart: a, selectionEnd: b, value } = el
    if (a == null || b <= a || !value.slice(a, b).trim()) { setSelection(null); return }
    const r = el.getBoundingClientRect()
    setSelection({
      target: 'answer', blockId: slot.blockId, partId: slot.partId,
      start: a, end: b, quote: value.slice(a, b),
      top: r.top - (pagesRef.current?.getBoundingClientRect().top || 0),
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
    if (!canNote) return undefined
    const textNotes = notes.filter(n => n.target === 'text')
    const byBlock = {}
    for (const n of textNotes) (byBlock[n.block_id] ||= []).push(n)
    if (noteDraft?.target === 'text') (byBlock[noteDraft.blockId] ||= []).push({ ...noteDraft, id: '__draft' })

    const touched = []
    const stalies = new Set()
    for (const n of notes) {
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
        const stale = n.id !== '__draft' && !checkQuote(els, n)
        if (stale) stalies.add(n.id)
        const el = paintRange(els, {
          start: n.range_start ?? n.start, end: n.range_end ?? n.end, id: n.id,
          className: `bk-note-hl${stale ? ' bk-note-hl-stale' : ''}${activeNote === n.id ? ' bk-note-hl-on' : ''}`,
          onClick: () => setActiveNote(n.id),
        })
        if (el) markRefs.current[n.id] = el
      }
    }
    // Staleness feeds the warning line on the margin cards. Guarded — it only
    // sets state when the stale set genuinely changed — so this every-render
    // effect settles instead of re-triggering itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  useLayoutEffect(() => {
    if (!draftKey && !noteKey) return
    const el = draftInputRef.current || noteInputRef.current
    el?.focus({ preventScroll: true })
  }, [draftKey, noteKey])
  const editingNoteId = editingNote?.id || ''
  useLayoutEffect(() => {
    if (editingNoteId) noteEditRef.current?.focus({ preventScroll: true })
  }, [editingNoteId])

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
        if (mode === 'review') {
          const mine = comments.filter(c => `${c.block_id}::${c.part_id}` === key)
          return <ReviewAnswer key={j} minHeight={piece.minHeight} text={answers[key] ?? ''}
            editText={edits[key] ?? null}
            comments={mine} activeId={activeComment} onActivate={setActiveComment} registerRef={reg}
            onEdit={(v) => { setEdits(m => ({ ...m, [key]: v })); saveEdit(key, slot.blockId, slot.partId, v) }}
            onClearEdit={() => clearEdit(key, slot.blockId, slot.partId)}
            onAnchor={(sel) => { setDraft({ key, slot, ...sel, body: '' }); setActiveComment(null) }} />
        }
        const myMarks = [
          ...notes.filter(n => n.target === 'answer' && `${n.block_id}::${n.part_id}` === key)
            .map(n => ({ start: n.range_start, end: n.range_end, active: activeNote === n.id,
              onClick: () => setActiveNote(n.id),
              stale: (answers[key] ?? '').slice(n.range_start, n.range_end) !== n.quote })),
          ...(noteDraft?.target === 'answer' && `${noteDraft.blockId}::${noteDraft.partId}` === key
            ? [{ start: noteDraft.start, end: noteDraft.end, active: true }] : []),
        ]
        return <OwnAnswer key={j} minHeight={piece.minHeight} value={answers[key] ?? ''} registerRef={reg}
          editText={edits[key] ?? null}
          marks={myMarks} onSelect={(el) => onAnswerSelect(slot, el)}
          onChange={(v) => { setAnswers(m => ({ ...m, [key]: v })); saveAnswer(key, slot.blockId, slot.partId, v) }} />
      })}
    </div>
    )
  }

  const ready = pages !== null && (solutions || loaded)

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
          width:100%; min-width:${PAGE_W + GUTTER_W + 36}px; }
        .bk-doc-balance{ flex:0 1 ${GUTTER_W + 18}px; min-width:0; }
        .bk-doc-pages{ width:${PAGE_W}px; flex:0 0 ${PAGE_W}px; }
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
        .bk-del{ text-decoration:line-through; text-decoration-color:#C22D2D; color:#8b8f9a; }
        .bk-ins{ text-decoration:none; color:#C22D2D; }
        .bk-del mark, .bk-ins mark{ color:inherit; }
        .bk-edit-tools{ position:absolute; top:-11px; right:10px; display:flex; gap:6px; z-index:4; }
        .bk-tool{ border:1px solid #c3cee6; background:#fff; color:#325099; border-radius:8px;
          padding:2px 9px; font-size:11px; font-weight:700; cursor:pointer; }
        .bk-tool:hover{ border-color:#325099; }
        .bk-tool-on{ background:#325099; color:#fff; border-color:#325099; }
        textarea.bk-edit-ta{ border-color:#325099; background:#fff; }
        .bk-marked-tag{ margin:4px 2px 0; font-size:10px; font-weight:700; color:#C22D2D; }
      `}</style>

      {/* Mirrors the comment margin so the page lands in the true centre. */}
      <div className="bk-doc-balance" aria-hidden="true" />

      <div className={`bk-root bk-doc-pages${mode === 'own' ? ' bk-doc-own' : ''}`} ref={pagesRef}
        style={{ position: 'relative' }}
        onMouseUp={canNote ? onPageSelect : undefined}
        onClick={mode === 'own' ? onPageClick : undefined}>
        {canNote && selection && !noteDraft && (
          <button
            className="bk-note-btn" style={{ top: Math.max(0, selection.top - 8) }}
            onMouseDown={(e) => {
              e.preventDefault()
              setNoteDraft({ ...selection, body: '' }); setSelection(null); setActiveNote(null)
              window.getSelection()?.removeAllRanges()
            }}
          >🖍 Note</button>
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
            {saving > 0 ? 'Saving…' : ready ? 'All changes saved' : ''}
          </p>
        )}
      </div>

      {/* The comment margin is always laid out — even on the solutions copy,
          where it stays empty — so the page sits in the same place on every
          tab instead of jumping sideways when comments appear. */}
      <div className="bk-gutter" ref={gutterRef}>
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
            <div key={c.id} className={`bk-note${activeComment === c.id ? ' bk-note-on' : ''}`}
              ref={(el) => { noteRefs.current[c.id] = el }} onClick={() => setActiveComment(c.id)}>
              {mode === 'review' && <button className="bk-note-x" title="Delete comment"
                onClick={(e) => { e.stopPropagation(); removeComment(c.id) }}>✕</button>}
              {mode === 'own' && <span className="bk-note-who" style={{ color: '#b9a06a' }}>Teacher</span>}
              {c.quote && <span className="bk-note-q">“{c.quote}”</span>}
              <p className="bk-note-b">{c.body}</p>
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
