'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { exportBookletPdf } from '../../../../lib/bookletExport'
import { bookletPdfName } from '../../../../lib/bookletNaming'

/*
 * Bulk republish — /tutor/booklets/republish
 *
 * Re-renders the PDFs of every published workbook and swaps them in, without
 * changing a single block of content. It exists because a booklet's PDF is a
 * picture of the page taken in whichever browser pressed Publish: when the body
 * font changed from a local Avenir to a web font, every PDF published before
 * that kept the old type (and, on machines without Avenir, the wrong metrics
 * and a cropped footer). Only a re-render fixes those.
 *
 * It must run in a logged-in browser: exportBookletPdf needs a DOM, and the
 * uploads run as the signed-in user.
 *
 * Deliberately sequential. Each workbook renders two full PDFs at 2x, which is
 * heavy; running them in parallel would starve the tab and risk half-written
 * uploads. Progress is per workbook, and a failure is recorded and skipped
 * rather than stopping the run.
 */

const IDLE = 'idle', RUNNING = 'running', DONE = 'done'

export default function RepublishPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [rows, setRows] = useState(null)
  const [state, setState] = useState(IDLE)
  const [cur, setCur] = useState(null)       // { id, label, pct }
  const [log, setLog] = useState({})         // build id -> 'done' | 'skipped' | error text
  const cancelled = useRef(false)

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      // Republishing rewrites shared curriculum files — directors only.
      if (!profile || !['admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
    })
  }, [router])

  useEffect(() => {
    if (!ready) return
    supabase.from('booklet_builds')
      .select('id, title, year, subject, topic, doc_type, cover, delivery, booklet_id, blocks')
      .eq('status', 'published')
      .order('subject').order('year').order('title')
      .then(({ data }) => setRows((data || []).filter((b) => b.delivery !== 'online' && b.booklet_id)))
  }, [ready])

  const republish = useCallback(async (b) => {
    const meta = {
      subject: b.subject, year: b.year, topic: b.topic, name: b.title,
      docType: b.doc_type || 'booklet', cover: b.cover || null, delivery: b.delivery || 'physical',
    }
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const subjectLower = (b.subject || 'mathematics').toLowerCase()
    let fontEmbedCSS

    // Same two copies, same order, same naming as the builder's own publish.
    const upload = async (solutions, tag, from, to) => {
      const res = await exportBookletPdf({
        meta, blocks: b.blocks, solutions, preview: true, fontEmbedCSS,
        onProgress: (f) => setCur((c) => c && { ...c, pct: Math.round((from + (to - from) * f) * 100) }),
      })
      fontEmbedCSS = fontEmbedCSS || res.fontEmbedCSS
      const path = `y${b.year}/${subjectLower}/${stamp}_${tag}.pdf`
      const { error } = await supabase.storage.from('booklets')
        .upload(path, res.blob, { upsert: true, contentType: 'application/pdf' })
      if (error) throw new Error(`upload ${tag}: ${error.message}`)
      return path
    }

    const studentPath = await upload(false, 'student', 0, 0.5)
    const solutionsPath = await upload(true, 'solutions', 0.5, 0.98)
    const filePaths = [studentPath, solutionsPath]
    const meta2 = { year: b.year, subject: b.subject, title: b.title }

    // Keep the old paths so they can be cleaned up only after the swap lands.
    const { data: before } = await supabase.from('booklets')
      .select('file_path, file_paths').eq('id', b.booklet_id).maybeSingle()
    const old = before?.file_paths?.length ? before.file_paths : (before?.file_path ? [before.file_path] : [])

    const { error: upErr } = await supabase.from('booklets').update({
      file_path: studentPath, file_paths: filePaths,
      pdf_filenames: [bookletPdfName(meta2, 'S'), bookletPdfName(meta2, 'T')],
    }).eq('id', b.booklet_id)
    if (upErr) throw new Error(`booklets row: ${upErr.message}`)

    const orphaned = old.filter((p) => p && !filePaths.includes(p))
    if (orphaned.length) await supabase.storage.from('booklets').remove(orphaned)
  }, [])

  const runAll = useCallback(async () => {
    if (!rows?.length) return
    cancelled.current = false
    setState(RUNNING); setLog({})
    for (const b of rows) {
      if (cancelled.current) break
      setCur({ id: b.id, label: `${b.year}. ${b.title}`, pct: 0 })
      try {
        await republish(b)
        setLog((l) => ({ ...l, [b.id]: 'done' }))
      } catch (e) {
        setLog((l) => ({ ...l, [b.id]: e.message || 'failed' }))
      }
    }
    setCur(null)
    setState(cancelled.current ? IDLE : DONE)
  }, [rows, republish])

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const done = Object.values(log).filter((v) => v === 'done').length
  const failed = Object.entries(log).filter(([, v]) => v !== 'done')

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />
      <div className="max-w-4xl mx-auto px-6 pt-10 pb-16">
        <nav className="text-[11px] text-[#2A2035]/45 mb-3">
          <Link href="/tutor/resources/maths" className="hover:text-[#325099]">Resources</Link>
          <span className="mx-1.5">›</span><span className="text-[#2A2035]/70 font-semibold">Republish PDFs</span>
        </nav>

        <div className="rounded-2xl px-7 py-6 mb-6 border bg-[#EEF4FF] border-[#DEE7FF]">
          <h1 className="text-2xl font-bold text-[#325099]">Republish workbook PDFs</h1>
          <p className="text-xs text-[#2A2035]/60 mt-1.5 leading-relaxed">
            Re-renders both PDFs for every published workbook and swaps them in. No content is
            changed — only the files are rebuilt, so they pick up the current booklet type.
            Leave this tab open and in the foreground; it renders one workbook at a time and a
            full run takes a while.
          </p>
        </div>

        {rows === null ? (
          <p className="text-xs text-[#2A2035]/40 animate-pulse">Loading workbooks…</p>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-5">
              <button
                onClick={runAll}
                disabled={state === RUNNING || !rows.length}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#325099] rounded-lg hover:bg-[#062E63] transition disabled:opacity-40">
                {state === RUNNING ? 'Republishing…' : `Republish all ${rows.length}`}
              </button>
              {state === RUNNING && (
                <button onClick={() => { cancelled.current = true }}
                  className="px-4 py-2 text-xs font-semibold text-[#991B1B] bg-white border border-[#FCA5A5] rounded-lg hover:bg-[#FEF2F2] transition">
                  Stop after this one
                </button>
              )}
              <span className="text-[11px] text-[#2A2035]/50">
                {done} of {rows.length} done{failed.length > 0 && ` · ${failed.length} failed`}
              </span>
            </div>

            {cur && (
              <div className="bg-white rounded-xl border border-[#DEE7FF] px-4 py-3 mb-5">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold text-[#2A2035]">{cur.label}</span>
                  <span className="text-[#325099] tabular-nums">{cur.pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#EEF4FF] overflow-hidden">
                  <div className="h-full bg-[#325099] transition-all" style={{ width: `${cur.pct}%` }} />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              {rows.map((b) => {
                const st = log[b.id]
                return (
                  <div key={b.id} className="bg-white rounded-lg border border-[#F0F4FF] px-3.5 py-2 flex items-center gap-3 text-xs">
                    <span className="text-[10px] font-bold text-[#325099]/50 w-20 shrink-0">{b.subject}</span>
                    <span className="w-8 shrink-0 text-[#2A2035]/40">Y{b.year}</span>
                    <span className="flex-1 min-w-0 truncate font-semibold text-[#2A2035]">{b.title}</span>
                    {cur?.id === b.id ? <span className="text-[#325099] shrink-0">rendering…</span>
                      : st === 'done' ? <span className="text-[#047857] shrink-0">✓ republished</span>
                      : st ? <span className="text-[#B91C1C] shrink-0 max-w-[45%] truncate" title={st}>{st}</span>
                      : <span className="text-[#2A2035]/25 shrink-0">waiting</span>}
                  </div>
                )
              })}
            </div>

            {state === DONE && (
              <p className="text-xs mt-5 font-semibold" style={{ color: failed.length ? '#B91C1C' : '#047857' }}>
                {failed.length
                  ? `Finished with ${failed.length} failure${failed.length === 1 ? '' : 's'} — those workbooks keep their existing PDFs.`
                  : 'All workbooks republished.'}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
