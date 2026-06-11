'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtMoney } from '../../lib/format'

export function TopUpInvoiceModal({ inv, allStudents, onClose, onCreated }) {
  const [enrolments, setEnrolments] = useState([])
  const [checked,    setChecked]    = useState({})
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  const memberIds = [...new Set((inv.line_items || []).filter(l => l.type === 'enrolment').map(l => l.student_id))]
  const genCutoff = inv.created_at ? new Date(inv.created_at) : null

  useEffect(() => {
    if (!memberIds.length || !inv.term_id) { setLoading(false); return }
    ;(async () => {
      const { data: termClasses } = await supabase.from('classes').select('id, class_name').eq('term_id', inv.term_id)
      const termClassIds  = (termClasses || []).map(c => c.id)
      const classNameMap  = Object.fromEntries((termClasses || []).map(c => [c.id, c.class_name]))
      if (!termClassIds.length) { setLoading(false); return }

      const { data: enrRows } = await supabase.from('enrolments')
        .select('id, student_id, class_id, price, created_at')
        .in('student_id', memberIds).in('class_id', termClassIds)
        .order('created_at', { ascending: true })

      const rows = (enrRows || []).map(e => ({
        key:         `${e.student_id}__${e.class_id}`,
        enrolmentId: e.id,
        studentId:   e.student_id,
        studentName: allStudents.find(s => s.id === e.student_id)?.full_name ?? '—',
        classId:     e.class_id,
        className:   classNameMap[e.class_id] ?? '—',
        price:       Number(e.price ?? 0),
        createdAt:   e.created_at,
      }))

      setEnrolments(rows)
      setChecked(Object.fromEntries(rows.map(r => [r.key, !genCutoff || new Date(r.createdAt) > genCutoff])))
      setLoading(false)
    })()
  }, [])

  const checkedRows = enrolments.filter(e => checked[e.key])
  const subtotal    = checkedRows.reduce((s, e) => s + e.price, 0)
  const total       = Math.max(0, subtotal)

  const handleSubmit = async () => {
    if (!checkedRows.length) return
    setSaving(true); setError('')
    const { error: err } = await supabase.from('invoices').insert({
      term_id: inv.term_id, family_id: inv.family_id ?? null, student_id: inv.student_id ?? null,
      subtotal, sibling_discount: 0, multi_course_discount: 0, total,
      status: 'draft', payment_status: 'unpaid', is_topup: true,
    })
    if (err) { setError(err.message); setSaving(false); return }
    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#DEE7FF]">
          <h3 className="font-bold text-[#2A2035] text-sm">Top-up Invoice</h3>
          <button onClick={onClose} className="text-[#2A2035]/40 hover:text-[#2A2035] text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className="text-xs text-[#2A2035]/60 mb-4">Select the new enrolments to include in a follow-up invoice. Enrolments added after the original invoice are pre-ticked.</p>
          {loading ? <p className="text-xs text-[#325099]/50 text-center py-6">Loading…</p> : enrolments.length === 0 ? (
            <p className="text-xs text-[#325099]/40 italic text-center py-6">No enrolments found for this family in this term.</p>
          ) : (
            <div className="space-y-2">
              {enrolments.map(e => (
                <label key={e.key} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[#DEE7FF] hover:bg-[#F8FAFF] cursor-pointer">
                  <input type="checkbox" checked={checked[e.key] ?? false} onChange={ev => setChecked(p => ({ ...p, [e.key]: ev.target.checked }))} className="accent-[#325099] w-4 h-4" />
                  <div className="flex-1 text-xs">
                    <span className="font-semibold text-[#062E63]">{e.studentName}</span>
                    <span className="text-[#325099]/60 ml-2">{e.className}</span>
                  </div>
                  <span className="text-xs font-semibold text-[#325099]">{fmtMoney(e.price)}</span>
                </label>
              ))}
            </div>
          )}
          {checkedRows.length > 0 && (
            <div className="mt-4 pt-3 border-t border-[#DEE7FF] flex justify-end text-xs font-bold text-[#062E63]">
              Total: {fmtMoney(total)}
            </div>
          )}
          {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-[#DEE7FF] bg-[#F8FAFF] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-[#2A2035]/60 hover:text-[#2A2035] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || !checkedRows.length}
            className="px-5 py-2 bg-[#325099] text-white text-xs font-semibold rounded-lg hover:bg-[#062E63] transition disabled:opacity-40">
            {saving ? 'Creating…' : 'Create top-up invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}
