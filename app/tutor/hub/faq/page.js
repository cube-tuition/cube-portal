'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { useHub } from '../context'

/*
 * /tutor/hub/faq  — FAQ page inside the hub sidebar layout.
 * Auth/isAdmin come from HubContext (provided by the hub layout).
 * No standalone TutorNav — the layout handles that.
 */

// ─── Markdown renderer ────────────────────────────────────────────────────────
function renderMarkdown(src) {
  if (!src) return ''
  const escape = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const blocks = src.split(/\n{2,}/)
  return blocks.map(block => {
    const lines = block.split('\n')
    if (lines.every(l => /^[-*]\s/.test(l.trim())))
      return `<ul>${lines.map(l => `<li>${inlineMd(escape(l.replace(/^[-*]\s/, '')))}</li>`).join('')}</ul>`
    if (lines.every(l => /^\d+\.\s/.test(l.trim())))
      return `<ol>${lines.map(l => `<li>${inlineMd(escape(l.replace(/^\d+\.\s/, '')))}</li>`).join('')}</ol>`
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
function MarkdownView({ src, className = '' }) {
  return (
    <div className={`prose-faq ${className}`}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(src) }} />
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function HubFAQPage() {
  const { isAdmin, loading: authLoading } = useHub()

  const [categories, setCategories] = useState([])
  const [faqLoading, setFaqLoading] = useState(true)
  const [newCatTitle, setNewCatTitle] = useState('')
  const [addingCat, setAddingCat]     = useState(false)

  useEffect(() => {
    if (authLoading) return
    fetchFAQ()
  }, [authLoading])

  const fetchFAQ = async () => {
    setFaqLoading(true)
    const { data: cats }  = await supabase
      .from('faq_categories')
      .select('id, title, sort_order')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    const { data: items } = await supabase
      .from('faq_items')
      .select('id, category_id, question, answer, sort_order')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    const catMap = {}
    for (const c of cats || []) catMap[c.id] = { ...c, items: [] }
    for (const i of items || []) {
      if (catMap[i.category_id]) catMap[i.category_id].items.push(i)
    }
    setCategories(Object.values(catMap))
    setFaqLoading(false)
  }

  const handleAddCategory = async () => {
    const title = newCatTitle.trim()
    if (!title) return
    setAddingCat(true)
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order), 0)
    await supabase.from('faq_categories').insert({ title, sort_order: maxOrder + 1 })
    setNewCatTitle('')
    setAddingCat(false)
    await fetchFAQ()
  }

  if (authLoading || faqLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#325099]">Loading FAQ…</p>
      </div>
    )
  }

  return (
    <>
      <style>{`
        .prose-faq p  { margin: 0 0 0.6em; line-height: 1.65; }
        .prose-faq p:last-child { margin-bottom: 0; }
        .prose-faq ul { list-style: disc; padding-left: 1.25em; margin: 0 0 0.6em; }
        .prose-faq ol { list-style: decimal; padding-left: 1.25em; margin: 0 0 0.6em; }
        .prose-faq li { margin-bottom: 0.2em; }
        .prose-faq strong { font-weight: 700; }
        .prose-faq em     { font-style: italic; }
        .prose-faq code   { font-family: monospace; background: #EEF4FF; padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.9em; }
        .prose-faq a      { color: #325099; text-decoration: underline; }
        .prose-faq a:hover { color: #062E63; }
      `}</style>

      <div className="max-w-3xl mx-auto px-6 md:px-10 py-10">
        {/* Header */}
        <div className="mb-8">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1 font-display">
            Info Centre
          </p>
          <h1 className="text-2xl md:text-3xl font-bold text-[#062E63] font-display">
            Frequently Asked Questions
          </h1>
          {isAdmin && (
            <p className="text-xs text-[#2A2035]/50 mt-1">
              Admin mode — you can add, edit, and delete categories and questions below.
            </p>
          )}
        </div>

        {/* Empty state (tutor only) */}
        {categories.length === 0 && !isAdmin && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-sm font-semibold text-[#2A2035] mb-1">No FAQs yet.</p>
            <p className="text-xs text-[#2A2035]/60">Check back soon — your admin will add answers here.</p>
          </div>
        )}

        {/* Categories */}
        <div className="space-y-6">
          {categories.map(cat => (
            <CategorySection key={cat.id} cat={cat} isAdmin={isAdmin} onRefresh={fetchFAQ} />
          ))}
        </div>

        {/* Admin: add new category */}
        {isAdmin && (
          <div className="mt-8 bg-white rounded-2xl border border-dashed border-[#325099]/30 p-5">
            <p className="text-[10px] tracking-[0.25em] uppercase font-semibold text-[#325099] mb-3">
              Add new category
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                value={newCatTitle}
                onChange={e => setNewCatTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                placeholder="e.g. Payroll, Booklets, General…"
                className="flex-1 bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-4 py-2.5 text-sm text-[#2A2035] placeholder:text-[#2A2035]/30 focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition"
              />
              <button type="button" onClick={handleAddCategory}
                disabled={addingCat || !newCatTitle.trim()}
                className="text-xs font-semibold bg-[#325099] text-white px-5 py-2.5 rounded-xl hover:bg-[#062E63] transition disabled:opacity-50">
                {addingCat ? 'Adding…' : '+ Add category'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Category section ─────────────────────────────────────────────────────────
function CategorySection({ cat, isAdmin, onRefresh }) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft]     = useState(cat.title)
  const [savingTitle, setSavingTitle]   = useState(false)
  const [deleting, setDeleting]         = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addingQ, setAddingQ]           = useState(false)
  const [newQuestion, setNewQuestion]   = useState('')
  const [newAnswer, setNewAnswer]       = useState('')
  const [savingQ, setSavingQ]           = useState(false)

  const handleRenameCategory = async () => {
    const title = titleDraft.trim()
    if (!title || title === cat.title) { setEditingTitle(false); return }
    setSavingTitle(true)
    await supabase.from('faq_categories').update({ title }).eq('id', cat.id)
    setSavingTitle(false)
    setEditingTitle(false)
    onRefresh()
  }

  const handleDeleteCategory = async () => {
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 4000); return }
    setDeleting(true)
    await supabase.from('faq_categories').delete().eq('id', cat.id)
    onRefresh()
  }

  const handleAddQuestion = async () => {
    const q = newQuestion.trim()
    const a = newAnswer.trim()
    if (!q) return
    setSavingQ(true)
    const maxOrder = cat.items.reduce((m, i) => Math.max(m, i.sort_order), 0)
    await supabase.from('faq_items').insert({
      category_id: cat.id, question: q, answer: a, sort_order: maxOrder + 1,
    })
    setNewQuestion(''); setNewAnswer(''); setAddingQ(false); setSavingQ(false)
    onRefresh()
  }

  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      <div className="px-5 md:px-6 py-4 border-b border-[#DEE7FF] flex items-center justify-between gap-3 bg-[#F8FAFF]">
        {editingTitle ? (
          <input autoFocus type="text" value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRenameCategory()
              if (e.key === 'Escape') { setEditingTitle(false); setTitleDraft(cat.title) }
            }}
            className="flex-1 bg-white border border-[#325099] rounded-lg px-3 py-1.5 text-sm font-semibold text-[#062E63] focus:outline-none focus:ring-2 focus:ring-[#325099]/20" />
        ) : (
          <h2 className="text-sm font-bold text-[#062E63] tracking-wide uppercase font-display flex-1">
            {cat.title}
            <span className="ml-2 text-[11px] font-normal text-[#325099]/50 normal-case">
              {cat.items.length} question{cat.items.length === 1 ? '' : 's'}
            </span>
          </h2>
        )}
        {isAdmin && (
          <div className="flex items-center gap-1 shrink-0">
            {editingTitle ? (
              <>
                <button onClick={handleRenameCategory} disabled={savingTitle}
                  className="text-[11px] font-semibold text-[#065F46] bg-[#D1FAE5] px-3 py-1 rounded-full hover:bg-[#A7F3D0] transition disabled:opacity-50">
                  {savingTitle ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => { setEditingTitle(false); setTitleDraft(cat.title) }}
                  className="text-[11px] font-semibold text-[#2A2035]/50 px-2 py-1 rounded-full hover:bg-[#F8FAFF] transition">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setEditingTitle(true)}
                  className="text-[11px] font-semibold text-[#325099] px-3 py-1 rounded-full hover:bg-[#DEE7FF] transition">
                  Rename
                </button>
                <button onClick={handleDeleteCategory} disabled={deleting}
                  className={`text-[11px] font-semibold px-3 py-1 rounded-full transition ${
                    confirmDelete ? 'bg-[#FEE2E2] text-[#991B1B] hover:bg-[#FECACA]' : 'text-[#991B1B]/70 hover:bg-[#FEE2E2]'
                  } disabled:opacity-50`}>
                  {deleting ? 'Deleting…' : confirmDelete ? 'Confirm delete?' : 'Delete'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {cat.items.length === 0 && !isAdmin && (
        <div className="px-6 py-5 text-xs text-[#2A2035]/40 italic">No questions in this category yet.</div>
      )}

      <div className="divide-y divide-[#DEE7FF]">
        {cat.items.map(item => (
          <FAQItem key={item.id} item={item} isAdmin={isAdmin} onRefresh={onRefresh} />
        ))}
      </div>

      {isAdmin && (
        <div className="border-t border-dashed border-[#DEE7FF]">
          {addingQ ? (
            <div className="px-5 md:px-6 py-5 space-y-3">
              <input autoFocus type="text" value={newQuestion}
                onChange={e => setNewQuestion(e.target.value)}
                placeholder="Question…"
                className="w-full bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-4 py-2.5 text-sm text-[#2A2035] placeholder:text-[#2A2035]/30 focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition" />
              <textarea value={newAnswer} onChange={e => setNewAnswer(e.target.value)}
                placeholder="Answer (markdown supported — **bold**, *italic*, - lists, [link](url))…"
                rows={4}
                className="w-full bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-4 py-2.5 text-sm text-[#2A2035] placeholder:text-[#2A2035]/30 focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition resize-y font-mono" />
              <div className="flex gap-2">
                <button type="button" onClick={handleAddQuestion} disabled={savingQ || !newQuestion.trim()}
                  className="text-xs font-semibold bg-[#325099] text-white px-5 py-2 rounded-full hover:bg-[#062E63] transition disabled:opacity-50">
                  {savingQ ? 'Saving…' : 'Save question'}
                </button>
                <button type="button" onClick={() => { setAddingQ(false); setNewQuestion(''); setNewAnswer('') }}
                  className="text-xs font-semibold text-[#2A2035]/50 px-4 py-2 rounded-full hover:bg-[#F8FAFF] transition">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setAddingQ(true)}
              className="w-full px-5 md:px-6 py-3.5 text-left text-xs font-semibold text-[#325099] hover:bg-[#F8FAFF] transition flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[#DEE7FF] text-[#325099] flex items-center justify-center text-[13px] leading-none font-bold">+</span>
              Add question
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── FAQ item ─────────────────────────────────────────────────────────────────
function FAQItem({ item, isAdmin, onRefresh }) {
  const [open, setOpen]         = useState(false)
  const [editing, setEditing]   = useState(false)
  const [qDraft, setQDraft]     = useState(item.question)
  const [aDraft, setADraft]     = useState(item.answer)
  const [saving, setSaving]     = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [preview, setPreview]   = useState(false)

  const handleSave = async () => {
    const question = qDraft.trim(); const answer = aDraft.trim()
    if (!question) return
    setSaving(true)
    await supabase.from('faq_items').update({ question, answer, updated_at: new Date().toISOString() }).eq('id', item.id)
    setSaving(false); setEditing(false); onRefresh()
  }

  const handleDelete = async () => {
    if (!confirmDel) { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 4000); return }
    setDeleting(true)
    await supabase.from('faq_items').delete().eq('id', item.id)
    onRefresh()
  }

  if (editing) {
    return (
      <div className="px-5 md:px-6 py-5 space-y-3 bg-[#FAFBFF]">
        <input autoFocus type="text" value={qDraft} onChange={e => setQDraft(e.target.value)}
          placeholder="Question…"
          className="w-full bg-white border border-[#325099] rounded-xl px-4 py-2.5 text-sm font-semibold text-[#062E63] focus:outline-none focus:ring-2 focus:ring-[#325099]/20 transition" />
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70">
              Answer {preview ? '(preview)' : '(markdown)'}
            </label>
            <button type="button" onClick={() => setPreview(p => !p)}
              className="text-[10px] font-semibold text-[#325099] hover:text-[#062E63] transition">
              {preview ? '← Edit' : 'Preview →'}
            </button>
          </div>
          {preview ? (
            <div className="bg-white border border-[#DEE7FF] rounded-xl px-4 py-3 min-h-[100px] text-sm text-[#2A2035]">
              <MarkdownView src={aDraft} />
            </div>
          ) : (
            <textarea value={aDraft} onChange={e => setADraft(e.target.value)} rows={6}
              placeholder="**bold**, *italic*, - lists, [link](url)…"
              className="w-full bg-white border border-[#DEE7FF] rounded-xl px-4 py-2.5 text-sm text-[#2A2035] placeholder:text-[#2A2035]/30 focus:outline-none focus:ring-2 focus:ring-[#325099]/20 focus:border-[#325099] transition resize-y font-mono" />
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={handleSave} disabled={saving || !qDraft.trim()}
            className="text-xs font-semibold bg-[#325099] text-white px-5 py-2 rounded-full hover:bg-[#062E63] transition disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => { setEditing(false); setQDraft(item.question); setADraft(item.answer); setPreview(false) }}
            className="text-xs font-semibold text-[#2A2035]/50 px-4 py-2 rounded-full hover:bg-[#F8FAFF] transition">
            Cancel
          </button>
          <button type="button" onClick={handleDelete} disabled={deleting}
            className={`ml-auto text-xs font-semibold px-4 py-2 rounded-full transition ${
              confirmDel ? 'bg-[#FEE2E2] text-[#991B1B]' : 'text-[#991B1B]/60 hover:bg-[#FEE2E2]'
            } disabled:opacity-50`}>
            {deleting ? 'Deleting…' : confirmDel ? 'Confirm delete?' : 'Delete'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full px-5 md:px-6 py-4 flex items-start justify-between gap-4 text-left hover:bg-[#FAFBFF] transition group">
        <span className="text-sm font-semibold text-[#2A2035] group-hover:text-[#062E63] transition leading-snug flex-1">
          {item.question}
        </span>
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          {isAdmin && (
            <span role="button" tabIndex={0}
              onClick={e => { e.stopPropagation(); setEditing(true) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setEditing(true) } }}
              className="text-[10px] font-semibold text-[#325099] px-2.5 py-1 rounded-full hover:bg-[#DEE7FF] transition opacity-0 group-hover:opacity-100">
              Edit
            </span>
          )}
          <span className={`text-[#325099] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▾</span>
        </div>
      </button>
      {open && (
        <div className="px-5 md:px-6 pb-5 pt-1">
          <div className="bg-[#F8FAFF] rounded-xl border border-[#DEE7FF] px-4 py-3.5 text-sm text-[#2A2035]/80 leading-relaxed">
            {item.answer
              ? <MarkdownView src={item.answer} />
              : <span className="italic text-[#2A2035]/30">No answer yet.</span>}
          </div>
        </div>
      )}
    </div>
  )
}
