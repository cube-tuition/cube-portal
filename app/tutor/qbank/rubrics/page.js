'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { listRubrics, createRubric, duplicateRubric, deleteRubric } from '../../../../lib/rubrics'

export default function RubricsList() {
  const router = useRouter()
  const [staff, setStaff] = useState(null)
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => listRubrics().then(setRows)

  useEffect(() => {
    (async () => {
      const { profile } = await getAuthProfile()
      if (!profile || (profile.role !== 'admin' && profile.role !== 'tutor')) { router.push('/tutor'); return }
      setStaff(profile); load()
    })()
  }, [router])

  const create = async () => {
    setBusy(true)
    try { const id = await createRubric(staff?.full_name); router.push(`/tutor/qbank/rubrics/${id}`) }
    catch (e) { alert(e.message); setBusy(false) }
  }
  const dup = async (id) => { const nid = await duplicateRubric(id); if (nid) router.push(`/tutor/qbank/rubrics/${nid}`) }
  const del = async (r) => { if (!confirm(`Delete "${r.name}"?`)) return; await deleteRubric(r.id); load() }

  return (
    <div className="min-h-screen bg-[#F7F9FF]">
      <TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} />
      <div className="max-w-4xl mx-auto px-6 py-8">
        <Link href="/tutor/qbank/exams" className="text-xs text-[#325099] hover:underline">← Exams</Link>
        <div className="flex items-center justify-between mb-6 mt-1">
          <div>
            <h1 className="text-2xl font-bold text-[#2A2035] font-display">Marking rubrics</h1>
            <p className="text-sm text-[#2A2035]/55 mt-0.5">Reusable band-descriptor grids for English writing papers. Attach one to any writing question in the exam builder.</p>
          </div>
          <button onClick={create} disabled={busy} className="px-4 py-2 bg-[#325099] text-white text-sm font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40">{busy ? '…' : '＋ New rubric'}</button>
        </div>

        {rows === null ? <p className="text-sm text-[#2A2035]/40">Loading…</p>
          : rows.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-[#DEE7FF]">
              <div className="text-3xl mb-2">📝</div>
              <p className="text-sm font-semibold text-[#2A2035]">No rubrics yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map(r => (
                <div key={r.id} className="bg-white rounded-xl border border-[#DEE7FF] p-4 flex items-center gap-3">
                  <Link href={`/tutor/qbank/rubrics/${r.id}`} className="font-semibold text-[#2A2035] hover:text-[#325099] flex-1 min-w-0 truncate">{r.name}</Link>
                  <span className="text-[11px] text-[#2A2035]/45 whitespace-nowrap">{(r.criteria || []).length} criteria · {(r.bands || []).length} bands</span>
                  <Link href={`/tutor/qbank/rubrics/${r.id}`} className="text-[11px] font-semibold text-[#325099] hover:underline">Edit</Link>
                  <button onClick={() => dup(r.id)} className="text-[11px] text-[#2A2035]/50 hover:text-[#325099]">Duplicate</button>
                  <button onClick={() => del(r)} className="text-[11px] text-[#2A2035]/40 hover:text-rose-500">Delete</button>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  )
}
