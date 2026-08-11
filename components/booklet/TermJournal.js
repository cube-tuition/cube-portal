'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

/*
 * TermJournal — a student's Help Page: an ongoing document for one class, one term.
 *
 * A feed of dated entries the student adds whenever they like (typed text,
 * file uploads, or both — questions, assessment tasks, essay feedback…), which
 * carries over from week to week. Classes are per-term rows, so scoping by
 * class already scopes by term: a new term starts a fresh document.
 *
 * Two modes:
 *   own      the student's view — compose entries, attach files, delete their
 *            own entries, read the teacher's replies.
 *   review   the teacher's view — read everything, reply under any entry.
 *
 * Attachments live in the private `journal-uploads` bucket under
 * <student_uid>/<class_id>/…, and are shown through short-lived signed URLs.
 */

const BUCKET = 'journal-uploads'
const MAX_FILE_MB = 20
const ACCEPT = 'image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt'
const URL_TTL = 3600   // seconds a signed link stays valid; re-signed on each load

const isImage = (a) => /^image\//.test(a.type || '') || /\.(png|jpe?g|gif|webp|heic)$/i.test(a.name || '')
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const fmtWhen = (iso) => new Date(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) +
  ' · ' + new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })

export default function TermJournal({ classId, studentId, mode = 'own', staffId = null }) {
  const own = mode === 'own'
  const [entries, setEntries] = useState(null)      // null = loading
  const [replies, setReplies] = useState({})        // entry id → reply[]
  const [urls, setUrls] = useState({})              // storage path → signed url
  const [err, setErr] = useState('')

  // Composer (student side)
  const [body, setBody] = useState('')
  const [files, setFiles] = useState([])            // File[] waiting to post
  const [posting, setPosting] = useState(false)
  const fileRef = useRef(null)

  // One open reply box at a time (teacher side)
  const [replyFor, setReplyFor] = useState(null)    // entry id
  const [replyBody, setReplyBody] = useState('')

  const load = useCallback(async () => {
    const { data: es, error } = await supabase.from('term_journal_entries')
      .select('*').eq('class_id', classId).eq('student_id', studentId)
      .order('created_at')
    if (error) { setErr('The document could not be opened: ' + error.message); return }
    const { data: rs } = es?.length
      ? await supabase.from('term_journal_replies')
          .select('*').in('entry_id', es.map(e => e.id)).order('created_at')
      : { data: [] }
    const byEntry = {}
    for (const r of rs || []) (byEntry[r.entry_id] ||= []).push(r)
    // Sign every attachment in one round trip. Failures (or an empty list)
    // just leave chips without previews rather than blocking the feed.
    const paths = (es || []).flatMap(e => (e.attachments || []).map(a => a.path)).filter(Boolean)
    let map = {}
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, URL_TTL)
      for (const s of signed || []) if (s.signedUrl && !s.error) map[s.path] = s.signedUrl
    }
    setEntries(es || []); setReplies(byEntry); setUrls(map)
  }, [classId, studentId])

  useEffect(() => { (async () => { await load() })() }, [load])

  const pickFiles = (list) => {
    const picked = Array.from(list || [])
    const ok = [], rejected = []
    for (const f of picked) (f.size > MAX_FILE_MB * 1048576 ? rejected : ok).push(f)
    if (rejected.length) setErr(`${rejected.map(f => f.name).join(', ')} ${rejected.length === 1 ? 'is' : 'are'} over ${MAX_FILE_MB} MB and can’t be attached.`)
    else setErr('')
    setFiles(fs => [...fs, ...ok])
  }

  const post = async () => {
    const text = body.trim()
    if (!text && !files.length) return
    setPosting(true); setErr('')
    try {
      const attachments = []
      for (const f of files) {
        const safe = f.name.replace(/[^\w.\- ]+/g, '_')
        const path = `${studentId}/${classId}/${Date.now()}-${safe}`
        const { error } = await supabase.storage.from(BUCKET).upload(path, f)
        if (error) throw new Error(`${f.name} failed to upload: ${error.message}`)
        attachments.push({ path, name: f.name, size: f.size, type: f.type })
      }
      const { error } = await supabase.from('term_journal_entries').insert({
        class_id: Number(classId), student_id: studentId, body: text, attachments,
      })
      if (error) {
        // The row failed after the files went up — take the files back out so
        // nothing orphaned lingers in the bucket.
        if (attachments.length) await supabase.storage.from(BUCKET).remove(attachments.map(a => a.path))
        throw new Error(error.message)
      }
      setBody(''); setFiles([]); if (fileRef.current) fileRef.current.value = ''
      await load()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setPosting(false)
    }
  }

  const removeEntry = async (entry) => {
    if (!confirm('Delete this entry? Its attachments are deleted too.')) return
    const paths = (entry.attachments || []).map(a => a.path).filter(Boolean)
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
    await supabase.from('term_journal_entries').delete().eq('id', entry.id)
    setEntries(es => es.filter(e => e.id !== entry.id))
  }

  const sendReply = async () => {
    const text = replyBody.trim()
    if (!text || !replyFor) return
    const { data, error } = await supabase.from('term_journal_replies').insert({
      entry_id: replyFor, author_id: staffId, body: text,
    }).select('*').single()
    if (error) { setErr('Reply failed: ' + error.message); return }
    setReplies(m => ({ ...m, [replyFor]: [...(m[replyFor] || []), data] }))
    setReplyFor(null); setReplyBody('')
  }
  const removeReply = async (entryId, id) => {
    await supabase.from('term_journal_replies').delete().eq('id', id)
    setReplies(m => ({ ...m, [entryId]: (m[entryId] || []).filter(r => r.id !== id) }))
  }

  const attachment = (a, i) => {
    const url = urls[a.path]
    if (isImage(a) && url) return (
      <a key={i} href={url} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={a.name} className="max-h-72 rounded-xl border border-[#DEE7FF]" />
      </a>
    )
    return (
      <a key={i} href={url || undefined} target="_blank" rel="noreferrer"
        className={`inline-flex items-center gap-2 text-xs font-semibold border rounded-xl px-3 py-2 ${url
          ? 'text-[#325099] border-[#DEE7FF] bg-white hover:border-[#325099]'
          : 'text-[#2A2035]/40 border-[#E6EAF4] bg-[#F8FAFF] pointer-events-none'}`}>
        📎 <span className="truncate max-w-[240px]">{a.name}</span>
        <span className="font-normal text-[#2A2035]/40">{fmtSize(a.size || 0)}</span>
      </a>
    )
  }

  if (entries === null && !err) return (
    <p className="text-sm text-[#2A2035]/40 py-14 text-center animate-pulse">Opening the document…</p>
  )

  return (
    <div className="max-w-[820px] mx-auto">
      {err && <p className="text-xs text-[#B23A3A] bg-[#FDF1F1] border border-[#F2D6D6] rounded-xl px-4 py-2.5 mb-4">{err}</p>}

      {(entries || []).length === 0 && (
        <div className="bg-white border border-[#DEE7FF] rounded-2xl px-6 py-10 text-center mb-5">
          <p className="text-2xl mb-2">📂</p>
          <p className="text-sm font-semibold text-[#2A2035]">Nothing in this document yet</p>
          <p className="text-xs text-[#2A2035]/50 mt-1 max-w-md mx-auto">
            {own
              ? 'Anything you add stays here for the whole term — questions you want answered, assessment tasks, essays for feedback, photos of working…'
              : 'When this student adds questions, tasks or essays here, they’ll appear for you to review.'}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {(entries || []).map(entry => (
          <div key={entry.id} className="bg-white border border-[#DEE7FF] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-bold text-[#325099]">{fmtWhen(entry.created_at)}</span>
              {own && (
                <button onClick={() => removeEntry(entry)}
                  className="ml-auto text-[11px] text-[#2A2035]/35 hover:text-[#B23A3A]">Delete</button>
              )}
            </div>
            {entry.body && <p className="text-sm text-[#2A2035] whitespace-pre-wrap leading-relaxed">{entry.body}</p>}
            {(entry.attachments || []).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">{entry.attachments.map(attachment)}</div>
            )}

            {/* Teacher replies — amber, matching workbook comments. */}
            {(replies[entry.id] || []).map(r => (
              <div key={r.id} className="mt-3 bg-[#FFFBEF] border border-[#E8D6A8] border-l-[3px] border-l-[#E4B34A] rounded-xl px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-extrabold uppercase tracking-[0.09em] text-[#8a6d1f]">Teacher</span>
                  <span className="text-[10px] text-[#8a6d1f]/60">{fmtWhen(r.created_at)}</span>
                  {!own && (
                    <button onClick={() => removeReply(entry.id, r.id)}
                      className="ml-auto text-[11px] text-[#b9a06a] hover:text-[#B23A3A]">✕</button>
                  )}
                </div>
                <p className="text-[13px] text-[#3b3b3b] whitespace-pre-wrap mt-1">{r.body}</p>
              </div>
            ))}

            {!own && (replyFor === entry.id ? (
              <div className="mt-3">
                <textarea autoFocus value={replyBody} onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Reply to this…"
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply(); if (e.key === 'Escape') { setReplyFor(null); setReplyBody('') } }}
                  className="w-full border border-[#E8D6A8] rounded-xl px-3 py-2 text-sm min-h-[64px] focus:outline-none focus:border-[#D9A227]" />
                <div className="flex justify-end gap-3 mt-1">
                  <button onClick={() => { setReplyFor(null); setReplyBody('') }} className="text-[11px] text-[#2A2035]/45">Cancel</button>
                  <button onClick={sendReply} className="text-[11px] font-bold text-[#325099]">Reply</button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setReplyFor(entry.id); setReplyBody('') }}
                className="mt-3 text-[11px] font-bold text-[#325099] hover:text-[#062E63]">💬 Reply</button>
            ))}
          </div>
        ))}
      </div>

      {/* Composer — student only. */}
      {own && (
        <div className="bg-white border border-[#DEE7FF] rounded-2xl p-5 mt-5">
          <textarea value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Ask a question, or describe what you’re attaching…"
            className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2.5 text-sm min-h-[76px] focus:outline-none focus:border-[#325099]" />
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-2 text-xs font-semibold text-[#325099] bg-[#F4F8FF] border border-[#CBD9F5] rounded-xl px-3 py-1.5">
                  📎 <span className="truncate max-w-[220px]">{f.name}</span>
                  <span className="font-normal text-[#2A2035]/40">{fmtSize(f.size)}</span>
                  <button onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))}
                    className="text-[#8fa6cf] hover:text-[#B23A3A]">✕</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 mt-3">
            <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden"
              onChange={(e) => { pickFiles(e.target.files); e.target.value = '' }} />
            <button onClick={() => fileRef.current?.click()}
              className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-xl px-3 py-2 hover:border-[#325099]">
              📎 Attach files
            </button>
            <span className="text-[10px] text-[#2A2035]/35">Photos, PDFs, docs · up to {MAX_FILE_MB} MB each</span>
            <button onClick={post} disabled={posting || (!body.trim() && !files.length)}
              className="ml-auto text-xs font-bold text-white bg-[#325099] rounded-xl px-4 py-2 hover:bg-[#062E63] transition disabled:opacity-40 disabled:cursor-default">
              {posting ? 'Adding…' : 'Add to document'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
