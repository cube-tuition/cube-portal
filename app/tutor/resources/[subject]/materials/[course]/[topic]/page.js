'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '../../../../../../../lib/supabase'
import { getAuthProfile } from '../../../../../../../lib/getProfile'
import TutorNav from '../../../../../../../components/TutorNav'
import { courseTabs, subjectConfig, statusStyle, bookletPdfs, PDF_BUTTON_STYLE } from '../../../../../../../lib/resourceSubjects'
import OpenInBuilderButton from '../../../../../../../components/booklet/OpenInBuilderButton'
import BookletInfoModal from '../../../../../../../components/booklet/BookletInfoModal'

/*
 * A topic page — /tutor/resources/maths/materials/8/<topic id>
 *
 * Gathers what already exists for one topic of one year: the workbooks filed
 * under it, and the question bank's holdings for the matching topic.
 *
 * Both are matched by NAME against the curriculum topic, because that is the
 * only link the schema offers — booklets.topic is free text, and qbank_topics
 * is a separate tree keyed by (year, subject). Where a name does not match on
 * both sides the section simply reads empty, which is the honest answer.
 */


export default function TopicPage() {
  const router = useRouter()
  const { subject, course, topic: topicId } = useParams()
  const slug = String(subject || '').toLowerCase()
  const cfg = subjectConfig(slug)
  const tab = courseTabs(slug).find((t) => t.key === String(course)) || null

  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [topic, setTopic] = useState(undefined)   // undefined = loading, null = not found
  const [books, setBooks] = useState([])
  const [builds, setBuilds] = useState({})        // booklet_id -> build id
  const [bank, setBank] = useState(null)          // { total, subtopics: [{name, n}] }
  const [sheets, setSheets] = useState(null)      // worksheets filed under this topic
  const [infoFor, setInfoFor] = useState(null)
  const [topicBank, setTopicBank] = useState([])
  const [nonce, setNonce] = useState(0)              // bump to re-read after an edit
  const reload = () => setNonce((n) => n + 1)


  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
    })
  }, [router])

  useEffect(() => {
    if (!tab || !topicId) return
    let dead = false
    ;(async () => {
      const { data: t } = await supabase
        .from('topics').select('id, name, year, subject').eq('id', topicId).maybeSingle()
      if (dead) return
      // Guard against a topic id that belongs to a different year/course.
      if (!t || t.year !== tab.year || t.subject !== tab.subject) { setTopic(null); return }
      setTopic(t)

      // Workbooks filed under this topic name.
      const { data: bs } = await supabase
        .from('booklets').select('id, booklet_name, status, file_path, file_paths, pdf_filenames')
        .eq('year', t.year).eq('subject', t.subject).ilike('topic', t.name)
        .order('booklet_name')
      if (dead) return
      const { data: bd } = bs?.length
        ? await supabase.from('booklet_builds')
            .select('id, booklet_id, doc_type').in('booklet_id', bs.map((b) => b.id))
        : { data: [] }
      if (dead) return
      // A pre-test or level test belongs to the Tests page, not here, even
      // though publishing one creates a booklets row like any other workbook.
      const notAWorkbook = new Set((bd || [])
        .filter((x) => (x.doc_type ?? 'booklet') !== 'booklet').map((x) => x.booklet_id))
      setBooks((bs || []).filter((b) => !notAWorkbook.has(b.id)))
      setBuilds(Object.fromEntries((bd || []).map((b) => [b.booklet_id, b.id])))

      const { data: bank } = await supabase.from('topics').select('id, name')
        .eq('year', t.year).eq('subject', t.subject).order('name')
      if (!dead) setTopicBank(bank || [])

      // Additional-questions worksheets filed under this topic.
      const { data: ws } = await supabase.from('qbank_worksheets')
        .select('id, title, subtitle, question_ids, include_marks, updated_at')
        .eq('topic_id', t.id).order('title')
      if (!dead) setSheets(ws || [])

      // The question bank's matching topic, and what sits under it.
      const { data: subj } = await supabase
        .from('qbank_subjects').select('id').eq('year_level', t.year).eq('name', t.subject).maybeSingle()
      if (dead) return
      if (!subj) { setBank({ total: 0, subtopics: [] }); return }
      const { data: qt } = await supabase
        .from('qbank_topics').select('id').eq('subject_id', subj.id).ilike('name', t.name).maybeSingle()
      if (dead) return
      if (!qt) { setBank({ total: 0, subtopics: [] }); return }
      const { data: subs } = await supabase
        .from('qbank_subtopics').select('id, name').eq('topic_id', qt.id).order('name')
      if (dead) return
      const counts = await Promise.all((subs || []).map(async (s) => {
        const { count } = await supabase.from('qbank_questions')
          .select('id', { count: 'exact', head: true }).eq('subtopic_id', s.id)
        return { name: s.name, n: count || 0 }
      }))
      // The total comes from topic_id, not from summing the subtopics: some
      // questions carry a topic but no subtopic, and summing would lose them.
      const { count: total } = await supabase.from('qbank_questions')
        .select('id', { count: 'exact', head: true }).eq('topic_id', qt.id)
      const { count: unfiled } = await supabase.from('qbank_questions')
        .select('id', { count: 'exact', head: true }).eq('topic_id', qt.id).is('subtopic_id', null)
      if (!dead) setBank({ total: total || 0, unfiled: unfiled || 0, subtopics: counts })
    })()
    return () => { dead = true }
  }, [tab, topicId, nonce])

  if (!cfg || !tab || topic === null) {
    return (
      <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center">
        <p className="text-sm text-[#2A2035]/50">
          Unknown topic.{' '}
          <Link href={cfg && tab ? `/tutor/resources/${slug}/materials/${tab.key}` : '/tutor'}
            className="text-[#325099] underline">Back</Link>
        </p>
      </div>
    )
  }
  if (!ready || topic === undefined) {
    return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>
  }


  const pdfUrl = (path) => supabase.storage.from('booklets').getPublicUrl(path).data?.publicUrl

  const Empty = ({ children }) => (
    <div className="bg-white rounded-2xl border border-dashed border-[#DEE7FF] px-6 py-7 text-center">
      <p className="text-xs text-[#2A2035]/45">{children}</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-5xl mx-auto px-6 pt-10 pb-16">
        <nav className="text-[11px] text-[#2A2035]/45 mb-3">
          <Link href={`/tutor/resources/${slug}`} className="hover:text-[#325099]">{cfg.label}</Link>
          <span className="mx-1.5">›</span>
          <Link href={`/tutor/resources/${slug}/materials`} className="hover:text-[#325099]">Materials</Link>
          <span className="mx-1.5">›</span>
          <Link href={`/tutor/resources/${slug}/materials/${tab.key}`} className="hover:text-[#325099]">{tab.label}</Link>
          <span className="mx-1.5">›</span>
          <span className="text-[#2A2035]/70 font-semibold">{topic.name}</span>
        </nav>

        <div className="rounded-2xl px-7 py-6 mb-8 border" style={{ background: cfg.tint, borderColor: cfg.border }}>
          <h1 className="text-2xl font-bold" style={{ color: cfg.accent }}>{topic.name}</h1>
          <p className="text-xs text-[#2A2035]/55 mt-0.5">{tab.label} · {topic.subject}</p>
        </div>

        {/* Workbooks filed under this topic */}
        <h2 className="text-[10px] font-bold tracking-widest uppercase text-[#325099]/60 mb-2.5">
          Workbooks {books.length > 0 && <span className="text-[#2A2035]/35">· {books.length}</span>}
        </h2>
        {books.length === 0 ? (
          <Empty>No workbook is filed under “{topic.name}” for {tab.label}.</Empty>
        ) : (
          <div className="space-y-2">
            {books.map((b) => {
              const st = statusStyle(b.status)
              const build = builds[b.id]
              return (
                <div key={b.id} className="bg-white rounded-xl border border-[#F0F4FF] px-4 py-3 flex items-center gap-3">
                  <span className="text-sm font-semibold text-[#2A2035] flex-1 min-w-0 truncate">{b.booklet_name}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0"
                    style={{ background: st.bg, color: st.fg, borderColor: st.bd }}>{b.status || 'Not Started'}</span>
                  <button
                  onClick={() => setInfoFor(b)}
                  title="Term, week, topic, notes and the improvement checklists"
                  className="text-[11px] font-semibold shrink-0 text-[#325099]/70 hover:text-[#325099] hover:underline transition">
                  &#8505; Info
                  </button>
                  {bookletPdfs(b).map((p) => (
                  <a key={p.path} href={pdfUrl(p.path)} target="_blank" rel="noopener noreferrer"
                  title={p.isSolutions ? 'Solutions copy' : 'Student copy'}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 transition hover:brightness-95"
                  style={PDF_BUTTON_STYLE(p.isSolutions)}>
                  {p.label}
                  </a>
                  ))}
                  <OpenInBuilderButton
                    booklet={b} buildId={build} year={tab.year} subject={tab.subject}
                    accent={cfg.accent}
                    onCreated={(bid, id) => setBuilds((m) => ({ ...m, [bid]: id }))} />
                </div>
              )
            })}
          </div>
        )}

        {/* Additional Questions — worksheets filed under this topic */}
        <h2 className="text-[10px] font-bold tracking-widest uppercase text-[#325099]/60 mt-9 mb-2.5">
          Additional Questions {sheets?.length > 0 && <span className="text-[#2A2035]/35">· {sheets.length}</span>}
        </h2>
        {sheets === null ? (
          <p className="text-xs text-[#2A2035]/40 animate-pulse">Loading…</p>
        ) : sheets.length === 0 ? (
          <Empty>
            No worksheet is filed under &ldquo;{topic.name}&rdquo;. Open one in the worksheet
            builder and pick this topic to have it appear here.
          </Empty>
        ) : (
          <div className="space-y-2">
            {sheets.map((w) => (
              <a key={w.id} href={`/tutor/qbank/worksheets?ws=${w.id}`}
                className="group bg-white rounded-xl border border-[#F0F4FF] px-4 py-3 flex items-center gap-3 hover:shadow-md transition">
                <span className="text-sm font-semibold text-[#2A2035] flex-1 min-w-0 truncate group-hover:underline">{w.title}</span>
                {w.subtitle && <span className="text-[11px] text-[#2A2035]/40 shrink-0 max-w-[35%] truncate">{w.subtitle}</span>}
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0"
                  style={{ background: cfg.tint, color: cfg.accent, borderColor: cfg.border }}>
                  {(w.question_ids || []).length} question{(w.question_ids || []).length === 1 ? '' : 's'}
                </span>
                <span className="text-[11px] font-semibold shrink-0" style={{ color: cfg.accent }}>Open →</span>
              </a>
            ))}
          </div>
        )}
        {bank?.total > 0 && (
          <p className="text-[11px] text-[#2A2035]/45 mt-2.5">
            The question bank holds {bank.total} question{bank.total === 1 ? '' : 's'} under this topic.{' '}
            <Link href={`/tutor/qbank?subject=${cfg.value}`} className="font-semibold hover:underline"
              style={{ color: cfg.accent }}>Browse the bank →</Link>
          </p>
        )}

        <Link href={`/tutor/resources/${slug}/materials/${tab.key}`}
          className="inline-block text-[11px] font-semibold mt-9 hover:underline" style={{ color: cfg.accent }}>
          ← Back to {tab.label}
        </Link>
      </div>

      {/* Everything about one workbook — term, week, topic, notes and the
          improvement checklists. The modal re-reads the full booklets row on
          open, so the trimmed row these pages hold is enough to launch it. */}
      <BookletInfoModal
        booklet={infoFor}
        title={infoFor ? `${infoFor.year ?? tab.year}.M. ${infoFor.booklet_name}` : ''}
        staff={profile}
        topicBank={topicBank}
        onClose={() => { setInfoFor(null); reload() }}
        onChanged={(patch) => setBooks((bs) => bs.map((x) => (x.id === infoFor.id ? { ...x, ...patch } : x)))}
      />
    </div>
  )
}
