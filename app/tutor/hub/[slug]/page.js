'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { useHub } from '../context'
import { T_INFO_PAGES } from '../../../../lib/tables'

/*
 * /tutor/hub/[slug]
 * ──────────────────────────────────────────────────────────────────────────────
 * Renders the markdown content for any info_pages row.
 *
 * Admins see an "Edit" button that opens an inline markdown editor with a
 * live preview toggle. Saves back to Supabase on click.
 *
 * Tutors see the rendered markdown (read-only).
 */

// ─── Markdown renderer (same pattern as FAQ page) ────────────────────────────
function renderMarkdown(src) {
  if (!src) return ''
  const escape = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const blocks = src.split(/\n{2,}/)
  return blocks.map(block => {
    const lines = block.split('\n')
    // Heading h2
    if (lines.length === 1 && lines[0].startsWith('## '))
      return `<h2>${inlineMd(escape(lines[0].slice(3)))}</h2>`
    // Heading h3
    if (lines.length === 1 && lines[0].startsWith('### '))
      return `<h3>${inlineMd(escape(lines[0].slice(4)))}</h3>`
    // Unordered list
    if (lines.every(l => /^[-*]\s/.test(l.trim())))
      return `<ul>${lines.map(l => `<li>${inlineMd(escape(l.replace(/^[-*]\s/, '')))}</li>`).join('')}</ul>`
    // Ordered list
    if (lines.every(l => /^\d+\.\s/.test(l.trim())))
      return `<ol>${lines.map(l => `<li>${inlineMd(escape(l.replace(/^\d+\.\s/, '')))}</li>`).join('')}</ol>`
    // Horizontal rule
    if (lines.length === 1 && /^---+$/.test(lines[0].trim()))
      return `<hr>`
    // Paragraph
    return `<p>${lines.map(l => inlineMd(escape(l))).join('<br>')}</p>`
  }).join('')
}

function inlineMd(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}

function MarkdownView({ src }) {
  return (
    <div
      className="prose-hub"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(src) }}
    />
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function HubSlugPage() {
  const { slug }       = useParams()
  const { isAdmin, loading: authLoading } = useHub()

  const [page, setPage]       = useState(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Editor state
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  const textareaRef = useRef(null)

  useEffect(() => {
    if (!slug) return
    setPageLoading(true)
    setEditing(false)
    const load = async () => {
      const { data, error } = await supabase
        .from(T_INFO_PAGES)
        .select('slug, title, content, updated_at')
        .eq('slug', slug)
        .single()
      if (error || !data) { setNotFound(true); setPageLoading(false); return }
      setPage(data)
      setDraft(data.content || '')
      setNotFound(false)
      setPageLoading(false)
    }
    load()
  }, [slug])

  const handleSave = async () => {
    setSaving(true)
    const { error } = await supabase
      .from(T_INFO_PAGES)
      .update({ content: draft, updated_at: new Date().toISOString() })
      .eq('slug', slug)
    setSaving(false)
    if (!error) {
      setPage(p => ({ ...p, content: draft, updated_at: new Date().toISOString() }))
      setEditing(false)
      setPreview(false)
      setSavedMsg(true)
      setTimeout(() => setSavedMsg(false), 3000)
    }
  }

  const handleDiscard = () => {
    setDraft(page?.content || '')
    setEditing(false)
  }

  // Inserts / wraps selected text in the textarea
  const applyFormat = useCallback((type) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end   = el.selectionEnd
    const sel   = draft.slice(start, end)
    let before = draft.slice(0, start)
    let after  = draft.slice(end)
    let insert = ''
    let cursorOffset = 0

    switch (type) {
      case 'h2': {
        // If cursor is mid-line, move wrap to line start
        const lineStart = before.lastIndexOf('\n') + 1
        const prefix = before.slice(lineStart)
        before = before.slice(0, lineStart)
        insert = `## ${prefix}${sel || 'Heading'}`
        cursorOffset = insert.length
        break
      }
      case 'h3': {
        const lineStart = before.lastIndexOf('\n') + 1
        const prefix = before.slice(lineStart)
        before = before.slice(0, lineStart)
        insert = `### ${prefix}${sel || 'Sub-heading'}`
        cursorOffset = insert.length
        break
      }
      case 'bold':
        insert = `**${sel || 'bold text'}**`
        cursorOffset = sel ? insert.length : 2
        break
      case 'italic':
        insert = `*${sel || 'italic text'}*`
        cursorOffset = sel ? insert.length : 1
        break
      case 'ul': {
        const lines = (sel || 'List item').split('\n')
        insert = lines.map(l => `- ${l}`).join('\n')
        // Ensure blank line before list
        if (before && !before.endsWith('\n\n')) {
          insert = (before.endsWith('\n') ? '\n' : '\n\n') + insert
        }
        cursorOffset = insert.length
        break
      }
      case 'ol': {
        const lines = (sel || 'List item').split('\n')
        insert = lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
        if (before && !before.endsWith('\n\n')) {
          insert = (before.endsWith('\n') ? '\n' : '\n\n') + insert
        }
        cursorOffset = insert.length
        break
      }
      case 'hr':
        insert = '\n\n---\n\n'
        cursorOffset = insert.length
        break
      case 'link': {
        const url = sel.startsWith('http') ? sel : 'https://'
        const label = sel.startsWith('http') ? 'Link text' : (sel || 'Link text')
        insert = `[${label}](${url})`
        cursorOffset = insert.length
        break
      }
      default:
        return
    }

    const newDraft = before + insert + after
    setDraft(newDraft)
    // Restore focus + cursor after state update
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(before.length + cursorOffset, before.length + cursorOffset)
    })
  }, [draft])

  if (authLoading || pageLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#325099]">Loading…</p>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="max-w-2xl mx-auto px-8 py-16 text-center">
        <div className="text-4xl mb-3">🔍</div>
        <p className="text-sm font-semibold text-[#2A2035]">Page not found.</p>
        <p className="text-xs text-[#2A2035]/50 mt-1">The slug <code>{slug}</code> doesn't exist in the database.</p>
      </div>
    )
  }

  const isEmpty = !page?.content?.trim()

  return (
    <>
      {/* Prose CSS */}
      <style>{`
        .prose-hub h2   { font-size: 1.2rem; font-weight: 700; color: #062E63; margin: 1.4em 0 0.5em; font-family: var(--font-outfit, sans-serif); }
        .prose-hub h3   { font-size: 1rem;   font-weight: 700; color: #325099; margin: 1.2em 0 0.4em; }
        .prose-hub p    { margin: 0 0 0.75em; line-height: 1.7; color: #2A2035; }
        .prose-hub p:last-child { margin-bottom: 0; }
        .prose-hub ul   { list-style: disc;    padding-left: 1.4em; margin: 0 0 0.75em; }
        .prose-hub ol   { list-style: decimal; padding-left: 1.4em; margin: 0 0 0.75em; }
        .prose-hub li   { margin-bottom: 0.3em; line-height: 1.6; color: #2A2035; }
        .prose-hub strong { font-weight: 700; }
        .prose-hub em     { font-style: italic; }
        .prose-hub hr   { border: none; border-top: 1px solid #DEE7FF; margin: 1.5em 0; }
        .prose-hub code { font-family: monospace; background: #EEF4FF; padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.88em; color: #325099; }
        .prose-hub a    { color: #325099; text-decoration: underline; }
        .prose-hub a:hover { color: #062E63; }
      `}</style>

      <div className="max-w-3xl mx-auto px-6 md:px-10 py-10">

        {/* Page header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
              Info Centre
            </p>
            <h1 className="text-2xl md:text-3xl font-bold text-[#062E63] font-display">
              {page.title}
            </h1>
            {page.updated_at && !editing && (
              <p className="text-[11px] text-[#2A2035]/40 mt-1">
                Last updated{' '}
                {new Date(page.updated_at).toLocaleDateString('en-AU', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </p>
            )}
          </div>
          {isAdmin && !editing && (
            <button
              type="button"
              onClick={() => { setEditing(true); setDraft(page.content || '') }}
              className="shrink-0 text-xs font-semibold text-[#325099] border border-[#DEE7FF] bg-white px-4 py-2 rounded-full hover:bg-[#F8FAFF] hover:border-[#325099] transition"
            >
              ✎ Edit page
            </button>
          )}
        </div>

        {savedMsg && (
          <div className="mb-6 bg-[#D1FAE5] border border-[#A7F3D0] rounded-xl px-4 py-3 text-xs font-semibold text-[#065F46]">
            ✓ Page saved successfully.
          </div>
        )}

        {/* Admin editor */}
        {editing ? (
          <div className="space-y-3">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-1 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-3 py-2">
              {[
                { label: 'H2',  title: 'Heading 2',      type: 'h2',     style: 'font-bold text-[0.8rem]' },
                { label: 'H3',  title: 'Heading 3',      type: 'h3',     style: 'font-semibold text-[0.75rem]' },
              ].map(btn => (
                <button key={btn.type} type="button" title={btn.title}
                  onMouseDown={e => { e.preventDefault(); applyFormat(btn.type) }}
                  className={`px-2.5 py-1 rounded-lg text-[#325099] hover:bg-[#DEE7FF] transition ${btn.style}`}
                >{btn.label}</button>
              ))}
              <span className="w-px h-5 bg-[#DEE7FF] mx-1" />
              {[
                { label: 'B',   title: 'Bold',           type: 'bold',   style: 'font-bold text-sm' },
                { label: 'I',   title: 'Italic',         type: 'italic', style: 'italic text-sm' },
              ].map(btn => (
                <button key={btn.type} type="button" title={btn.title}
                  onMouseDown={e => { e.preventDefault(); applyFormat(btn.type) }}
                  className={`px-2.5 py-1 rounded-lg text-[#325099] hover:bg-[#DEE7FF] transition ${btn.style}`}
                >{btn.label}</button>
              ))}
              <span className="w-px h-5 bg-[#DEE7FF] mx-1" />
              <button type="button" title="Bullet list"
                onMouseDown={e => { e.preventDefault(); applyFormat('ul') }}
                className="px-2.5 py-1 rounded-lg text-[#325099] hover:bg-[#DEE7FF] transition text-sm"
              >≡ List</button>
              <button type="button" title="Numbered list"
                onMouseDown={e => { e.preventDefault(); applyFormat('ol') }}
                className="px-2.5 py-1 rounded-lg text-[#325099] hover:bg-[#DEE7FF] transition text-sm"
              >1. List</button>
              <span className="w-px h-5 bg-[#DEE7FF] mx-1" />
              <button type="button" title="Insert link"
                onMouseDown={e => { e.preventDefault(); applyFormat('link') }}
                className="px-2.5 py-1 rounded-lg text-[#325099] hover:bg-[#DEE7FF] transition text-sm"
              >🔗 Link</button>
              <button type="button" title="Horizontal divider"
                onMouseDown={e => { e.preventDefault(); applyFormat('hr') }}
                className="px-2.5 py-1 rounded-lg text-[#325099] hover:bg-[#DEE7FF] transition text-sm"
              >— Divider</button>
            </div>

            {/* Split pane: editor + live preview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Editor */}
              <div className="flex flex-col">
                <p className="text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/50 mb-1.5 ml-1">Editor</p>
                <textarea
                  ref={textareaRef}
                  autoFocus
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={22}
                  placeholder={`Write content for "${page.title}"…\n\n## Heading\n\nParagraph text here.\n\n- Bullet point\n- Another point\n\n**Bold**, *italic*, [link](https://url.com)`}
                  className="flex-1 bg-white border border-[#DEE7FF] rounded-2xl px-5 py-4 text-sm font-mono text-[#2A2035] placeholder:text-[#2A2035]/25 focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] resize-y transition leading-relaxed min-h-[400px]"
                />
              </div>

              {/* Live preview */}
              <div className="flex flex-col">
                <p className="text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/50 mb-1.5 ml-1">Live preview</p>
                <div className="bg-white rounded-2xl border border-[#DEE7FF] px-6 py-5 min-h-[400px] overflow-auto">
                  {draft.trim() ? (
                    <MarkdownView src={draft} />
                  ) : (
                    <p className="text-sm italic text-[#2A2035]/25 pt-2">Start typing to see a preview…</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="text-sm font-semibold bg-[#325099] text-white px-6 py-2.5 rounded-full hover:bg-[#062E63] transition disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save page'}
              </button>
              <button
                type="button"
                onClick={handleDiscard}
                className="text-sm font-semibold text-[#2A2035]/50 px-5 py-2.5 rounded-full hover:bg-[#F8FAFF] transition"
              >
                Discard
              </button>
            </div>
          </div>
        ) : (
          /* Read-only content */
          <div className="bg-white rounded-2xl border border-[#DEE7FF] px-6 md:px-8 py-7">
            {isEmpty ? (
              <div className="text-center py-10">
                <div className="text-4xl mb-3">📄</div>
                <p className="text-sm font-semibold text-[#2A2035] mb-1">No content yet.</p>
                <p className="text-xs text-[#2A2035]/50">
                  {isAdmin
                    ? 'Click "Edit page" above to add content.'
                    : 'Your admin will add content here soon.'}
                </p>
              </div>
            ) : (
              <MarkdownView src={page.content} />
            )}
          </div>
        )}
      </div>
    </>
  )
}
