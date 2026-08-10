'use client'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { requireStudent } from '../../../lib/requireStudent'
import PortalNav from '../../../components/PortalNav'
import WorkbookDoc from '../../../components/booklet/WorkbookDoc'

/*
 * A student's own copy of an online workbook — /workbook/<bookletId>?class=<id>
 *
 * The student types straight into the workbook; every box autosaves to their
 * own row. Teacher comments appear inline, read-only, as they are written.
 * Access is enforced twice: this page checks the student is enrolled in the
 * class, and the workbook_answers RLS policy allows a student to touch only
 * rows where owner_id = their own uid.
 */

function StudentWorkbookInner() {
  const { bookletId } = useParams()
  const router = useRouter()
  const classId = useSearchParams().get('class')

  const [student, setStudent] = useState(null)
  const [booklet, setBooklet] = useState(null)
  const [build, setBuild] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      const res = await requireStudent(router)
      const user = res?.user || res
      if (!user?.id) return
      setStudent(user)

      if (!classId) { setErr('This link is missing its class.'); return }
      const { data: enrol } = await supabase.from('enrolments')
        .select('id').eq('class_id', classId).eq('student_id', user.id).eq('status', 'active').maybeSingle()
      if (!enrol) { setErr('This workbook belongs to a class you are not enrolled in.'); return }

      const { data: b } = await supabase.from('booklets').select('*').eq('id', bookletId).maybeSingle()
      if (!b) { setErr('Workbook not found.'); return }
      if (b.delivery !== 'online') { setErr('This workbook is a printed one — ask your teacher for a copy.'); return }
      setBooklet(b)

      const { data: wb } = await supabase.from('booklet_builds')
        .select('id, blocks').eq('booklet_id', bookletId).maybeSingle()
      if (!wb) { setErr('This workbook has no pages yet.'); return }
      setBuild(wb)
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

  return (
    <div className="min-h-screen bg-[#F1F4FA]">
      <PortalNav />
      <div className="sticky top-0 z-20 bg-white border-b border-[#DEE7FF]">
        <div className="max-w-[900px] mx-auto px-5 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#CBEBDF] bg-[#ECF9F4] text-[#0E7A5F]">🌐 Online</span>
          <span className="text-sm font-bold text-[#062E63]">{title}</span>
          <span className="ml-auto text-xs text-[#2A2035]/45">Your work saves automatically</span>
        </div>
      </div>
      <div className="py-5 px-4">
        <WorkbookDoc
          booklet={booklet}
          blocks={build.blocks || []}
          classId={classId}
          ownerId={student.id}
          mode="own"
          commentStudentId={student.id}
        />
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
