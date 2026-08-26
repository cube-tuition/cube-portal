'use client'
import { authedFetch } from '../../lib/authedFetch'
import { useState } from 'react'

export function XeroBanner({ xeroConnected, xeroResult, xeroSyncing, termId, onSync, onResetXero, xeroPaymentsEnabled = true }) {
  const [showSettings,  setShowSettings]  = useState(false)
  const [activeTab,     setActiveTab]     = useState('global')
  const [accounts,      setAccounts]      = useState([])
  const [xeroItems,     setXeroItems]     = useState([])
  const [bankAccounts,  setBankAccounts]  = useState([])
  const [settings,      setSettings]      = useState({ enrolment_account_code: '', enrolment_1on1_account_code: '', discount_account_code: '', credit_account_code: '', payment_account_code: '' })
  const [loadingAcc,    setLoadingAcc]    = useState(false)
  const [accError,      setAccError]      = useState(null)
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)
  const [courseNames,   setCourseNames]   = useState([])
  const [hiddenNames,   setHiddenNames]   = useState([])
  const [itemMappings,  setItemMappings]  = useState({})
  const [savingItems,   setSavingItems]   = useState(false)
  const [savedItems,    setSavedItems]    = useState(false)
  const [resetInfo,     setResetInfo]     = useState(null)   // null = not confirming

  const openSettings = async () => {
    setShowSettings(true)
    if (accounts.length) return
    setLoadingAcc(true); setAccError(null)
    try {
      const [accRes, xeroItemsRes, settRes, itemMappingRes] = await Promise.all([
        authedFetch('/api/xero/accounts').then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }),
        authedFetch('/api/xero/items').then(r => r.json()),
        authedFetch('/api/xero/settings').then(r => r.json()),
        authedFetch('/api/xero/item-mappings' + (termId ? '?term_id=' + termId : '')).then(r => r.json()),
      ])
      if (!accRes.accounts?.length) throw new Error('No accounts returned from Xero — your chart of accounts may be empty or all accounts are archived.')
      setAccounts(accRes.accounts)
      setBankAccounts(accRes.bankAccounts || [])
      setXeroItems(xeroItemsRes.items || [])
      if (settRes && !settRes.error) setSettings({
        enrolment_account_code:      settRes.enrolment_account_code      || '',
        enrolment_1on1_account_code: settRes.enrolment_1on1_account_code || '',
        discount_account_code:       settRes.discount_account_code       || '',
        credit_account_code:         settRes.credit_account_code         || '',
        payment_account_code:        settRes.payment_account_code        || '',
      })
      const names = itemMappingRes.courseNames || []
      setCourseNames(names)
      setHiddenNames(itemMappingRes.hiddenCourseNames || [])
      const mappingMap = {}
      for (const m of (itemMappingRes.mappings || [])) {
        mappingMap[m.class_name] = { item_code: m.item_code || '', item_name: m.item_name || '' }
      }
      for (const n of names) {
        if (!mappingMap[n]) mappingMap[n] = { item_code: '', item_name: '' }
      }
      setItemMappings(mappingMap)
    } catch (e) { setAccError(e.message) }
    setLoadingAcc(false)
  }

  // Two steps on purpose: this unlinks real accounting records, and the count
  // is the whole point of the confirmation — "reset 89 invoices" is a very
  // different decision from "reset 3".
  const askReset = async () => {
    setResetInfo({ loading: true })
    try {
      const r = await authedFetch('/api/xero/reset?term_id=' + termId)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setResetInfo(d)
    } catch (e) { setResetInfo({ error: e.message }) }
  }

  const handleSaveGlobal = async () => {
    setSaving(true); setSaved(false)
    await authedFetch('/api/xero/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSaveItems = async () => {
    setSavingItems(true); setSavedItems(false)
    const rows = Object.entries(itemMappings).map(([class_name, v]) => ({
      class_name,
      item_code: v.item_code || null,
      item_name: v.item_name || null,
    }))
    await authedFetch('/api/xero/item-mappings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings: rows }),
    })
    setSavingItems(false); setSavedItems(true)
    setTimeout(() => setSavedItems(false), 2000)
  }

  const AccountSelect = ({ field, label }) => (
    <div>
      <label className="block text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-1">{label}</label>
      <select
        value={settings[field] || ''}
        onChange={e => setSettings(p => ({ ...p, [field]: e.target.value }))}
        className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs text-[#062E63] bg-white focus:outline-none focus:border-[#325099]"
      >
        <option value="">— not mapped</option>
        {accounts.map(a => (
          <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
        ))}
      </select>
    </div>
  )

  // Retired courses (Homework Help and the like) no longer generate invoices,
  // so they are dropped from the list rather than sitting there unmappable.
  // Their saved rows are left untouched in the database — Save only upserts the
  // names shown here, and the push looks mappings up by name server-side, so a
  // historical invoice that still references one keeps pushing correctly.
  const retired = new Set(hiddenNames)
  const allCourseNames = [...new Set([
    ...courseNames,
    ...Object.keys(itemMappings).filter(k => itemMappings[k].item_code),
  ])].filter(n => !retired.has(n)).sort()

  return (
    <div className="bg-white border border-[#DEE7FF] rounded-xl mb-5 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${xeroConnected === null ? 'bg-gray-300 animate-pulse' : xeroConnected ? 'bg-[#10b981]' : 'bg-red-400'}`} />
          <span className="text-sm text-[#062E63] font-semibold">
            Xero {xeroConnected === null ? 'checking…' : xeroConnected ? 'connected' : 'not connected'}
          </span>
          {xeroConnected && xeroResult && (
            <span className="text-xs text-[#325099]/60">
              {/* Everything held back is named, or a "3 pushed" on a 54-invoice
                  term reads as a failure. `already_in_xero` is usually the bulk
                  of the gap: those invoices were sent by an earlier sync and are
                  never candidates again. */}
              Last sync: {xeroResult.pushed} pushed
              {xeroResult.already_in_xero ? `, ${xeroResult.already_in_xero} already in Xero` : ''}
              {xeroResult.voided_skipped ? `, ${xeroResult.voided_skipped} voided` : ''}
              {xeroResult.cash_skipped ? `, ${xeroResult.cash_skipped} cash (not sent)` : ''}
              {xeroResult.draft_skipped ? `, ${xeroResult.draft_skipped} still draft` : ''}
              {xeroResult.no_line_items ? `, ${xeroResult.no_line_items} with no billable lines` : ''}
              {xeroResult.errors?.length ? `, ${xeroResult.errors.length} errors` : ''}
              {xeroResult.payments?.applied ? `, ${xeroResult.payments.applied} marked paid in Xero` : ''}
              {xeroResult.payments?.reversed ? `, ${xeroResult.payments.reversed} payment${xeroResult.payments.reversed === 1 ? '' : 's'} reversed` : ''}
              {xeroResult.payments?.pending?.length ? `, ${xeroResult.payments.pending.length} payment${xeroResult.payments.pending.length === 1 ? '' : 's'} not applied` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {xeroConnected && termId && (
            <button onClick={onSync} disabled={xeroSyncing}
              className="text-xs font-semibold text-[#065F46] bg-[#ECFDF5] border border-[#A7F3D0] hover:bg-[#D1FAE5] px-4 py-1.5 rounded-full transition disabled:opacity-40">
              {xeroSyncing ? 'Syncing…' : '↑ Sync to Xero'}
            </button>
          )}
          {xeroConnected && termId && onResetXero && (
            resetInfo ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#325099]/70">
                  {resetInfo.loading ? 'Checking…'
                    : resetInfo.error ? `Couldn't check: ${resetInfo.error}`
                    : resetInfo.linked === 0 ? 'Nothing in this term is linked to Xero.'
                    : `Unlink ${resetInfo.linked} invoice${resetInfo.linked === 1 ? '' : 's'} from Xero?`}
                </span>
                {/* Spell out what survives: staff reset because they deleted the
                    Xero side, and need to know voided bills won't come back. */}
                {!resetInfo.loading && !resetInfo.error && resetInfo.linked > 0 && (
                  <span className="text-[11px] text-[#325099]/45">
                    {resetInfo.reopened} back to Approved
                    {resetInfo.voided ? `, ${resetInfo.voided} stay voided` : ''}
                  </span>
                )}
                {!resetInfo.loading && !resetInfo.error && resetInfo.linked > 0 && (
                  <button onClick={() => { setResetInfo(null); onResetXero() }} disabled={xeroSyncing}
                    className="text-[11px] font-semibold bg-red-500 text-white px-2.5 py-1 rounded-full hover:bg-red-600 transition disabled:opacity-40">
                    Yes, unlink
                  </button>
                )}
                <button onClick={() => setResetInfo(null)}
                  className="text-[11px] text-[#325099]/50 hover:text-[#325099] px-1.5 py-1">
                  {resetInfo.loading || resetInfo.error || !resetInfo.linked ? 'Close' : 'Cancel'}
                </button>
              </div>
            ) : (
              <button onClick={askReset} disabled={xeroSyncing}
                title="Clears the Xero link so these invoices can be pushed again — use after deleting them in Xero"
                className="text-xs font-semibold text-[#325099]/60 hover:text-[#325099] border border-[#DEE7FF] px-3 py-1.5 rounded-full transition disabled:opacity-40">
                ⟲ Reset Xero link
              </button>
            )
          )}
          {xeroConnected && (
            <button onClick={showSettings ? () => setShowSettings(false) : openSettings}
              className="text-xs font-semibold text-[#325099]/60 hover:text-[#325099] border border-[#DEE7FF] px-3 py-1.5 rounded-full transition">
              {showSettings ? '✕ Close' : '⚙ Account mapping'}
            </button>
          )}
          {xeroConnected === false && (
            <a href="/api/xero/auth"
              className="text-xs font-semibold text-white bg-[#1ab5ea] hover:bg-[#0ea5d9] px-4 py-1.5 rounded-full transition">
              Connect Xero
            </a>
          )}
          {xeroConnected === true && (
            <a href="/api/xero/auth"
              className="text-xs font-semibold text-[#325099]/40 hover:text-[#325099] transition">
              Reconnect
            </a>
          )}
        </div>
      </div>

      {/* The count alone doesn't tell anyone what to do next, and each reason
          has a different fix — approve it in Xero, reset a stale link, pick a
          bank account. Group by reason so a term of invoices stays readable. */}
      {xeroResult?.payments?.pending?.length > 0 && (
        <div className="px-4 py-2 border-t border-[#DEE7FF] bg-[#F8FAFF]">
          {Object.entries(
            xeroResult.payments.pending.reduce((acc, p) => {
              (acc[p.reason] ||= []).push(p.invoice_number)
              return acc
            }, {})
          ).map(([reason, nums]) => (
            <p key={reason} className="text-[11px] text-[#325099]/60">
              <span className="font-semibold">Not marked paid in Xero</span> — {reason}
              {nums.filter(Boolean).length ? `: ${nums.filter(Boolean).join(', ')}` : ''}
            </p>
          ))}
        </div>
      )}

      {xeroConnected && !xeroPaymentsEnabled && (
        <div className="px-4 py-2 border-t border-[#DEE7FF] bg-[#FFFBEB]">
          <p className="text-[11px] text-amber-700">
            This Xero connection predates payment support, so marking an invoice paid here won’t mark it
            paid in Xero. Click <span className="font-semibold">Reconnect</span> to grant the permission —
            nothing else changes.
          </p>
        </div>
      )}

      {showSettings && (
        <div className="border-t border-[#DEE7FF] bg-[#F8FAFF]">
          {loadingAcc ? (
            <p className="text-xs text-[#325099]/50 px-4 py-4">Loading accounts from Xero…</p>
          ) : accError ? (
            <div className="px-4 py-4">
              <p className="text-xs text-red-600 font-semibold mb-1">Failed to load accounts</p>
              <p className="text-xs text-red-500 font-mono bg-red-50 px-3 py-2 rounded-lg">{accError}</p>
              <button onClick={() => { setAccounts([]); setAccError(null); openSettings() }}
                className="mt-2 text-xs font-semibold text-[#325099] hover:underline">Retry</button>
            </div>
          ) : accounts.length === 0 ? null : (
            <>
              <div className="flex border-b border-[#DEE7FF] px-4">
                {[
                  { id: 'global', label: 'Global defaults' },
                  { id: 'items',  label: 'Course → item mapping' + (allCourseNames.length ? ' (' + allCourseNames.length + ')' : '') },
                ].map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={`text-xs font-semibold px-4 py-2.5 border-b-2 -mb-px transition ${
                      activeTab === tab.id
                        ? 'border-[#062E63] text-[#062E63]'
                        : 'border-transparent text-[#325099]/50 hover:text-[#325099]'
                    }`}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === 'global' && (
                <div className="px-4 py-4">
                  <p className="text-[11px] text-[#325099]/50 mb-3">
                    Fallback account codes for line items with no Xero item mapping (discounts, credits, or unmapped courses).
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {/* Classes and 1:1s post to different revenue accounts in
                        Xero. Leave the 1:1 one blank to send both to the class
                        account, as before. */}
                    <AccountSelect field="enrolment_account_code"      label="Tuition fees — classes" />
                    <AccountSelect field="enrolment_1on1_account_code" label="Tuition fees — 1:1" />
                    <AccountSelect field="discount_account_code"       label="Discounts" />
                    <AccountSelect field="credit_account_code"         label="Credits" />
                  </div>
                  <p className="text-[11px] text-[#325099]/40 mt-2">
                    A 1:1 line is recognised from its course’s delivery mode (class name as a fallback).
                    Leave “1:1” unset and those lines use the class account.
                  </p>

                  <div className="mt-5 pt-4 border-t border-[#DEE7FF]">
                    <p className="text-[11px] text-[#325099]/50 mb-3">
                      Marking an invoice paid in the portal records the payment against it in Xero.
                      Choose the bank account that money lands in — Xero requires one, so until it is
                      set nothing is marked paid there.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-1">Payments land in</label>
                        <select
                          value={settings.payment_account_code || ''}
                          onChange={e => setSettings(p => ({ ...p, payment_account_code: e.target.value }))}
                          className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs text-[#062E63] bg-white focus:outline-none focus:border-[#325099]"
                        >
                          <option value="">— don’t mark paid in Xero</option>
                          {bankAccounts.map(a => (
                            <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {bankAccounts.length === 0 && (
                      <p className="text-[11px] text-amber-600 mt-2">
                        No bank accounts found in Xero — add one there first.
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end mt-4">
                    <button onClick={handleSaveGlobal} disabled={saving}
                      className="text-xs font-semibold bg-[#062E63] text-white px-5 py-1.5 rounded-full hover:bg-[#325099] transition disabled:opacity-40">
                      {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save defaults'}
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'items' && (
                <div className="px-4 py-4">
                  <p className="text-[11px] text-[#325099]/50 mb-3">
                    Map each course to a Xero Product &amp; Service item. Xero handles the account code and tax type from the item itself.
                    {!termId && ' Select a term above to load courses from that term.'}
                  </p>
                  {hiddenNames.length > 0 && (
                    <p className="text-[11px] text-[#325099]/40 -mt-2 mb-3">
                      {hiddenNames.length} retired {hiddenNames.length === 1 ? 'course is' : 'courses are'} hidden
                      ({hiddenNames.join(', ')}). Set the course back to Active in the database to map
                      {hiddenNames.length === 1 ? ' it' : ' them'} again.
                    </p>
                  )}
                  {xeroItems.length === 0 && (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                      No items found in Xero yet — create your Products &amp; Services in Xero first, then come back to map them here.
                    </p>
                  )}
                  {allCourseNames.length === 0 ? (
                    <p className="text-xs text-[#325099]/40 italic">
                      No courses found — generate invoices for a term first, then come back here.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-[1fr_260px] gap-3 px-1">
                        <span className="text-[10px] font-semibold text-[#325099]/50 uppercase tracking-wider">Portal course</span>
                        <span className="text-[10px] font-semibold text-[#325099]/50 uppercase tracking-wider">Xero item (Product &amp; Service)</span>
                      </div>
                      {allCourseNames.map(name => {
                        const current  = itemMappings[name] || { item_code: '', item_name: '' }
                        const isMapped = !!current.item_code
                        const mappedItem = xeroItems.find(i => i.code === current.item_code)
                        return (
                          <div key={name} className="grid grid-cols-[1fr_260px] gap-3 items-center bg-white border border-[#DEE7FF] rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isMapped ? 'bg-[#10b981]' : 'bg-[#DEE7FF]'}`} />
                              <div className="min-w-0">
                                <span className="text-xs text-[#062E63] truncate block" title={name}>{name}</span>
                                {isMapped && mappedItem && (
                                  <span className="text-[10px] text-[#325099]/40">{'→'} {mappedItem.accountCode}{mappedItem.description ? ' · ' + mappedItem.description : ''}</span>
                                )}
                              </div>
                            </div>
                            <select
                              value={current.item_code || ''}
                              onChange={e => {
                                const code = e.target.value
                                const item = xeroItems.find(i => i.code === code)
                                setItemMappings(p => ({ ...p, [name]: { item_code: code, item_name: item?.name || '' } }))
                              }}
                              className="w-full border border-[#DEE7FF] rounded-lg px-2 py-1.5 text-xs text-[#062E63] bg-white focus:outline-none focus:border-[#325099]"
                            >
                              <option value="">— use global fallback</option>
                              {xeroItems.map(item => (
                                <option key={item.code} value={item.code}>{item.code} — {item.name}</option>
                              ))}
                            </select>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {allCourseNames.length > 0 && (
                    <div className="flex justify-end mt-4">
                      <button onClick={handleSaveItems} disabled={savingItems}
                        className="text-xs font-semibold bg-[#062E63] text-white px-5 py-1.5 rounded-full hover:bg-[#325099] transition disabled:opacity-40">
                        {savingItems ? 'Saving…' : savedItems ? '✓ Saved' : 'Save item mappings'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
