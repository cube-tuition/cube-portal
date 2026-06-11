'use client'
import { useState } from 'react'

export function XeroBanner({ xeroConnected, xeroResult, xeroSyncing, termId, onSync }) {
  const [showSettings,  setShowSettings]  = useState(false)
  const [activeTab,     setActiveTab]     = useState('global')
  const [accounts,      setAccounts]      = useState([])
  const [xeroItems,     setXeroItems]     = useState([])
  const [settings,      setSettings]      = useState({ enrolment_account_code: '', discount_account_code: '', credit_account_code: '' })
  const [loadingAcc,    setLoadingAcc]    = useState(false)
  const [accError,      setAccError]      = useState(null)
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)
  const [courseNames,   setCourseNames]   = useState([])
  const [itemMappings,  setItemMappings]  = useState({})
  const [savingItems,   setSavingItems]   = useState(false)
  const [savedItems,    setSavedItems]    = useState(false)

  const openSettings = async () => {
    setShowSettings(true)
    if (accounts.length) return
    setLoadingAcc(true); setAccError(null)
    try {
      const [accRes, xeroItemsRes, settRes, itemMappingRes] = await Promise.all([
        fetch('/api/xero/accounts').then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d }),
        fetch('/api/xero/items').then(r => r.json()),
        fetch('/api/xero/settings').then(r => r.json()),
        fetch('/api/xero/item-mappings' + (termId ? '?term_id=' + termId : '')).then(r => r.json()),
      ])
      if (!accRes.accounts?.length) throw new Error('No accounts returned from Xero — your chart of accounts may be empty or all accounts are archived.')
      setAccounts(accRes.accounts)
      setXeroItems(xeroItemsRes.items || [])
      if (settRes && !settRes.error) setSettings({
        enrolment_account_code: settRes.enrolment_account_code || '',
        discount_account_code:  settRes.discount_account_code  || '',
        credit_account_code:    settRes.credit_account_code    || '',
      })
      const names = itemMappingRes.courseNames || []
      setCourseNames(names)
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

  const handleSaveGlobal = async () => {
    setSaving(true); setSaved(false)
    await fetch('/api/xero/settings', {
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
    await fetch('/api/xero/item-mappings', {
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

  const allCourseNames = [...new Set([
    ...courseNames,
    ...Object.keys(itemMappings).filter(k => itemMappings[k].item_code),
  ])].sort()

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
              Last sync: {xeroResult.pushed} pushed
              {xeroResult.skipped ? `, ${xeroResult.skipped} already in Xero` : ''}
              {xeroResult.errors?.length ? `, ${xeroResult.errors.length} errors` : ''}
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
                    Fallback account codes used for line items that have no Xero item mapping (e.g. discounts, credits, or unmapped courses).
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <AccountSelect field="enrolment_account_code" label="Tuition fees (fallback)" />
                    <AccountSelect field="discount_account_code"  label="Discounts" />
                    <AccountSelect field="credit_account_code"    label="Credits" />
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
