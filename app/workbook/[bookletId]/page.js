'use client'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { requireStudent } from '../../../lib/requireStudent'
import PortalNav from '../../../components/PortalNav'
import WorkbookDoc from '../../../components/booklet/WorkbookDoc'
import TermJournal from '../../../components/booklet/TermJournal'

/*
 * A student's own copy of an online workbook — /workbook/<bookletId>?class=<id>
 *
 * Two side tabs: this week's workbook (the student types straight into it;
 * every box autosaves to their own row, teacher comments appear inline), and
 * beneath it the Help Page — the term-long document where they drop
 * questions, assessment tasks and essays for the teacher to review. The doc is
 * the same one from every week's workbook; it carries over.
 *
 * Access is enforced twice: this page checks the student is enrolled in the
 * class, and the workbook_answers / term_journal RLS policies allow a student
 * to touch only their own rows.
 */

function StudentWorkbookInner() {
  const { bookletId } = useParams()
  const router = useRouter()
  const classId = useSearchParams().get('class')

  const [student, setStudent] = useState(null)
  const [booklet, setBooklet] = useState(null)
  const [build, setBuild] = useState(null)
  const [tab, setTab] = useState('workbook')   // 'workbook' | 'doc'
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user ?? null
      if (!requireStudent(user, router)) return
      setStudent(user)

      if (!classId) { setErr('This link is missing its class.'); return }
      const { data: enrol } = await supabase.from('enrolments')
        .select('id').eq('class_id', classId).eq('student_id', user.id).eq('status', 'active').maybeSingle()
      if (!enrol) { setErr('This workbook belongs to a class you are not enrolled in.'); return }

      const { data: b } = await supabase.from('booklets').select('*').eq('id', bookletId).maybeSingle()
      if (!b) { setErr('Workbook not found.'); return }
      if (b.delivery !== 'online') { setErr('This workbook is a printed one — ask your teacher for a copy.'); return }
      setBooklet(b)

      // booklet_builds is staff-only and its blocks carry the solutions, so the
      // student copy comes from a function that checks enrolment and strips
      // every solution before returning the pages.
      const { data: blocks, error: wbErr } = await supabase
        .rpc('student_workbook_blocks', { p_booklet: bookletId, p_class: Number(classId) })
      if (wbErr) { setErr('This workbook could not be opened: ' + wbErr.message); return }
      if (!blocks) { setErr('This workbook has no pages yet.'); return }
      setBuild({ blocks })
    })()
  }, [bookletId, classId, router])

  const title = useMemo(() => {
    if (!booklet) return ''
    const code = { English: 'ET', Maths: 'M', Chemistry: 'C' }[booklet.subject] || (booklet.subject || '')[0] || ''
    return `${booklet.year ? `${booklet.year}.${code}. ` : ''}${booklet.booklet_name}`
  }, [booklet])

  if (err) return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <PortalNav />
      <p className="text-sm text-[#B23A3A] text-center mt-20 px-6">{err}</p>
    </div>
  )
  if (!student || !booklet || !build) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const onDoc = tab === 'doc'
  return (
    <div className="min-h-screen bg-[#F1F4FA]">
      <PortalNav />
      <div className="sticky top-0 z-20 bg-white border-b border-[#DEE7FF]">
        <div className="max-w-[1330px] mx-auto px-5 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#CBEBDF] bg-[#ECF9F4] text-[#0E7A5F]">🌐 Online</span>
          <span className="text-sm font-bold text-[#062E63]">{onDoc ? 'Help Page' : title}</span>
          <span className="ml-auto text-xs text-[#2A2035]/45">
            {onDoc ? 'Anything you add stays here all term — your teacher reviews it' : 'Your work saves automatically'}
          </span>
        </div>
      </div>

      <div className="max-w-[1330px] mx-auto px-5 py-5 flex gap-5 items-start">
        {/* Side tabs — this week on top, the term-long doc beneath. */}
        <aside className="w-[190px] shrink-0 sticky top-[58px]">
          <button
            onClick={() => setTab('workbook')}
            className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold mb-1.5 transition border ${tab === 'workbook'
              ? 'bg-[#325099] text-white border-[#325099]'
              : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'}`}
          >
            📖 This week&rsquo;s workbook
          </button>
          <button
            onClick={() => setTab('doc')}
            className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold transition border ${onDoc
              ? 'bg-[#325099] text-white border-[#325099]'
              : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'}`}
          >
            📂 Help Page
          </button>
          <p className="text-[10px] text-[#2A2035]/40 mt-2 px-1 leading-relaxed">
            {onDoc
              ? 'Questions, assessment tasks, essays for feedback — add them any week; it all stays here for the term.'
              : ''}
          </p>
        </aside>

        <main className="flex-1 min-w-0 overflow-x-auto">
          {onDoc ? (
            <TermJournal classId={classId} studentId={student.id} mode="own" />
          ) : (
            <WorkbookDoc
              booklet={booklet}
              blocks={build.blocks || []}
              classId={classId}
              ownerId={student.id}
              mode="own"
              commentStudentId={student.id}
            />
          )}
        </main>
      </div>
    </div>
  )
}

export default function StudentWorkbookPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>}>
      <StudentWorkbookInner />
    </Suspense>
  )
}
