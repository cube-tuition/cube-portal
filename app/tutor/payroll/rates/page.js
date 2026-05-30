'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { T_CURRENT_TUTOR_RATES, T_TUTOR_RATE_MATRIX } from '../../../../lib/tables'

/*
 * Admin rates matrix — mirrors the spreadsheet:
 *   rows  = tutors with role tutor/admin
 *   cols  = 4 year_bands × 2 modes (Tutor / Class)
 *   cells = current hourly rate
 *
 * Save semantics: editing a cell upserts into tutor_rate_matrix with
 * effective_from = today. Same-day re-edits overwrite the same row (via
 * the unique constraint + ON CONFLICT). Past rows are never touched, so
 * shift history stays accurate.
 */

const YEAR_BANDS = ['1-6', '7-8', '9-10', '11-12']
const MODES = [
  { key: 'tutor', label: 'Tutor', sub: '1-on-1' },
  { key: 'class', label: 'Class', sub: 'Group' },
]

const fmtMoney = (n) => n == null ? '—' : '$' + Number(n).toFixed(2)

export default function RatesMatrixPage() {
  const [staff, setStaff] = useState(null)
  const [tutors, setTutors] = useState([])
  const [rates, setRates] = useState({}) // key: `${tutor_id}|${band}|${mode}` → row
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingCell, setSavingCell] = useState(null)
  const router = useRouter()

  const reload = async () => {
    setLoading(true); setError(null)
    try {
      // All tutors + admins from their respective tables
      const [{ data: tutorRows, error: te }, { data: adminRows, error: ae }] = await Promise.all([
        supabase.from(T_TUTORS).select('id, full_name').order('full_name'),
        supabase.from(T_ADMINS).select('id, full_name').order('full_name'),
      ])
      if (te) throw te
      if (ae) throw ae
      const combined = [
        ...(tutorRows || []).map(t => ({ ...t, role: 'tutor' })),
        ...(adminRows || []).map(a => ({ ...a, role: 'admin' })),
      ].sort((a, b) => a.full_name.localeCompare(b.full_name))
      setTutors(combined)

      // Current effective rate per cell
      const { data: r, error: re } = await supabase
        .from(T_CURRENT_TUTOR_RATES)
        .select('*')
      if (re) throw re
      const map = {}
      for (const row of r || []) {
        map[`${row.tutor_id}|${row.year_band}|${row.mode}`] = row
      }
      setRates(map)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    (async () => {
      const { user, profile } = await getAuthProfile()
      if (!user) { router.push('/'); return }
      if (!profile || profile.role !== 'admin') { router.push('/tutor'); return }
      setStaff(profile)
      reload()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveCell = async (tutorId, band, mode, raw) => {
    const key = `${tutorId}|${band}|${mode}`
    const prev = rates[key]
    if (raw === '') {
      // Empty input: no-op (we don't delete cells, just leave the prior value).
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) { alert('Rate must be a non-negative number.'); return }
    if (prev && Number(prev.hourly_rate) === n) return // unchanged

    setSavingCell(key)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const { error: e } = await supabase
        .from(T_TUTOR_RATE_MATRIX)
        .upsert({
          tutor_id: tutorId,
          year_band: band,
          mode,
          hourly_rate: n,
          effective_from: today,
          notes: 'Edited from rates matrix UI',
        }, { onConflict: 'tutor_id,year_band,mode,effective_from' })
      if (e) throw e
      await reload()
    } catch (e) {
      alert('Save failed: ' + (e.message || String(e)))
    } finally {
      setSavingCell(null)
    }
  }

  const totals = useMemo(() => {
    const filled = Object.values(rates).length
    const expected = (tutors?.length || 0) * YEAR_BANDS.length * MODES.length
    return { filled, expected, missing: Math.max(expected - filled, 0) }
  }, [rates, tutors])

  if (!staff) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-[#325099] text-sm font-semibold tracking-[0.2em] uppercase font-display">
        Loading…
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-white">
      <TutorNav staffName={staff.full_name} isAdmin={true} />

      <section className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-10">
          <div className="flex items-center gap-3 mb-2">
            <Link href="/tutor/payroll" className="text-xs font-semibold text-[#325099] hover:text-[#062E63] transition">
              ← Payroll
            </Link>
            <span className="text-[#325099]/40">·</span>
            <p className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold font-display">
              Rates matrix
            </p>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[#2A2035] font-display">
            Tutor × year × mode
          </h1>
          <p className="text-sm text-[#2A2035]/60 mt-2 max-w-2xl">
            One rate per cell. Edits take effect from today — past shifts keep
            the rate that was active when they were created.
          </p>
          <div className="mt-6 flex gap-3">
            <div className="bg-white/70 backdrop-blur rounded-2xl border border-[#DEE7FF] px-5 py-3">
              <p className="text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold mb-1">Filled</p>
              <p className="text-xl font-bold text-[#2A2035] font-display">
                {totals.filled} <span className="text-sm font-medium text-[#2A2035]/50">/ {totals.expected}</span>
              </p>
            </div>
            {totals.missing > 0 && (
              <div className="bg-[#FEF3C7] border border-[#FCD34D] rounded-2xl px-5 py-3">
                <p className="text-[10px] tracking-[0.25em] uppercase text-[#92400E] font-semibold mb-1">Missing</p>
                <p className="text-xl font-bold text-[#92400E] font-display">{totals.missing}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        {loading && <p className="text-sm text-[#2A2035]/60">Loading rates…</p>}
        {error && (
          <div className="bg-[#FEE2E2] border border-[#FCA5A5] rounded-xl p-4 text-sm text-[#991B1B] mb-6">
            {error}
          </div>
        )}

        {!loading && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
                  <th className="sticky left-0 bg-[#F8FAFF] text-left px-5 py-3 text-[10px] tracking-[0.25em] uppercase text-[#325099] font-semibold">
                    Tutor
                  </th>
                  {YEAR_BANDS.map(band => (
                    <th key={band} colSpan={2} className="text-center px-2 py-3 text-[11px] font-semibold text-[#062E63] border-l border-[#DEE7FF]">
                      Y{band}
                    </th>
                  ))}
                </tr>
                <tr className="bg-[#F8FAFF] border-b border-[#DEE7FF]">
                  <th className="sticky left-0 bg-[#F8FAFF]" />
                  {YEAR_BANDS.flatMap(band => MODES.map(m => (
                    <th key={`${band}-${m.key}`}
                        className="text-center px-2 py-2 text-[10px] tracking-[0.2em] uppercase text-[#325099]/70 font-semibold border-l border-[#DEE7FF]"
                        title={m.sub}
                    >
                      {m.label}
                    </th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {tutors.map(t => (
                  <tr key={t.id} className="border-b border-[#DEE7FF] last:border-b-0">
                    <td className="sticky left-0 bg-white px-5 py-3 font-semibold text-[#2A2035] whitespace-nowrap">
                      {t.full_name}
                      {t.role === 'admin' && (
                        <span className="ml-2 text-[9px] tracking-widest uppercase text-[#325099]/60">admin</span>
                      )}
                    </td>
                    {YEAR_BANDS.flatMap(band => MODES.map(m => {
                      const key = `${t.id}|${band}|${m.key}`
                      const row = rates[key]
                      const missing = !row
                      const saving = savingCell === key
                      return (
                        <td key={key} className={`border-l border-[#DEE7FF] p-0 ${missing ? 'bg-[#FFFBEB]' : ''}`}>
                          <input
                            key={`${key}-${row?.hourly_rate ?? 'null'}`}
                            type="number"
                            step="0.50"
                            min="0"
                            defaultValue={row ? Number(row.hourly_rate).toFixed(2) : ''}
                            onBlur={e => saveCell(t.id, band, m.key, e.target.value)}
                            disabled={saving}
                            placeholder="—"
                            className={`w-24 text-center px-2 py-3 text-sm font-semibold bg-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#325099] ${
                              missing ? 'text-[#92400E]' : 'text-[#062E63]'
                            } ${saving ? 'opacity-50' : ''}`}
                          />
                        </td>
                      )
                    }))}
                  </tr>
                ))}
                {tutors.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center text-sm text-[#2A2035]/50 py-10">
                      No tutors yet. Add students with role <span className="font-mono">tutor</span> or <span className="font-mono">admin</span>.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-[#2A2035]/50 mt-4">
          <strong>Tutor</strong> = 1-on-1 (class name contains &ldquo;1 on 1&rdquo;). <strong>Class</strong> = group classes.
          Saved with <span className="font-mono">effective_from = today</span>; same-day edits overwrite the same row.
        </p>
      </section>

      <footer className="border-t border-[#DEE7FF] bg-white mt-10">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-5 text-center">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold">
            © CUBE Tuition · Chatswood
          </p>
        </div>
      </footer>
    </div>
  )
}
