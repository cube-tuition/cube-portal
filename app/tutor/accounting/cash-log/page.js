'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import TutorNav from '@/components/TutorNav'
import { getAuthProfile } from '@/lib/getProfile'
import { normaliseTerms } from '@/lib/terms'

/*
 * Cash Log — /tutor/accounting/cash-log
 * Every physical cash movement: cash invoices paid (booked automatically when a
 * cash invoice is marked paid), gifts and withdrawals in; cash wages and returns
 * out. The Forecast page reads this table for the term's actual outflows.
 *
 * Always shows all time, newest first; From/To narrows the rows shown. The
 * Balance column is the true running balance over the whole log either way.
 * A new entry is filed under the term its date falls in; an edit never moves
 * an entry to another term.
 */

function fmt(n) { return `$${Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

export default function CashLogPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [terms,   setTerms]   = useState([])
  const [error,   setError]   = useState(null)

  useEffect(() => {
    getAuthProfile().then(({ profile: p, role }) => {
      if (!p || (role !== 'admin' && role !== 'director')) router.replace('/tutor')
      else setProfile(p)
    })
  }, [router])

  const [cashLog,          setCashLog]          = useState([])
  const [cashLogLoading,   setCashLogLoading]   = useState(false)
  const [clDateFrom,       setClDateFrom]       = useState('')
  const [clDateTo,         setClDateTo]         = useState('')
  // null = closed, 'new' = adding, otherwise the id of the row being edited.
  const [entryModal,       setEntryModal]        = useState(null)
  const [entryForm,        setEntryForm]         = useState({ date: '', direction: 'inflow', type: 'invoice', description: '', amount: '' })
  const [entrySaving,      setEntrySaving]       = useState(false)

  const reportError = useCallback((label) => (error) => {
    if (error) setError(`${label}: ${error.message}`)
  }, [])

  // Terms only file new entries: an entry belongs to the term its date is in.
  useEffect(() => {
    supabase.from('terms').select('id, name, year, term_number, start_date, end_date')
      .then(({ data, error }) => {
        reportError('Terms failed to load')(error)
        setTerms(normaliseTerms(data || []))
      })
  }, [reportError])
  const termForDate = (iso) => terms.find(t => t.start_date && t.end_date && t.start_date <= iso && iso <= t.end_date)?.id || null

  // ── Cash log helpers ─────────────────────────────────────────────────────────
  // The whole log loads (oldest first, so the running balance can be summed);
  // the date range filters on screen, which keeps Balance true to all time.
  const loadCashLog = useCallback(async () => {
    setCashLogLoading(true)
    const { data, error: err } = await supabase.from('cash_log').select('*')
      .order('date', { ascending: true }).order('id', { ascending: true })
    reportError('Cash log failed to load')(err)
    setCashLog(data || [])
    setCashLogLoading(false)
  }, [reportError])

  useEffect(() => { loadCashLog() }, [loadCashLog])

  const openAddEntry = () => {
    setEntryForm({ date: new Date().toISOString().slice(0, 10), direction: 'inflow', type: 'invoice', description: '', amount: '' })
    setEntryModal('new')
  }
  // Amounts are stored signed but always typed as a positive number, so an edit
  // shows the magnitude and re-applies the sign from the direction on save.
  const openEditEntry = (e) => {
    setEntryForm({
      date: e.date || '', direction: e.direction, type: e.type,
      description: e.description || '', amount: String(Math.abs(Number(e.amount) || 0)),
    })
    setEntryModal(e.id)
  }

  const handleSaveEntry = async () => {
    if (!entryForm.date || !entryForm.amount || !entryForm.type) return
    setEntrySaving(true)
    const signed = entryForm.direction === 'outflow' ? -Math.abs(Number(entryForm.amount)) : Math.abs(Number(entryForm.amount))
    const fields = {
      date: entryForm.date, direction: entryForm.direction, type: entryForm.type,
      description: entryForm.description.trim() || null, amount: signed,
    }
    // A new row is filed under the term its date falls in; an edit leaves
    // term_id alone, so re-dating a line can't silently move it to another
    // term's books.
    const { error: err } = entryModal === 'new'
      ? await supabase.from('cash_log').insert({ ...fields, term_id: termForDate(fields.date) })
      : await supabase.from('cash_log').update(fields).eq('id', entryModal)
    setEntrySaving(false)
    if (err) { setError(err.message); return }
    setEntryModal(null)
    setEntryForm({ date: '', direction: 'inflow', type: 'invoice', description: '', amount: '' })
    loadCashLog()
  }

  const handleDeleteEntry = async (id) => {
    if (!confirm('Delete this entry?')) return
    const { error: err } = await supabase.from('cash_log').delete().eq('id', id)
    // Only drop the row from view if the delete actually happened.
    if (err) { setError(`Delete failed: ${err.message}`); return }
    setCashLog(prev => prev.filter(e => e.id !== id))
  }


  return (
    <div className="min-h-screen bg-[#F0F4FF]">
      <TutorNav staffName={profile?.full_name} isAdmin />
      <div className="max-w-7xl mx-auto px-4 py-5 md:py-8 space-y-5 md:space-y-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 md:gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Cash Log</h1>
            <p className="text-sm text-[#325099]/60 mt-0.5">Track all cash inflows and outflows</p>
          </div>
          <button onClick={openAddEntry}
            className="w-full md:w-auto justify-center flex items-center gap-1.5 px-4 py-2.5 md:py-2 bg-[#062E63] text-white text-xs font-semibold rounded-xl hover:bg-[#325099] transition">
            + Add Entry
          </button>
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>}

        {(() => {
          // Running balance over the whole log (oldest first), then the date
          // range, then newest at the top.
          const withBalance = cashLog.reduce((acc, e) => {
            acc.push({ ...e, running: (acc.at(-1)?.running || 0) + Number(e.amount) })
            return acc
          }, [])
          const ranged = !!(clDateFrom || clDateTo)
          const rows = withBalance
            .filter(e => (!clDateFrom || e.date >= clDateFrom) && (!clDateTo || e.date <= clDateTo))
            .reverse()
          const net = rows.reduce((s, e) => s + Number(e.amount), 0)

          return (
            <div className="space-y-5">
              {/* Filters */}
              <div className="flex flex-wrap md:flex-nowrap items-center gap-1.5 text-xs text-[#325099]/60">
                <span className="font-semibold">From</span>
                <input type="date" value={clDateFrom} onChange={e => setClDateFrom(e.target.value)}
                  className="border border-[#DEE7FF] rounded-lg px-2 py-1 text-xs text-[#062E63] focus:outline-none" />
                <span className="font-semibold">To</span>
                <input type="date" value={clDateTo} onChange={e => setClDateTo(e.target.value)}
                  className="border border-[#DEE7FF] rounded-lg px-2 py-1 text-xs text-[#062E63] focus:outline-none" />
                {(clDateFrom || clDateTo) && (
                  <button onClick={() => { setClDateFrom(''); setClDateTo('') }}
                    className="text-[#325099]/50 hover:text-[#325099] underline ml-1">Show all</button>
                )}
              </div>

              {/* Table */}
              {cashLogLoading ? (
                <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" /></div>
              ) : (
                <div className="md:bg-white md:border md:border-[#DEE7FF] md:rounded-2xl md:overflow-hidden">
                  <table className="w-full text-xs phone-cards">
                    <thead>
                      <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
                        {['Date', 'Flow', 'Type', 'Description', 'Amount', 'Balance', ''].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F4FF]">
                      {rows.length === 0 && (
                        <tr><td colSpan={7} data-label="" className="px-4 py-10 text-center text-[#325099]/40">No entries yet.</td></tr>
                      )}
                      {rows.map(e => (
                        <tr key={e.id} className="hover:bg-[#F8FAFF] transition">
                          <td data-label="Date" className="px-4 py-2.5 text-[#325099]/70 whitespace-nowrap">
                            {new Date(e.date + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </td>
                          <td data-label="Flow" className="px-4 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${e.direction === 'inflow' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                              {e.direction === 'inflow' ? '↑ In' : '↓ Out'}
                            </span>
                          </td>
                          <td data-label="Type" className="px-4 py-2.5 text-[#325099]/70 capitalize">{e.type}</td>
                          <td data-label="Description" className="px-4 py-2.5 text-[#062E63] max-w-xs truncate max-md:max-w-none max-md:whitespace-normal">
                            <span className="min-w-0">
                            {e.description || '—'}
                            {/* Booked by the invoice being marked paid, not typed
                                in — deleting it here won't un-pay the invoice. */}
                            {e.invoice_id && (
                              <span title="Added automatically when this cash invoice was marked paid"
                                className="ml-1.5 align-middle text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#EEF4FF] text-[#325099]">auto</span>
                            )}
                            </span>
                          </td>
                          <td data-label="Amount" className={`px-4 py-2.5 font-semibold tabular-nums ${Number(e.amount) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                            {Number(e.amount) >= 0 ? '+' : ''}{fmt(Number(e.amount))}
                          </td>
                          <td data-label="Balance" className={`px-4 py-2.5 font-semibold tabular-nums ${e.running >= 0 ? 'text-[#062E63]' : 'text-red-600'}`}>
                            {fmt(e.running)}
                          </td>
                          <td data-label="" className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex justify-end gap-2 md:block">
                              <button onClick={() => openEditEntry(e)} title="Edit this entry"
                                className="text-[#325099]/40 hover:text-[#325099] transition md:mr-2 max-md:text-[#325099] max-md:border max-md:border-[#DEE7FF] max-md:rounded-lg max-md:px-3 max-md:py-2">✎<span className="md:hidden"> Edit</span></button>
                              <button onClick={() => handleDeleteEntry(e.id)} title="Delete this entry"
                                className="text-red-400 hover:text-red-600 transition max-md:border max-md:border-red-200 max-md:rounded-lg max-md:px-3 max-md:py-2">✕<span className="md:hidden"> Delete</span></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {rows.length > 0 && (
                      <tfoot className="max-md:block">
                        <tr className="bg-[#F8FAFF] border-t-2 border-[#DEE7FF] max-md:flex max-md:items-center max-md:justify-between max-md:border-2 max-md:rounded-[14px]">
                          <td colSpan={4} className="px-4 py-3 text-xs font-bold text-[#062E63]">{ranged ? 'Net for these dates' : 'Net Total'}</td>
                          <td colSpan={2} className={`px-4 py-3 text-sm font-bold tabular-nums ${net >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                            {net >= 0 ? '+' : ''}{fmt(net)}
                          </td>
                          <td className="max-md:hidden" />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          )
        })()}

        {/* Add / Edit Entry Modal */}
        {entryModal && (() => {
          const types = entryForm.direction === 'inflow' ? ['invoice', 'gift', 'withdrawal'] : ['wages', 'return']
          const canSave = entryForm.date && entryForm.amount && entryForm.type
          const isNew = entryModal === 'new'
          const linked = !isNew && cashLog.find(e => e.id === entryModal)?.invoice_id
          return (
            <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4">
              <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto p-5 md:p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-[#062E63]">{isNew ? 'Add Cash Entry' : 'Edit Cash Entry'}</h2>
                  <button onClick={() => setEntryModal(null)} className="text-[#325099]/50 hover:text-[#325099] text-lg leading-none p-2 -m-2 md:p-0 md:m-0">✕</button>
                </div>
                {linked && (
                  <p className="text-[11px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3 py-2 leading-relaxed">
                    This line was added automatically when its cash invoice was marked paid. Your edits are kept,
                    but un-marking that invoice still removes the line.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#325099]">Date</label>
                    <input type="date" value={entryForm.date} onChange={e => setEntryForm(f => ({ ...f, date: e.target.value }))}
                      className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#325099]/30" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-[#325099]">Cash Flow</label>
                    <select value={entryForm.direction} onChange={e => setEntryForm(f => ({ ...f, direction: e.target.value, type: e.target.value === 'inflow' ? 'invoice' : 'wages' }))}
                      className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30">
                      <option value="inflow">↑ Inflow</option>
                      <option value="outflow">↓ Outflow</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#325099]">Type</label>
                  <select value={entryForm.type} onChange={e => setEntryForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/30">
                    {types.map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#325099]">Description</label>
                  <input type="text" placeholder="Optional details…" value={entryForm.description} onChange={e => setEntryForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#325099]/30" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[#325099]">Amount ($)</label>
                  <input type="number" min="0" step="0.01" placeholder="0.00" value={entryForm.amount} onChange={e => setEntryForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#325099]/30" />
                  <p className="text-[10px] text-[#325099]/40">Enter as a positive number — direction is set above</p>
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setEntryModal(null)} className="flex-1 px-4 py-2.5 md:py-2 border border-[#DEE7FF] text-xs font-semibold text-[#325099] rounded-lg hover:bg-[#F0F4FF] transition">Cancel</button>
                  <button onClick={handleSaveEntry} disabled={entrySaving || !canSave}
                    className="flex-1 px-4 py-2.5 md:py-2 bg-[#062E63] text-white text-xs font-semibold rounded-lg hover:bg-[#325099] transition disabled:opacity-40">
                    {entrySaving ? 'Saving…' : isNew ? 'Add Entry' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

      </div>
    </div>
  )
}
