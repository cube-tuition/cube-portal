'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { listExams, createExam, deleteExam } from '../../../../lib/qbankExams'

export default function ExamsPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const reload = useCallback(() => listExams().then((d) => { setExams(d); setLoading(false) }), [])

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || !['tutor', 'admin', 'director'].includes(role)) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true); reload()
    })
  }, [router, reload])

  const handleNew = async () => {
    setCreating(true)
    try {
      const id = await createExam(profile?.full_name)
      router.push(`/tutor/qbank/exams/${id}`)
    } catch (e) { alert('Could not create exam: ' + (e.message || e)); setCreating(false) }
  }

  const handleDelete = async (id, title) => {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return
    await deleteExam(id); reload()
  }

  const fmt = (iso) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  const counts = (e) => {
    const secs = e.qbank_exam_sections || []
    const slots = secs.reduce((a, s) => a + (s.question_count || 0), 0)
    const filled = secs.reduce((a, s) => a + (s.qbank_exam_slots || []).filter((x) => x.question_id).length, 0)
    return { secs: secs.length, slots, filled }
  }

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={profile?.role !== 'tutor'} />
      <div className="max-w-4xl mx-auto px-6 pt-8 pb-16">
        <Link href="/tutor/qbank" className="text-xs text-[#325099] hover:underline">← Question bank</Link>
        <div className="flex items-center justify-between mt-1 mb-6">
          <h1 className="text-2xl font-bold text-[#062E63]">Exams</h1>
          <button onClick={handleNew} disabled={creating}
            className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-50">
            {creating ? 'Creating…' : '+ New exam'}
          </button>
        </div>

        {loading ? (
          <p className="text-center text-sm text-[#2A2035]/40 py-12 animate-pulse">Loading…</p>
        ) : exams.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-[#DEE7FF]">
            <p className="text-sm text-[#2A2035]/50">No exams yet.</p>
            <button onClick={handleNew} className="inline-block mt-3 px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold">Plan your first exam</button>
          </div>
        ) : (
          <div className="space-y-2">
            {exams.map((e) => {
              const c = counts(e)
              return (
                <div key={e.id} className="bg-white rounded-2xl border border-[#F0F4FF] p-4 flex items-center gap-4 hover:border-[#DEE7FF] transition">
                  <Link href={`/tutor/qbank/exams/${e.id}`} className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-[#062E63] truncate">{e.title || 'Untitled exam'}</div>
                    <div className="text-[11px] text-[#2A2035]/40 mt-0.5">
                      {e.year_label ? `Year ${e.year_label}` : 'Year —'}{e.term ? ` · Term ${e.term}` : ''} · {c.secs} section{c.secs === 1 ? '' : 's'} · {c.filled}/{c.slots} questions filled · edited {fmt(e.updated_at)}
                    </div>
                  </Link>
                  <Link href={`/tutor/qbank/exams/${e.id}`} className="text-[11px] font-semibold text-[#325099] hover:underline">Open</Link>
                  <button onClick={() => handleDelete(e.id, e.title)} className="text-[11px] text-[#DC2626] hover:underline">Delete</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
