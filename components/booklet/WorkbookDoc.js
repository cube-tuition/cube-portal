'use client'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { bookletRenderItems, BOOKLET_CSS } from '../../lib/bookletRender'
import { splitToFit } from '../../lib/paginate'

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

/* Student's answer, read-only, with commented ranges highlighted. Selecting
   text inside it offers to attach a comment to that selection. */
function ReviewAnswer({ minHeight, text, comments, onAnchor, activeId, onActivate, registerRef }) {
  const ref = useRef(null)
  const [sel, setSel] = useState(null)   // { start, end, quote, top }

  const pickSelection = () => {
    const s = window.getSelection()
    if (!s || s.isCollapsed || !ref.current || !ref.current.contains(s.anchorNode)) { setSel(null); return }
    const range = s.getRangeAt(0)
    const pre = range.cloneRange()
    pre.selectNodeContents(ref.current)
    pre.setEnd(range.startContainer, range.startOffset)
    const start = pre.toString().length
    const quote = range.toString()
    if (!quote.trim()) { setSel(null); return }
    const box = ref.current.getBoundingClientRect()
    const r = range.getBoundingClientRect()
    setSel({ start, end: start + quote.length, quote, top: r.top - box.top })
  }

  // Paint the highlights: split the text at every commented range.
  const painted = useMemo(() => {
    const marks = comments
      .filter(c => Number.isFinite(c.range_start) && Number.isFinite(c.range_end))
      .sort((a, b) => a.range_start - b.range_start)
    if (!marks.length) return [{ text }]
    const out = []
    let at = 0
    for (const m of marks) {
      const s = Math.max(at, Math.min(m.range_start, text.length))
      const e = Math.max(s, Math.min(m.range_end, text.length))
      if (s > at) out.push({ text: text.slice(at, s) })
      out.push({ text: text.slice(s, e), id: m.id })
      at = e
    }
    if (at < text.length) out.push({ text: text.slice(at) })
    return out
  }, [text, comments])

  return (
    <div className="bk-answer-live" style={{ position: 'relative' }}>
      <div
        ref={(el) => { ref.current = el; registerRef?.(el) }}
        className="bk-answer-input bk-answer-ro"
        style={{ minHeight }}
        onMouseUp={pickSelection}
        onKeyUp={pickSelection}
      >
        {text
          ? painted.map((p, i) => p.id
              ? <mark key={i} className={`bk-hl${activeId === p.id ? ' bk-hl-on' : ''}`}
                  onClick={() => onActivate(p.id)}>{p.text}</mark>
              : <span key={i}>{p.text}</span>)
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

function OwnAnswer({ minHeight, value, onChange, registerRef }) {
  const ref = useRef(null)
  const grow = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`
  }, [minHeight])
  useEffect(() => { grow() }, [grow, value])
  return (
    <div className="bk-answer-live">
      <textarea
        ref={(el) => { ref.current = el; registerRef?.(el) }}
        className="bk-answer-input" style={{ minHeight }}
        value={value} placeholder="Type your answer…"
        onChange={(e) => { onChange(e.target.value); grow() }}
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
  const timers = useRef({})
  const boxRefs = useRef({})
  const gutterRef = useRef(null)

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
        .select('block_id, part_id, body')
        .eq('booklet_id', booklet.id).eq('class_id', classId).eq('owner_id', ownerId)
      const map = {}
      for (const r of a.data || []) map[`${r.block_id}::${r.part_id}`] = r.body
      let cs = []
      if (commentStudentId) {
        const c = await supabase.from('workbook_comments')
          .select('*').eq('booklet_id', booklet.id).eq('class_id', classId).eq('student_id', commentStudentId)
          .order('created_at')
        cs = c.data || []
      }
      if (!alive) return
      setAnswers(map); setComments(cs); setLoaded(true)
    })()
    return () => { alive = false }
  }, [solutions, booklet.id, classId, ownerId, commentStudentId])

  // ── live refresh ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (solutions) return undefined
    const ch = supabase.channel(`wb:${booklet.id}:${classId}:${ownerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workbook_answers', filter: `owner_id=eq.${ownerId}` }, (p) => {
        const r = p.new
        if (!r || r.booklet_id !== booklet.id || String(r.class_id) !== String(classId)) return
        const k = `${r.block_id}::${r.part_id}`
        if (timers.current[k]) return
        setAnswers(m => (m[k] === r.body ? m : { ...m, [k]: r.body }))
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
      }, { onConflict: 'booklet_id,class_id,owner_id,block_id,part_id' })
      delete timers.current[k]; setSaving(n => Math.max(0, n - 1))
    }, SAVE_DELAY)
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
    const want = (id, key) => {
      const box = boxRefs.current[key]
      const note = noteRefs.current[id]
      if (box && note) cards.push({ note, top: Math.max(0, box.getBoundingClientRect().top - base) })
    }
    for (const c of comments) want(c.id, `${c.block_id}::${c.part_id}`)
    if (draft) want('__draft', draft.key)
    cards.sort((a, b) => a.top - b.top)
    let floor = -Infinity
    for (const c of cards) {
      const top = Math.max(c.top, floor)
      c.note.style.top = `${top}px`
      floor = top + c.note.offsetHeight + 10   // 10px breathing room between cards
    }
  })

  // ── render ────────────────────────────────────────────────────────────────
  let slotIdx = 0
  const renderChunk = (html, k) => (
    <div key={k}>
      {splitAtBoxes(html).map((piece, j) => {
        if (!piece.box) return <div key={j} dangerouslySetInnerHTML={{ __html: piece.html }} />
        const slot = slots[slotIdx++] || { blockId: `?${slotIdx}`, partId: '' }
        const key = keyOf(slot)
        const mine = comments.filter(c => `${c.block_id}::${c.part_id}` === key)
        const reg = (el) => { if (el) boxRefs.current[key] = el }
        if (mode === 'review') {
          return <ReviewAnswer key={j} minHeight={piece.minHeight} text={answers[key] ?? ''}
            comments={mine} activeId={activeComment} onActivate={setActiveComment} registerRef={reg}
            onAnchor={(s) => { setDraft({ key, slot, ...s, body: '' }); setActiveComment(null) }} />
        }
        return <OwnAnswer key={j} minHeight={piece.minHeight} value={answers[key] ?? ''} registerRef={reg}
          onChange={(v) => { setAnswers(m => ({ ...m, [key]: v })); saveAnswer(key, slot.blockId, slot.partId, v) }} />
      })}
    </div>
  )

  const ready = pages !== null && (solutions || loaded)

  return (
    <div className="bk-doc-scroll">
      <div className="bk-doc-outer">
      <style>{`${BOOKLET_CSS}
        .bk-doc-scroll{ overflow-x:auto; }
        /* width:max-content + auto margins centres the page when there is room
           and collapses to a scroll when there isn't. justify-content:center
           would overflow BOTH ways and slide the page under the tabs. */
        .bk-doc-outer{ display:flex; gap:18px; align-items:flex-start; width:max-content; margin:0 auto; }
        .bk-doc-pages{ width:${PAGE_W}px; flex:0 0 ${PAGE_W}px; }
        .bk-doc-page{ position:relative; width:${PAGE_W}px; min-height:${PAGE_H}px; background:#fff;
          box-shadow:0 1px 4px rgba(16,32,64,.14); border-radius:4px; margin:0 0 20px;
          padding:48px; box-sizing:border-box; }
        .bk-doc-pageno{ position:absolute; bottom:14px; right:20px; font-size:10px; color:#9aa4bb; }
        .bk-gutter{ width:250px; flex:0 0 250px; position:relative; }
        .bk-answer-live{ margin:12px 0 6px; }
        .bk-answer-input{ display:block; width:100%; box-sizing:border-box; font:inherit; font-size:15px;
          line-height:26px; color:#1c1c1c; border:1px solid #c3cee6; border-radius:8px; background:#fcfdff;
          padding:8px 12px; resize:none; overflow:hidden; white-space:pre-wrap; }
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
      `}</style>

      <div className="bk-root bk-doc-pages">
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
              <textarea autoFocus className="bk-note-input" value={draft.body}
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
              {c.quote && <span className="bk-note-q">“{c.quote}”</span>}
              <p className="bk-note-b">{c.body}</p>
            </div>
          ))}
          </>
        )}
      </div>
      </div>
    </div>
  )
}
