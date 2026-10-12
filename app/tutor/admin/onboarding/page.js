'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import { authedFetch } from '../../../../lib/authedFetch'
import TutorNav from '../../../../components/TutorNav'
import { SUPER_RATE } from '../../../../lib/teacherCost'
import { buildPayRatesPdfBase64, rateRows } from '../../../../lib/payRatesPdf'
import {
  DOCS, TEMPLATES, STATUS_LABEL, ONBOARDING_BUCKET,
  buildOnboardingEmailHtml, onboardingSubject,
} from '../../../../lib/onboarding'

/*
 * Onboarding — /tutor/admin/onboarding (directors only; Admin → Staff)
 *
 * Send a newly hired tutor their onboarding pack and track it:
 *   1. Details — name, email, start date. Finds their tutor record by email or
 *      creates it (so they can be given pay rates and appear in Payroll).
 *   2. Pay rates — read from Payroll → Rates; they become the attached
 *      "CUBE Pay Rates" PDF the Employment Agreement refers to.
 *   3. Send — the email carries the three CUBE documents, the pay rates and a
 *      private upload link (/onboarding/<token>, no login) for the six
 *      documents they return.
 * All three steps happen in a modal ("＋ New onboarding pack"). Below, a card
 * per pack shows which documents are in (view each); its name or Send…/Resend…
 * reopens the modal at the preview. Cards also copy the link and mark
 * onboarding complete. The pack's three CUBE documents can be replaced at the
 * bottom of the page.
 */

const fmtDay = (iso) => {
  if (!iso) return ''
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}
const STATUS_CHIP = {
  draft: 'bg-[#F3F4F6] text-[#4B5563]',
  sent: 'bg-[#FEF3C7] text-[#92400E]',
  submitted: 'bg-[#DBEAFE] text-[#1E40AF]',
  complete: 'bg-[#D1FAE5] text-[#065F46]',
}
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`
const field = 'w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#325099]'
const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold border transition disabled:opacity-50'

async function loadRates(tutorId) {
  const { data } = await supabase.from('current_tutor_rates')
    .select('year_band, mode, hourly_rate, effective_from').eq('tutor_id', tutorId)
  return data || []
}
async function payRatesPdfFor(tutor, rates) {
  if (!rates.length) return null
  const latest = rates.map(r => r.effective_from).filter(Boolean).sort().at(-1)
  return buildPayRatesPdfBase64({
    tutorName: tutor.full_name, rates, payMethod: tutor.pay_method,
    superRate: SUPER_RATE, effectiveFrom: latest ? fmtDay(latest) : '',
  })
}
async function openSigned(query) {
  const res = await authedFetch(`/api/onboarding/file?${query}`)
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.url) { alert(j.error || 'Could not open the file.'); return }
  window.open(j.url, '_blank', 'noopener')
}

export default function OnboardingPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [ready, setReady] = useState(false)
  const [packs, setPacks] = useState(null)
  const [files, setFiles] = useState({})          // onboarding id → { doc_key → file }
  const [reloadKey, setReloadKey] = useState(0)
  const [tab, setTab] = useState('open')
  const [composer, setComposer] = useState(null)   // null = closed · { pack } = open (pack null for a new one)
  const reload = () => setReloadKey(k => k + 1)

  useEffect(() => {
    (async () => {
      const { profile, role } = await getAuthProfile()
      if (!profile || (role !== 'admin' && role !== 'director')) { router.replace('/tutor'); return }
      setProfile(profile); setReady(true)
    })()
  }, [router])

  useEffect(() => {
    if (!ready) return
    let alive = true
    ;(async () => {
      const [{ data: p }, { data: f }] = await Promise.all([
        supabase.from('tutor_onboarding').select('*, tutors(full_name, pay_method)').order('created_at', { ascending: false }),
        supabase.from('tutor_onboarding_files').select('id, onboarding_id, doc_key, filename, uploaded_at, size_bytes'),
      ])
      if (!alive) return
      const by = {}
      for (const x of f || []) (by[x.onboarding_id] ||= {})[x.doc_key] = x
      setPacks(p || []); setFiles(by)
    })()
    return () => { alive = false }
  }, [ready, reloadKey])

  const shown = useMemo(() => (packs || []).filter(p =>
    tab === 'all' ? true : tab === 'complete' ? p.status === 'complete' : p.status !== 'complete'), [packs, tab])

  if (!ready) return <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center text-sm text-[#2A2035]/40 animate-pulse">Loading…</div>

  const counts = {
    open: (packs || []).filter(p => p.status !== 'complete').length,
    complete: (packs || []).filter(p => p.status === 'complete').length,
    all: (packs || []).length,
  }

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={true} />
      <div className="max-w-5xl mx-auto px-4 pt-5 pb-16 md:px-6 md:pt-10 space-y-6">
        <div className="rounded-2xl px-5 py-5 md:px-7 md:py-6 border bg-[#EEF3FF] border-[#DEE7FF]">
          <div className="flex items-center gap-3">
            <span className="text-3xl">👋</span>
            <div>
              <h1 className="text-2xl font-bold text-[#062E63]">Onboarding</h1>
              <p className="text-xs text-[#2A2035]/55 mt-0.5">Send a new tutor their onboarding pack and track the six documents they send back.</p>
            </div>
          </div>
        </div>

        <section>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h2 className="text-sm font-bold text-[#062E63] mr-2">Onboarding packs</h2>
            {[['open', 'In progress'], ['complete', 'Complete'], ['all', 'All']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border ${tab === k ? 'bg-[#062E63] text-white border-[#062E63]' : 'bg-white text-[#325099] border-[#DEE7FF]'}`}>
                {label} <span className={tab === k ? 'text-white/70' : 'text-[#2A2035]/40'}>{counts[k]}</span>
              </button>
            ))}
            <button type="button" onClick={() => setComposer({ pack: null })}
              className="ml-auto px-4 py-2 rounded-xl text-sm font-bold bg-[#062E63] text-white hover:bg-[#325099] transition">＋ New onboarding pack</button>
          </div>
          {packs == null ? (
            <p className="text-sm text-[#2A2035]/40 animate-pulse py-6 text-center">Loading packs…</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-[#2A2035]/40 italic py-8 text-center bg-white rounded-2xl border border-[#F0F4FF]">
              {tab === 'complete' ? 'No completed onboarding yet.' : 'No onboarding in progress.'}
            </p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {shown.map(p => <PackCard key={p.id} pack={p} files={files[p.id] || {}} profile={profile} onChanged={reload} onOpen={() => setComposer({ pack: p })} />)}
            </div>
          )}
        </section>

        <Templates />
      </div>
      {composer && (
        <Composer key={composer.pack?.id || 'new'} pack={composer.pack} onClose={() => setComposer(null)}
          onSent={() => { setComposer(null); reload() }} />
      )}
    </div>
  )
}

// ── Send a pack (modal) ──────────────────────────────────────────────────────
// New pack: details → rates → preview → send. Opened from a pack card, it starts
// at the preview with that pack's details (prepare reuses the open pack).
function Composer({ pack, onClose, onSent }) {
  const [form, setForm] = useState({ name: pack?.full_name || '', email: pack?.email || '', startDate: pack?.start_date || '', note: pack?.note || '' })
  const [prepared, setPrepared] = useState(null)   // { onboarding, tutor, tutorCreated }
  const [rates, setRates] = useState(null)
  const [noRatesOk, setNoRatesOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const reset = () => { setForm({ name: '', email: '', startDate: '', note: '' }); setPrepared(null); setRates(null); setNoRatesOk(false) }

  const refreshRates = useCallback(async (tutorId) => setRates(await loadRates(tutorId)), [])

  const prepare = useCallback(async (f) => {
    setBusy(true); setMsg(null)
    try {
      const res = await authedFetch('/api/onboarding/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name, email: f.email, startDate: f.startDate || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Could not continue')
      setPrepared(j)
      if (j.onboarding?.note) setForm(x => (x.note ? x : { ...x, note: j.onboarding.note }))
      await refreshRates(j.tutor.id)
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }, [refreshRates])

  // Opened from a pack card: go straight to the preview.
  useEffect(() => {
    if (pack) Promise.resolve().then(() => prepare({ name: pack.full_name, email: pack.email, startDate: pack.start_date }))
  }, [pack, prepare])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const send = async (test) => {
    if (!prepared) return
    if (!test && !window.confirm(`Send the onboarding pack to ${prepared.onboarding.email}?`)) return
    setBusy(true); setMsg(null)
    try {
      const payRatesPdf = await payRatesPdfFor(prepared.tutor, rates || [])
      const res = await authedFetch('/api/onboarding/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboardingId: prepared.onboarding.id, note: form.note, payRatesPdf, test }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Send failed')
      if (test) setMsg('Test sent to staff — the tutor did not receive it.')
      else onSent()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const rows = rateRows(rates || [])
  const canSend = prepared && (rows.length > 0 || noRatesOk)
  const link = prepared ? `${window.location.origin}/onboarding/${prepared.onboarding.token}` : ''
  const attached = [...TEMPLATES.map(t => t.label), ...(rows.length ? ['CUBE Pay Rates'] : [])]
  const preview = prepared ? buildOnboardingEmailHtml({ ...prepared.onboarding, note: form.note }, link, attached) : ''

  return (
    <div className="fixed inset-0 z-50 bg-[#062E63]/40 flex items-start justify-center overflow-y-auto px-3 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <section className="w-full max-w-3xl bg-white rounded-2xl border border-[#DEE7FF] shadow-xl p-5 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-[#062E63]">{pack ? `Onboarding pack — ${pack.full_name}` : 'New onboarding pack'}</h2>
        <div className="flex items-center gap-3">
          {prepared && !pack && <button type="button" onClick={reset} className="text-[11px] text-[#325099] hover:underline">Start again</button>}
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full text-[#2A2035]/50 hover:bg-[#F0F4FF] hover:text-[#2A2035]">✕</button>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-[11px] font-semibold text-[#325099]/70">Full name
          <input value={form.name} onChange={set('name')} disabled={!!prepared} className={`${field} mt-1`} placeholder="e.g. Jess Lee" />
        </label>
        <label className="text-[11px] font-semibold text-[#325099]/70">Email
          <input type="email" value={form.email} onChange={set('email')} disabled={!!prepared} className={`${field} mt-1`} placeholder="jess@example.com" />
        </label>
        <label className="text-[11px] font-semibold text-[#325099]/70">Start date (optional)
          <input type="date" value={form.startDate} onChange={set('startDate')} disabled={!!prepared} className={`${field} mt-1`} />
        </label>
      </div>

      {!prepared ? (
        <button type="button" disabled={busy || !form.name.trim() || !form.email.trim()} onClick={() => prepare(form)}
          className="px-4 py-2 rounded-xl text-sm font-bold bg-[#062E63] text-white disabled:opacity-50">{busy ? 'Working…' : 'Continue'}</button>
      ) : (
        <>
          <p className="text-xs text-[#2A2035]/65">
            {prepared.tutorCreated
              ? <>A tutor record was created for <strong>{prepared.tutor.full_name}</strong> — they now appear in the database and Payroll.</>
              : <>Using the existing tutor record for <strong>{prepared.tutor.full_name}</strong>.</>}
            {prepared.onboarding.status !== 'draft' && <> This tutor already has a pack in progress — sending again re-sends the same upload link.</>}
          </p>

          <div className="rounded-xl border border-[#DEE7FF] bg-[#FBFCFF] p-4">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#325099]/70 flex-1">Pay rates (attached as “CUBE Pay Rates”)</p>
              <a href="/tutor/payroll/rates" target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#325099] hover:underline">Payroll → Rates ↗</a>
              <button type="button" onClick={() => refreshRates(prepared.tutor.id)} className="text-[11px] text-[#325099] hover:underline">↻ Refresh</button>
            </div>
            {rates == null ? <p className="text-xs text-[#2A2035]/40 animate-pulse">Loading rates…</p>
              : rows.length === 0 ? (
                <div className="text-xs text-[#92400E] space-y-2">
                  <p>No pay rates set for {prepared.tutor.full_name} yet. Set them in Payroll → Rates, then press Refresh.</p>
                  <label className="flex items-center gap-2 text-[#2A2035]/70">
                    <input type="checkbox" checked={noRatesOk} onChange={e => setNoRatesOk(e.target.checked)} /> Send without a pay rates document
                  </label>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead><tr className="text-[10px] uppercase tracking-wide text-[#325099]/60"><th className="text-left py-1">Years</th><th className="text-right py-1">Class / hr</th><th className="text-right py-1">1:1 / hr</th></tr></thead>
                  <tbody>{rows.map(r => (
                    <tr key={r.band} className="border-t border-[#EEF2FB]"><td className="py-1.5 font-semibold text-[#2A2035]">{r.label}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.cls != null ? money(r.cls) : '—'}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.one != null ? money(r.one) : '—'}</td></tr>
                  ))}</tbody>
                </table>
              )}
          </div>

          <label className="block text-[11px] font-semibold text-[#325099]/70">Personal note in the email (optional)
            <textarea value={form.note} onChange={set('note')} rows={2} className={`${field} mt-1 resize-y`} placeholder="e.g. You'll be teaching Y8 Maths on Tuesdays with Daniel." />
          </label>

          <details open className="rounded-xl border border-[#EEF2FB] bg-white">
            <summary className="px-3 py-2 text-[11px] font-semibold text-[#325099] cursor-pointer">Preview the email — “{onboardingSubject()}”</summary>
            <iframe title="Onboarding email preview" srcDoc={preview} className="w-full h-[640px] border-0" />
          </details>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || !canSend} onClick={() => send(false)}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-[#062E63] text-white disabled:opacity-50">{busy ? 'Sending…' : `✉️ Send to ${prepared.onboarding.email}`}</button>
            <button type="button" disabled={busy || !canSend} onClick={() => send(true)}
              className={`${btn} bg-white text-[#325099] border-[#DEE7FF]`}>Send test to staff</button>
          </div>
        </>
      )}
      {msg && <p className={`text-xs font-semibold ${/^(Sent|Test sent)/.test(msg) ? 'text-[#065F46]' : 'text-[#B91C1C]'}`}>{msg}</p>}
    </section>
    </div>
  )
}

// ── One pack ─────────────────────────────────────────────────────────────────
function PackCard({ pack, files, profile, onChanged, onOpen }) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const done = DOCS.filter(d => files[d.key]).length
  const link = `${window.location.origin}/onboarding/${pack.token}`

  const update = async (patch) => {
    setBusy(true)
    const { error } = await supabase.from('tutor_onboarding').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', pack.id)
    setBusy(false)
    if (error) alert(error.message); else onChanged()
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { window.prompt('Upload link:', link) }
  }
  const remove = async () => {
    if (!window.confirm(`Delete ${pack.full_name}'s onboarding pack? Their tutor record is kept.`)) return
    setBusy(true)
    const { error } = await supabase.from('tutor_onboarding').delete().eq('id', pack.id)
    setBusy(false)
    if (error) alert(error.message); else onChanged()
  }

  return (
    <div className="bg-white rounded-2xl border border-[#F0F4FF] p-4 space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <button type="button" onClick={onOpen} title="Open the pack — rates, email preview, send" className="block max-w-full text-left text-sm font-bold text-[#062E63] truncate hover:underline">{pack.full_name}</button>
          <p className="text-[11px] text-[#2A2035]/50 truncate">{pack.email}{pack.start_date ? ` · starts ${fmtDay(pack.start_date)}` : ''}</p>
        </div>
        <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${STATUS_CHIP[pack.status]}`}>{STATUS_LABEL[pack.status]}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-[#EEF3FF] overflow-hidden"><div className="h-full bg-[#10B981]" style={{ width: `${(done / DOCS.length) * 100}%` }} /></div>
        <span className="text-[11px] font-bold text-[#062E63] tabular-nums">{done}/{DOCS.length}</span>
      </div>
      <ul className="space-y-1">
        {DOCS.map(d => {
          const f = files[d.key]
          return (
            <li key={d.key} className="flex items-center gap-2 text-xs">
              <span className={`w-4 text-center ${f ? 'text-[#10B981]' : 'text-[#2A2035]/25'}`}>{f ? '✓' : '○'}</span>
              <span className={`flex-1 min-w-0 truncate ${f ? 'text-[#2A2035]' : 'text-[#2A2035]/45'}`}>{d.label}</span>
              {f && <button type="button" onClick={() => openSigned(`id=${f.id}`)} className="text-[11px] text-[#325099] hover:underline shrink-0" title={`${f.filename} · ${fmtDay(f.uploaded_at)}`}>View</button>}
            </li>
          )
        })}
      </ul>
      <p className="text-[10px] text-[#2A2035]/40">
        {pack.sent_at ? `Sent ${fmtDay(pack.sent_at)}${pack.sent_by_name ? ` by ${pack.sent_by_name.split(' ')[0]}` : ''}${pack.sent_count > 1 ? ` · ${pack.sent_count} times` : ''}` : 'Not sent yet'}
        {pack.submitted_at ? ` · all in ${fmtDay(pack.submitted_at)}` : ''}
        {pack.completed_at ? ` · completed ${fmtDay(pack.completed_at)}${pack.completed_by_name ? ` by ${pack.completed_by_name.split(' ')[0]}` : ''}` : ''}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {pack.status !== 'complete' && (
          <>
            <button type="button" disabled={busy} onClick={onOpen} className={`${btn} bg-white text-[#325099] border-[#DEE7FF]`}>{pack.status === 'draft' ? '✉️ Send…' : '✉️ Resend…'}</button>
            <button type="button" onClick={copy} className={`${btn} bg-white text-[#325099] border-[#DEE7FF]`}>{copied ? 'Copied ✓' : '🔗 Copy upload link'}</button>
            <button type="button" disabled={busy || done < DOCS.length} title={done < DOCS.length ? 'All six documents are needed first' : ''}
              onClick={() => update({ status: 'complete', completed_at: new Date().toISOString(), completed_by_name: profile?.full_name || null })}
              className={`${btn} bg-[#062E63] text-white border-[#062E63]`}>✓ Mark complete</button>
          </>
        )}
        {pack.status === 'complete' && (
          <button type="button" disabled={busy} onClick={() => update({ status: done === DOCS.length ? 'submitted' : 'sent', completed_at: null, completed_by_name: null })}
            className={`${btn} bg-white text-[#325099] border-[#DEE7FF]`}>↩ Reopen</button>
        )}
        {done === 0 && (
          <button type="button" disabled={busy} onClick={remove} className={`${btn} bg-white text-[#B91C1C] border-[#FCA5A5] ml-auto`}>Delete</button>
        )}
      </div>
    </div>
  )
}

// ── The pack's CUBE documents ────────────────────────────────────────────────
function Templates() {
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const replace = async (t, file) => {
    if (!file) return
    if (file.type && file.type !== 'application/pdf') { setMsg('Please choose a PDF.'); return }
    if (!window.confirm(`Replace “${t.label}” with ${file.name}? Every pack sent from now on attaches the new version.`)) return
    setBusy(t.key); setMsg(null)
    try {
      const res = await authedFetch('/api/onboarding/template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: t.key }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Could not replace')
      const { error } = await supabase.storage.from(ONBOARDING_BUCKET).uploadToSignedUrl(j.path, j.token, file, { contentType: 'application/pdf', upsert: true })
      if (error) throw new Error(error.message)
      setMsg(`“${t.label}” replaced.`)
    } catch (e) { setMsg(e.message) } finally { setBusy(null) }
  }
  return (
    <section className="bg-white rounded-2xl border border-[#F0F4FF] p-5 md:p-6">
      <h2 className="text-sm font-bold text-[#062E63] mb-1">Pack documents</h2>
      <p className="text-[11px] text-[#2A2035]/50 mb-3">Attached to every onboarding email, alongside the tutor’s Pay Rates. Replace one to update all future packs.</p>
      <div className="divide-y divide-[#F0F4FF]">
        {TEMPLATES.map(t => (
          <div key={t.key} className="py-2.5 flex items-center gap-2 text-sm">
            <span className="flex-1 min-w-0 truncate text-[#2A2035]">📄 {t.label}</span>
            <button type="button" onClick={() => openSigned(`template=${t.key}`)} className="text-[11px] text-[#325099] hover:underline">View</button>
            <label className={`text-[11px] font-semibold cursor-pointer ${busy === t.key ? 'text-[#2A2035]/40' : 'text-[#325099] hover:underline'}`}>
              {busy === t.key ? 'Uploading…' : 'Replace'}
              <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={busy === t.key}
                onChange={e => { replace(t, e.target.files?.[0]); e.target.value = '' }} />
            </label>
          </div>
        ))}
      </div>
      {msg && <p className="text-xs font-semibold text-[#325099] mt-2">{msg}</p>}
    </section>
  )
}
