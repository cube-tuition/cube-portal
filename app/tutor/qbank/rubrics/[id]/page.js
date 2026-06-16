'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getAuthProfile } from '../../../../../lib/getProfile'
import TutorNav from '../../../../../components/TutorNav'
import { loadRubric, saveRubric } from '../../../../../lib/rubrics'
import RubricGridEditor from '../../../../../components/qbank/RubricGridEditor'

export default function RubricEditor() {
  const router = useRouter()
  const { id } = useParams()
  const [staff, setStaff] = useState(null)
  const [r, setR] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const rRef = useRef(null)
  useEffect(() => { rRef.current = r })
  const savingRef = useRef(false), pendingRef = useRef(false)

  useEffect(() => {
    (async () => {
      const { profile } = await getAuthProfile()
      if (!profile || (profile.role !== 'admin' && profile.role !== 'tutor')) { router.push('/tutor'); return }
      setStaff(profile)
      setR(await loadRubric(id)); setLoading(false)
    })()
  }, [id, router])

  const save = useCallback(async () => {
    if (savingRef.current) { pendingRef.current = true; return }
    savingRef.current = true; setSaving(true)
    try { do { pendingRef.current = false; await saveRubric(rRef.current) } while (pendingRef.current); setDirty(false) }
    finally { savingRef.current = false; setSaving(false) }
  }, [])
  useEffect(() => {
    if (loading || !dirty) return
    const t = setTimeout(() => save(), 900)
    return () => clearTimeout(t)
  }, [dirty, r, loading, save])

  const mutate = (patch) => { setR(x => ({ ...x, ...patch })); setDirty(true) }

  if (loading) return <div className="min-h-screen bg-white"><TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} /><p className="text-center text-[#325099] text-sm mt-20">Loading…</p></div>
  if (!r) return <div className="min-h-screen bg-white"><TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} /><p className="text-center text-rose-500 text-sm mt-20">Rubric not found.</p></div>

  return (
    <div className="min-h-screen bg-[#F7F9FF]">
      <TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} />
      <div className="sticky top-0 z-30 bg-white border-b border-[#DEE7FF]">
        <div className="max-w-[1400px] mx-auto px-5 py-3 flex items-center gap-3 flex-wrap">
          <button onClick={() => router.push('/tutor/qbank/rubrics')} className="text-[#325099] text-sm hover:underline">← Rubrics</button>
          <input value={r.name} onChange={e => mutate({ name: e.target.value })} className="flex-1 min-w-[200px] text-base font-semibold text-[#2A2035] border border-transparent hover:border-[#DEE7FF] focus:border-[#325099] rounded-lg px-2 py-1 focus:outline-none" />
          <span className="text-[11px] text-[#2A2035]/40">{saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}</span>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-5 py-6">
        <div className="bg-white rounded-xl border border-[#DEE7FF] p-4">
          <RubricGridEditor value={r} onChange={mutate} />
        </div>
        <p className="text-[11px] text-[#2A2035]/40 mt-3">This grid prints under each writing question on English exam papers. Edit anything — bands, marks, criteria names and descriptors are all flexible.</p>
      </div>
    </div>
  )
}
