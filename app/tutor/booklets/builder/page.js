'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { T_BOOKLET_BUILDS } from '../../../../lib/tables'

export default function BookletBuilderList() {
  const router = useRouter()
  const [staff, setStaff] = useState(null)
  const [rows, setRows] = useState(null)
  const [creating, setCreating] = useState(false)

  const load = () => supabase.from(T_BOOKLET_BUILDS).select('id, title, year, subject, topic, status, updated_at')
    .order('updated_at', { ascending: false }).then(({ data }) => setRows(data || []))

  useEffect(() => {
    (async () => {
      const { profile } = await getAuthProfile()
      if (!profile || (profile.role !== 'admin' && profile.role !== 'tutor')) { router.push('/tutor'); return }
      setStaff(profile); load()
    })()
  }, [router])

  const create = async () => {
    setCreating(true)
    const { data, error } = await supabase.from(T_BOOKLET_BUILDS)
      .insert({ title: 'Untitled booklet', subject: 'Mathematics', blocks: [] }).select('id').single()
    setCreating(false)
    if (error) { alert('Could not create: ' + error.message); return }
    router.push(`/tutor/booklets/builder/${data.id}`)
  }

  const duplicate = async (row) => {
    const { data: full } = await supabase.from(T_BOOKLET_BUILDS).select('*').eq('id', row.id).single()
    if (!full) return
    const { data, error } = await supabase.from(T_BOOKLET_BUILDS)
      .insert({ title: `${full.title} (copy)`, year: full.year, subject: full.subject, topic: full.topic, blocks: full.blocks })
      .select('id').single()
    if (error) { alert(error.message); return }
    router.push(`/tutor/booklets/builder/${data.id}`)
  }

  const remove = async (row) => {
    if (!confirm(`Delete "${row.title}"? This can't be undone.`)) return
    await supabase.from(T_BOOKLET_BUILDS).delete().eq('id', row.id)
    load()
  }

  return (
    <div className="min-h-screen bg-[#F7F9FF]">
      <TutorNav staffName={staff?.full_name} isAdmin={staff?.role === 'admin'} />
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#2A2035] font-display">Booklet Builder</h1>
            <p className="text-sm text-[#2A2035]/55 mt-0.5">Build CUBE booklets in the portal — export Student &amp; Solutions copies, then assign to a class on the Curriculum page.</p>
          </div>
          <button onClick={create} disabled={creating} className="px-4 py-2 bg-[#325099] text-white text-sm font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40">{creating ? 'Creating…' : '＋ New booklet'}</button>
        </div>

        {rows === null ? (
          <p className="text-sm text-[#2A2035]/40">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-[#DEE7FF]">
            <div className="text-4xl mb-3">📘</div>
            <p className="text-sm font-semibold text-[#2A2035]">No booklets yet.</p>
            <p className="text-xs text-[#2A2035]/50 mt-1">Create one to replace the Word-doc workflow.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rows.map(r => (
              <div key={r.id} className="bg-white rounded-xl border border-[#DEE7FF] p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/tutor/booklets/builder/${r.id}`} className="font-semibold text-[#2A2035] hover:text-[#325099] transition flex-1 min-w-0">
                    {r.title}
                  </Link>
                  {r.status === 'published'
                    ? <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">In curriculum</span>
                    : <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">Draft</span>}
                </div>
                <p className="text-xs text-[#2A2035]/50 mt-1">
                  {[r.subject, r.year ? `Year ${r.year}` : null, r.topic].filter(Boolean).join(' · ') || 'No details yet'}
                </p>
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[#F0F4FF] text-[11px]">
                  <Link href={`/tutor/booklets/builder/${r.id}`} className="font-semibold text-[#325099] hover:underline">Open →</Link>
                  <button onClick={() => duplicate(r)} className="text-[#2A2035]/50 hover:text-[#325099]">Duplicate</button>
                  <button onClick={() => remove(r)} className="text-[#2A2035]/40 hover:text-rose-500 ml-auto">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
