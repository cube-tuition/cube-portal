'use client'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import WorkbookDoc from '../../../../components/booklet/WorkbookDoc'

/*
 * Teacher's view of an online workbook — /tutor/workbook/<bookletId>?class=<id>
 *
 * Opens in its own tab from the lesson page. Side tabs down the left: the
 * teacher's own copy (default, editable — for modelling in class) then one tab
 * per enrolled student showing that student's live work, where the teacher can
 * leave a comment on any answer.
 */

function TeacherWorkbookInner() {
  const { bookletId } = useParams()
  const router = useRouter()
  const params = useSearchParams()
  const classId = params.get('class')

  const [staff, setStaff] = useState(null)
  const [booklet, setBooklet] = useState(null)
  const [build, setBuild] = useState(null)
  const [cls, setCls] = useState(null)
  const [students, setStudents] = useState([])
  const [tab, setTab] = useState('teacher')     // 'teacher' | student uuid
  const [started, setStarted] = useState({})    // student id → answered count
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setStaff(profile)

      const { data: b } = await supabase.from('booklets').select('*').eq('id', bookletId).maybeSingle()
      if (!b) { setErr('Workbook not found.'); return }
      setBooklet(b)

      const { data: wb } = await supabase.from('booklet_builds')
        .select('id, blocks, delivery').eq('booklet_id', bookletId).maybeSingle()
      if (!wb) { setErr('This workbook has no builder document behind it, so there is nothing to type into.'); return }
      setBuild(wb)

      if (classId) {
        const { data: c } = await supabase.from('classes').select('id, class_name').eq('id', classId).maybeSingle()
        setCls(c || null)
        const { data: es } = await supabase.from('enrolments')
          .select('student_id, status, students(id, full_name)')
          .eq('class_id', classId).eq('status', 'active')
        const list = (es || []).map(e => e.students).filter(Boolean)
          .sort((a, b2) => a.full_name.localeCompare(b2.full_name))
        setStudents(list)

        // Who has typed anything — drives the dot on each tab.
        const { data: ans } = await supabase.from('workbook_answers')
          .select('owner_id, body').eq('booklet_id', bookletId).eq('class_id', classId).eq('is_teacher', false)
        const counts = {}
        for (const r of ans || []) if ((r.body || '').trim()) counts[r.owner_id] = (counts[r.owner_id] || 0) + 1
        setStarted(counts)
      }
    })()
  }, [bookletId, classId, router])

  const title = useMemo(() => {
    if (!booklet) return ''
    const code = { English: 'ET', Maths: 'M', Chemistry: 'C' }[booklet.subject] || (booklet.subject || '')[0] || ''
    return `${booklet.year ? `${booklet.year}.${code}. ` : ''}${booklet.booklet_name}`
  }, [booklet])

  if (err) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center px-6"><p className="text-sm text-[#B23A3A] max-w-md text-center">{err}</p></div>
  if (!staff || !booklet || !build) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const activeStudent = tab === 'teacher' ? null : students.find(s => s.id === tab)

  return (
    <div className="min-h-screen bg-[#F1F4FA]">
      <div className="sticky top-0 z-20 bg-white border-b border-[#DEE7FF]">
        <div className="max-w-[1330px] mx-auto px-5 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#CBEBDF] bg-[#ECF9F4] text-[#0E7A5F]">🌐 Online</span>
          <span className="text-sm font-bold text-[#062E63]">{title}</span>
          {cls && <span className="text-xs text-[#325099]/60">{cls.class_name}</span>}
          <span className="ml-auto text-xs text-[#2A2035]/45">
            {activeStudent ? `Reading ${activeStudent.full_name}’s work — select any text to comment` : 'Solutions and notes for teaching'}
          </span>
        </div>
      </div>

      <div className="max-w-[1330px] mx-auto px-5 py-5 flex gap-5 items-start">
        {/* Side tabs */}
        <aside className="w-[190px] shrink-0 sticky top-[58px]">
          <button
            onClick={() => setTab('teacher')}
            className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold mb-1.5 transition border ${tab === 'teacher'
              ? 'bg-[#325099] text-white border-[#325099]'
              : 'bg-white text-[#325099] border-[#DEE7FF] hover:border-[#325099]'}`}
          >
            📘 Solutions copy
          </button>
          {students.length > 0 && (
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#2A2035]/35 mt-3 mb-1 px-1">
              Students · {students.length}
            </p>
          )}
          <div className="space-y-1">
            {students.map(s => (
              <button
                key={s.id}
                onClick={() => setTab(s.id)}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold transition border flex items-center gap-2 ${tab === s.id
                  ? 'bg-[#325099] text-white border-[#325099]'
                  : 'bg-white text-[#2A2035]/70 border-[#DEE7FF] hover:border-[#325099]'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${started[s.id] ? 'bg-[#16A34A]' : 'bg-[#D4DBEA]'}`}
                  title={started[s.id] ? `${started[s.id]} answer${started[s.id] === 1 ? '' : 's'} typed` : 'Not started'} />
                <span className="truncate">{s.full_name}</span>
              </button>
            ))}
          </div>
          {!classId && <p className="text-[11px] text-[#2A2035]/40 mt-3 px-1">Open this from a class lesson page to see student copies.</p>}
        </aside>

        {/* The doc */}
        <main className="flex-1 min-w-0 overflow-x-auto">
          <WorkbookDoc
            key={tab}
            booklet={booklet}
            blocks={build.blocks || []}
            classId={classId}
            ownerId={tab === 'teacher' ? staff.id : tab}
            mode={tab === 'teacher' ? 'solutions' : 'review'}
            commentStudentId={tab === 'teacher' ? null : tab}
            staffId={staff.id}
          />
        </main>
      </div>
    </div>
  )
}

export default function TeacherWorkbookPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>}>
      <TeacherWorkbookInner />
    </Suspense>
  )
}
