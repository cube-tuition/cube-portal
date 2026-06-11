'use client'
import { useState } from 'react'

export function ReferralModal({ students, onClose, onSave }) {
  const [referringId, setReferringId] = useState('')
  const [referredId,  setReferredId]  = useState('')
  const [saving,      setSaving]      = useState(false)

  const handleSubmit = async () => {
    if (!referringId || !referredId) return
    setSaving(true)
    await onSave({ referringStudentId: referringId, referredStudentId: referredId })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[#2A2035] text-sm">Log Referral</h3>
          <button onClick={onClose} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg leading-none">✕</button>
        </div>
        <p className="text-xs text-[#2A2035]/60 -mt-2">Both families receive <strong>$50 off</strong>. The referred family gets it immediately; the referring family gets it on their next invoice.</p>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Referring student (existing family)</label>
          <select value={referringId} onChange={e => setReferringId(e.target.value)}
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
            <option value="">Select student…</option>
            {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Referred student (new family)</label>
          <select value={referredId} onChange={e => setReferredId(e.target.value)}
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
            <option value="">Select student…</option>
            {students.filter(s => s.id !== referringId).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
        {referringId && referredId && (
          <div className="rounded-xl bg-[#F0FDF4] border border-[#A7F3D0] px-4 py-3 text-xs text-[#065F46]">
            <p>✓ <strong>{students.find(s => s.id === referredId)?.full_name}</strong> — $50 applied to their current invoice</p>
            <p className="mt-1">✓ <strong>{students.find(s => s.id === referringId)?.full_name}</strong> — $50 pending for their next invoice</p>
          </div>
        )}
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-[#2A2035]/60 hover:text-[#2A2035] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || !referringId || !referredId || referringId === referredId}
            className="px-5 py-2 bg-[#7C3AED] text-white text-sm font-semibold rounded-lg hover:bg-[#6D28D9] transition disabled:opacity-40">
            {saving ? 'Logging…' : 'Log Referral'}
          </button>
        </div>
      </div>
    </div>
  )
}
