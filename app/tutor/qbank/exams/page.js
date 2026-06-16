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
  const [tab, setTab] = useState('maths')   // 'maths' | 'english'

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
      const id = await createExam(profile?.full_name, tab)
      router.push(`/tutor/qbank/exams/${id}`)
    } catch (e) { alert('Could not create exam: ' + (e.message || e)); setCreating(false) }
  }

  const isEnglish = (e) => e.paper_type === 'english'
  const shown = exams.filter((e) => (tab === 'english' ? isEnglish(e) : !isEnglish(e)))
  const mathsN = exams.filter((e) => !isEnglish(e)).length
  const englishN = exams.filter(isEnglish).length

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
        <div className="flex items-center justify-between mt-1 mb-4">
          <h1 className="text-2xl font-bold text-[#062E63]">Exams</h1>
          <div className="flex items-center gap-3">
            {tab === 'english' && (
              <Link href="/tutor/qbank/rubrics" className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] rounded-lg px-3 py-2 hover:bg-white transition">📊 Marking rubrics</Link>
            )}
            <button onClick={handleNew} disabled={creating}
              className="px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold hover:bg-[#062E63] transition disabled:opacity-50">
              {creating ? 'Creating…' : `+ New ${tab === 'english' ? 'English' : 'Maths'} exam`}
            </button>
          </div>
        </div>

        {/* Maths / English folders */}
        <div className="flex gap-1 mb-5 border-b border-[#DEE7FF]">
          {[['maths', 'Maths', mathsN], ['english', 'English', englishN]].map(([v, label, n]) => (
            <button key={v} onClick={() => setTab(v)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${tab === v ? 'border-[#325099] text-[#062E63]' : 'border-transparent text-[#2A2035]/40 hover:text-[#2A2035]/70'}`}>
              {label} <span className="text-[11px] font-normal text-[#2A2035]/40">{n}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-center text-sm text-[#2A2035]/40 py-12 animate-pulse">Loading…</p>
        ) : shown.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-[#DEE7FF]">
            <p className="text-sm text-[#2A2035]/50">No {tab === 'english' ? 'English' : 'Maths'} exams yet.</p>
            <button onClick={handleNew} className="inline-block mt-3 px-4 py-2 rounded-xl bg-[#325099] text-white text-sm font-semibold">Plan your first {tab === 'english' ? 'English' : 'Maths'} exam</button>
          </div>
        ) : (
          <div className="space-y-2">
            {shown.map((e) => {
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
