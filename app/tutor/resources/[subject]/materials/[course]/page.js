'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '../../../../../../lib/supabase'
import { getAuthProfile } from '../../../../../../lib/getProfile'
import TutorNav from '../../../../../../components/TutorNav'
import { MATERIAL_AREAS, courseTabs, subjectConfig, statusStyle, bookletPdfs, PDF_BUTTON_STYLE } from '../../../../../../lib/resourceSubjects'
import OpenInBuilderButton from '../../../../../../components/booklet/OpenInBuilderButton'
import BookletInfoModal from '../../../../../../components/booklet/BookletInfoModal'

/*
 * A year/course page under Materials —
 *   /tutor/resources/maths/materials/8
 *   /tutor/resources/maths/materials/11-ext1
 *
 * Lists the topics assigned to that year, and links on to Workbooks and
 * Additional Questions already scoped to it. Topics come from the `topics`
 * table, which is keyed by (year, subject) — the senior streams are separate
 * subjects at the same year, which is why a course key rather than a bare year
 * identifies the page.
 */
export default function MaterialsCoursePage() {
  const router = useRouter()
  const { subject, course } = useParams()
  const slug = String(subject || '').toLowerCase()
  const cfg = subjectConfig(slug)
  const tabs = courseTabs(slug)
  const tab = tabs.find((t) => t.key === String(course)) || null

  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [topics, setTopics] = useState(null)   // null = still loading
  const [unfiled, setUnfiled] = useState(null) // workbooks whose topic matches no curriculum topic
  const [builds, setBuilds] = useState({})     // booklet_id -> build id
  const [infoFor, setInfoFor] = useState(null)
  const [nonce, setNonce] = useState(0)              // bump to re-read after an edit
  const reload = () => setNonce((n) => n + 1)


  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
    })
  }, [router])

  useEffect(() => {
    if (!tab) return
    let dead = false
    ;(async () => {
      const { data: ts } = await supabase.from('topics').select('id, name')
        .eq('year', tab.year).eq('subject', tab.subject).order('name')
      if (dead) return
      setTopics(ts || [])

      // Workbooks that no topic page will ever show: their topic is blank, or
      // it does not match any curriculum topic name for this year. Surfacing
      // them here keeps them findable and makes the mismatch visible.
      const { data: bs } = await supabase.from('booklets')
        .select('id, booklet_name, status, topic, file_path, file_paths, pdf_filenames')
        .eq('year', tab.year).eq('subject', tab.subject).order('booklet_name')
      if (dead) return
      const known = new Set((ts || []).map((t) => t.name.trim().toLowerCase()))
      const orphans = (bs || []).filter(
        (b) => !b.topic?.trim() || !known.has(b.topic.trim().toLowerCase()))
      const { data: bd } = orphans.length
        ? await supabase.from('booklet_builds')
            .select('id, booklet_id, doc_type').in('booklet_id', orphans.map((b) => b.id))
        : { data: [] }
      if (dead) return
      // A pre-test or level test belongs to the Tests page, not here, even
      // though publishing one creates a booklets row like any other workbook.
      const notAWorkbook = new Set((bd || [])
        .filter((x) => (x.doc_type ?? 'booklet') !== 'booklet').map((x) => x.booklet_id))
      setUnfiled(orphans.filter((b) => !notAWorkbook.has(b.id)))
      setBuilds(Object.fromEntries((bd || []).map((b) => [b.booklet_id, b.id])))
    })()
    return () => { dead = true }
  }, [tab, nonce])

  if (!cfg || !tab) {
    return (
      <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center">
        <p className="text-sm text-[#2A2035]/50">
          Unknown course.{' '}
          <Link href={cfg ? `/tutor/resources/${slug}/materials` : '/tutor'} className="text-[#325099] underline">
            Back to Materials
          </Link>
        </p>
      </div>
    )
  }
  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>


  const pdfUrl = (path) => supabase.storage.from('booklets').getPublicUrl(path).data?.publicUrl

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-5xl mx-auto px-6 pt-10 pb-16">
        <nav className="text-[11px] text-[#2A2035]/45 mb-3">
          <Link href="/tutor/resources" className="hover:text-[#325099]">Resources</Link>
          <span className="mx-1.5">›</span>
          <Link href={`/tutor/resources/${slug}`} className="hover:text-[#325099]">{cfg.label}</Link>
          <span className="mx-1.5">›</span>
          <Link href={`/tutor/resources/${slug}/materials`} className="hover:text-[#325099]">Materials</Link>
          <span className="mx-1.5">›</span>
          <span className="text-[#2A2035]/70 font-semibold">{tab.label}</span>
        </nav>

        <div className="rounded-2xl px-7 py-6 mb-6 border" style={{ background: cfg.tint, borderColor: cfg.border }}>
          <h1 className="text-2xl font-bold" style={{ color: cfg.accent }}>{tab.label}</h1>
          <p className="text-xs text-[#2A2035]/55 mt-0.5">
            Topics assigned to {tab.label}
            {tab.subject !== cfg.value && <> · <span className="font-semibold">{tab.subject}</span></>}
          </p>
        </div>

        {/* Sibling years */}
        <div className="flex flex-wrap gap-1.5 mb-7">
          {tabs.map((t) => (
            <Link key={t.key} href={`/tutor/resources/${slug}/materials/${t.key}`}
              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition ${t.key === tab.key ? 'text-white' : 'bg-white text-[#2A2035]/60 hover:text-[#2A2035]'}`}
              style={t.key === tab.key ? { background: cfg.accent, borderColor: cfg.accent } : { borderColor: cfg.border }}>
              {t.label}
            </Link>
          ))}
        </div>

        {/* Topics */}
        <h2 className="text-[10px] font-bold tracking-widest uppercase text-[#325099]/60 mb-2.5">Topics</h2>
        {topics === null ? (
          <p className="text-xs text-[#2A2035]/40 animate-pulse">Loading topics…</p>
        ) : topics.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-[#DEE7FF] px-6 py-8 text-center">
            <p className="text-sm font-semibold text-[#2A2035]/60">No topics defined yet</p>
            <p className="text-xs text-[#2A2035]/45 mt-1">
              Nothing has been assigned to {tab.label} in the topic list. Topics are managed from the
              workbook database, where they can be added against a year and subject.
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {topics.map((t) => (
              <Link key={t.id} href={`/tutor/resources/${slug}/materials/${tab.key}/${t.id}`}
                className="group bg-white rounded-xl border border-[#F0F4FF] px-4 py-3 flex items-center gap-2.5 hover:shadow-md transition">
                <span className="w-1.5 h-6 rounded-full shrink-0" style={{ background: cfg.accent }} />
                <span className="text-sm font-semibold text-[#2A2035] leading-snug flex-1 min-w-0 group-hover:underline">{t.name}</span>
                <span className="text-[#2A2035]/25 group-hover:text-[#2A2035]/50 shrink-0">›</span>
              </Link>
            ))}
          </div>
        )}
        {topics?.length > 0 && (
          <p className="text-[11px] text-[#2A2035]/40 mt-2.5">
            {topics.length} topic{topics.length === 1 ? '' : 's'} assigned to {tab.label}.
          </p>
        )}

        {/* Workbooks that belong to no topic page */}
        {unfiled?.length > 0 && (
          <>
            <h2 className="text-[10px] font-bold tracking-widest uppercase text-[#325099]/60 mt-9 mb-2.5">
              Unfiled workbooks <span className="text-[#2A2035]/35">· {unfiled.length}</span>
            </h2>
            <div className="space-y-2">
              {unfiled.map((b) => {
                const st = statusStyle(b.status)
                const build = builds[b.id]
                return (
                  <div key={b.id} className="bg-white rounded-xl border border-[#F0F4FF] px-4 py-3 flex items-center gap-3">
                    <span className="text-sm font-semibold text-[#2A2035] flex-1 min-w-0 truncate">{b.booklet_name}</span>
                    <span className="text-[11px] text-[#2A2035]/40 shrink-0 max-w-[40%] truncate">
                      {b.topic?.trim() ? b.topic : 'no topic'}
                    </span>
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
            <p className="text-[11px] text-[#2A2035]/40 mt-2.5">
              These sit under a topic name that is not in {tab.label}&rsquo;s topic list, or none at all,
              so they appear on no topic page. Renaming the workbook&rsquo;s topic to match, or adding the
              topic, will file them.
            </p>
          </>
        )}

        {/* The two Materials areas, scoped to this year/course */}
        <h2 className="text-[10px] font-bold tracking-widest uppercase text-[#325099]/60 mt-9 mb-2.5">Open</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {MATERIAL_AREAS(cfg.value, tab).map((a) => (
            <Link key={a.label} href={a.href}
              className="group bg-white rounded-2xl border border-[#F0F4FF] p-5 hover:shadow-md transition hover:-translate-y-0.5">
              <div className="flex items-center gap-2.5 mb-2">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ background: cfg.tint }}>{a.icon}</span>
                <span className="text-sm font-bold text-[#062E63] group-hover:underline">{a.label}</span>
              </div>
              <p className="text-xs text-[#2A2035]/55 leading-relaxed">{a.desc}</p>
              <p className="text-[11px] font-semibold mt-3" style={{ color: cfg.accent }}>
                Open for {tab.label} →
              </p>
            </Link>
          ))}
        </div>

        <Link href={`/tutor/resources/${slug}/materials`}
          className="inline-block text-[11px] font-semibold mt-8 hover:underline" style={{ color: cfg.accent }}>
          ← Back to Materials
        </Link>
      </div>

      {/* Everything about one workbook — term, week, topic, notes and the
          improvement checklists. The modal re-reads the full booklets row on
          open, so the trimmed row these pages hold is enough to launch it. */}
      <BookletInfoModal
        booklet={infoFor}
        title={infoFor ? `${infoFor.year ?? tab.year}.M. ${infoFor.booklet_name}` : ''}
        staff={profile}
        topicBank={topics || []}
        onClose={() => { setInfoFor(null); reload() }}
        onChanged={(patch) => setUnfiled((bs) => (bs || []).map((x) => (x.id === infoFor.id ? { ...x, ...patch } : x)))}
      />
    </div>
  )
}
