'use client'
import { useEffect, useState } from 'react'
import { authedFetch } from '../../lib/authedFetch'

/*
 * Xero Payroll (AU) — push an approved fortnight into Xero as a DRAFT pay run.
 * The portal only writes hours onto draft payslips; a human reviews and posts
 * the pay run in Xero, and THAT is what withholds PAYG, accrues super and files
 * STP with the ATO. The portal never posts.
 *
 * <XeroPayrollButtons> renders next to the other footer actions on the payroll
 * page: a Push button plus a ⚙ setup modal (pay calendar, earnings rate,
 * teacher → Xero employee matching).
 */

const BTN = 'text-sm font-semibold px-4 py-2 rounded-full transition disabled:opacity-50'

export default function XeroPayrollButtons({ run, canPush }) {
  const [setupOpen, setSetupOpen] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [result, setResult] = useState(null)   // push result | {error} | {needsReconnect}

  const push = async () => {
    if (!run?.id) return
    if (!confirm('Push approved hours into Xero Payroll’s current DRAFT pay run?\n\nXero’s draft period defines the window: every approved shift dated inside it — including holiday-break hours — is summed per teacher and written onto their draft payslip. Cash-paid teachers are excluded. Re-pushing simply refreshes the totals. Nothing is filed with the ATO until you review and post the pay run in Xero.')) return
    setPushing(true); setResult(null)
    try {
      const res = await authedFetch('/api/xero/payroll/push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodStart: run.period_start, periodEnd: run.period_end }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setResult(data)
    } catch (e) {
      setResult({ error: e.message })
    } finally {
      setPushing(false)
    }
  }

  return (
    <>
      <button onClick={push} disabled={!canPush || pushing}
        title={canPush ? 'Create/update a draft pay run in Xero Payroll with this fortnight’s hours' : 'Approve the run first'}
        className={`${BTN} text-white bg-[#13B5EA] hover:bg-[#0ea5d9] disabled:bg-[#2A2035]/30`}>
        {pushing ? 'Pushing…' : '⇧ Push to Xero Payroll'}
      </button>
      <button onClick={() => setSetupOpen(true)} title="Xero Payroll setup — pay calendar, earnings rate, employee matching"
        className={`${BTN} text-[#325099] bg-white border border-[#DEE7FF] hover:bg-[#F8FAFF] px-3`}>
        ⚙
      </button>

      {result && (
        <div className="w-full mt-1 text-xs space-y-1">
          {result.needsReconnect && (
            <p className="text-amber-700 font-semibold">
              Xero needs payroll access — <a href="/api/xero/auth" className="underline">reconnect Xero</a> (sign in as the payroll org) then push again.
            </p>
          )}
          {result.error && !result.needsReconnect && <p className="text-rose-600 font-semibold">Push failed: {result.error}</p>}
          {result.success && (
            <>
              <p className="text-[#065F46] font-semibold">
                ✓ Draft pay run in Xero ({result.payRun.periodStart} – {result.payRun.periodEnd}) — {result.pushed.length} teacher{result.pushed.length === 1 ? '' : 's'} updated.
                {' '}Review and post it in Xero to finalise PAYG, super and STP.
              </p>
              {result.pushed.map((p, i) => (
                <p key={i} className="text-[#2A2035]/60">· {p.name}: {p.hours}h{p.rate != null ? ` @ $${p.rate}/h` : ''}</p>
              ))}
              {result.windowDiffers && (
                <p className="text-[#2A2035]/60">ℹ Xero’s pay calendar runs continuously, so its period differs from the fortnight you’re viewing ({result.portalPeriod.join(' – ')}). All approved hours inside Xero’s window were included, so the totals are still right.</p>
              )}
              {result.excludedCash?.map((x, i) => (
                <p key={i} className="text-[#2A2035]/50">💵 {x.name}: {x.hours}h (${x.amount}) paid in cash — not pushed to Xero Payroll.</p>
              ))}
              {result.skipped?.map((s, i) => (
                <p key={i} className="text-amber-700">⚠ {s.name || s.staffId}: {s.reason}</p>
              ))}
            </>
          )}
        </div>
      )}

      {setupOpen && <SetupModal onClose={() => setSetupOpen(false)} />}
    </>
  )
}

function SetupModal({ onClose }) {
  const [cfg, setCfg] = useState(null)       // GET /config payload
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [settings, setSettings] = useState({ payroll_calendar_id: '', earnings_rate_id: '', send_rate: false })
  const [map, setMap] = useState({})         // staff_id -> xero_employee_id

  useEffect(() => {          // load once on mount
    (async () => {
      try {
        const res = await authedFetch('/api/xero/payroll/config')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        setCfg(data)
        if (data.settings) setSettings({
          payroll_calendar_id: data.settings.payroll_calendar_id || '',
          earnings_rate_id:    data.settings.earnings_rate_id || '',
          send_rate:           !!data.settings.send_rate,
        })
        const m = {}
        for (const r of data.map || []) m[r.staff_id] = r.xero_employee_id
        // Auto-suggest unmapped staff by name match (case-insensitive full name,
        // then first name) — suggestions still need an explicit Save.
        for (const s of data.staff || []) {
          if (m[s.id]) continue
          const full = (s.full_name || '').toLowerCase().trim()
          const first = full.split(' ')[0]
          const hit = (data.employees || []).find(e => e.name.toLowerCase() === full)
            || (data.employees || []).find(e => e.first.toLowerCase() === first)
          if (hit) m[s.id] = hit.id
        }
        setMap(m)
      } catch (e) { setErr(e.message) }
    })()
  }, [])

  const save = async () => {
    setSaving(true); setSaved(false); setErr(null)
    try {
      const mapRows = (cfg?.staff || [])
        .filter(s => map[s.id])
        .map(s => ({
          staff_id: s.id, staff_table: s.staff_table,
          xero_employee_id: map[s.id],
          xero_name: (cfg?.employees || []).find(e => e.id === map[s.id])?.name || null,
        }))
      const res = await authedFetch('/api/xero/payroll/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, map: mapRows }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) { setErr(e.message) }
    setSaving(false)
  }

  const L = 'block text-[10px] uppercase tracking-wider text-[#325099]/70 font-semibold mb-1'
  const SEL = 'w-full border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-[#325099]'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#DEE7FF] w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#DEE7FF]">
          <p className="text-sm font-bold text-[#062E63]">Xero Payroll setup</p>
          <button onClick={onClose} className="text-[#325099]/40 hover:text-[#325099] text-xl leading-none">✕</button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5">
          {!cfg && !err && <p className="text-sm text-[#2A2035]/50 animate-pulse">Loading from Xero…</p>}
          {err && <p className="text-xs text-rose-600 font-semibold">{err}</p>}
          {cfg?.needsReconnect && (
            <p className="text-xs text-amber-700 font-semibold bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3 py-2">
              Xero hasn’t granted payroll access yet — <a href="/api/xero/auth" className="underline">reconnect Xero</a> (approve as the payroll org), then reopen this panel.
            </p>
          )}
          {cfg && !cfg.needsReconnect && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={L}>Pay calendar (fortnightly cycle)</label>
                  <select className={SEL} value={settings.payroll_calendar_id}
                    onChange={e => setSettings(s => ({ ...s, payroll_calendar_id: e.target.value }))}>
                    <option value="">— choose —</option>
                    {(cfg.calendars || []).map(c => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
                  </select>
                </div>
                <div>
                  <label className={L}>Earnings rate for taught hours</label>
                  <select className={SEL} value={settings.earnings_rate_id}
                    onChange={e => setSettings(s => ({ ...s, earnings_rate_id: e.target.value }))}>
                    <option value="">— choose —</option>
                    {(cfg.earningsRates || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-[#2A2035]/70 select-none">
                <input type="checkbox" checked={settings.send_rate}
                  onChange={e => setSettings(s => ({ ...s, send_rate: e.target.checked }))} className="accent-[#325099]" />
                Also send the portal’s $/hour with the hours (off = Xero uses each employee’s pay-template rate; only sent when all of a teacher’s shifts share one rate)
              </label>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-[#325099]/70 font-semibold mb-2">Match teachers to Xero employees</p>
                <div className="space-y-1.5">
                  {(cfg.staff || []).map(s => (
                    <div key={s.id} className="grid grid-cols-[1fr_260px] gap-3 items-center">
                      <span className="text-sm text-[#2A2035] truncate">{s.full_name} <span className="text-[10px] text-[#2A2035]/40">({s.staff_table === 'directors' ? 'director' : 'tutor'})</span></span>
                      <select className={SEL} value={map[s.id] || ''}
                        onChange={e => setMap(m => ({ ...m, [s.id]: e.target.value }))}>
                        <option value="">— not in Xero Payroll —</option>
                        {(cfg.employees || []).map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                {(cfg.employees || []).length === 0 && (
                  <p className="text-xs text-amber-700 mt-2">No employees found in Xero Payroll — add them in Xero (Payroll → Employees) first.</p>
                )}
              </div>

              <p className="text-[11px] text-[#2A2035]/45">
                Pushing fills Xero’s current <b>draft</b> pay run: every approved shift dated inside that period —
                term fortnights and holiday breaks alike — is summed per teacher and written onto their payslip.
                PAYG, super and STP happen when you post the pay run in Xero — the portal never posts it.
              </p>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#DEE7FF]">
          <button onClick={onClose} className="text-sm font-semibold text-[#325099] px-3 py-2">Close</button>
          <button onClick={save} disabled={saving || !cfg || cfg.needsReconnect}
            className="text-sm font-semibold text-white bg-[#062E63] hover:bg-[#325099] px-5 py-2 rounded-full disabled:opacity-40">
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save setup'}
          </button>
        </div>
      </div>
    </div>
  )
}
