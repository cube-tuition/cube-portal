'use client'
import { useState } from 'react'

export function AddCreditModal({ members, onClose, onSave }) {
  const [studentId, setStudentId] = useState(members?.[0]?.id ?? '')
  const [amount,    setAmount]    = useState('')
  const [reason,    setReason]    = useState('missed_lesson')
  const [notes,     setNotes]     = useState('')
  const [saving,    setSaving]    = useState(false)

  const REASONS = [
    { value: 'missed_lesson', label: 'Missed lesson' },
    { value: 'late_start',    label: 'Late start' },
    { value: 'other',         label: 'Other' },
  ]

  const handleSubmit = async () => {
    if (!studentId || !amount || Number(amount) <= 0) return
    setSaving(true)
    await onSave({ studentId, amount, reason, notes })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[#2A2035] text-sm">Add Credit</h3>
          <button onClick={onClose} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg leading-none">✕</button>
        </div>
        {members.length > 1 && (
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Student</label>
            <select value={studentId} onChange={e => setStudentId(e.target.value)}
              className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
              {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Reason</label>
          <select value={reason} onChange={e => setReason(e.target.value)}
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]">
            {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Amount ($)</label>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="e.g. 50"
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]" />
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase font-semibold text-[#325099]/70 mb-1.5">Notes (optional)</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Missed Week 4 lesson"
            className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#2A2035] bg-white focus:outline-none focus:border-[#325099]" />
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-[#2A2035]/60 hover:text-[#2A2035] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || !amount || Number(amount) <= 0}
            className="px-5 py-2 bg-[#325099] text-white text-sm font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40">
            {saving ? 'Saving…' : 'Apply Credit'}
          </button>
        </div>
      </div>
    </div>
  )
}
