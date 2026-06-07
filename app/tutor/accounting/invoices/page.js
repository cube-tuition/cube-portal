'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'
import { fetchAllTerms, getCurrentTerm } from '../../../../lib/terms'

/*
 * Invoice Dashboard — /tutor/accounting/invoices
 * Phase 1: draft generation, warnings, approve, generate + download PDF
 */

// Workflow stage
const STAGE_LABELS = {
  draft:          { label: 'Draft',    cls: 'bg-[#F0F4FF] text-[#325099]' },
  approved:       { label: 'Approved', cls: 'bg-[#EDE9FE] text-[#5B21B6]' },
  synced_to_xero: { label: 'In Xero', cls: 'bg-[#ECFDF5] text-[#065F46]' },
  voided:         { label: 'Voided',  cls: 'bg-[#F3F4F6] text-gray-500' },
}
// Delivery
const DELIVERY_LABELS = {
  unsent: { label: 'Unsent', cls: 'bg-[#F3F4F6] text-gray-500' },
  sent:   { label: 'Sent',   cls: 'bg-[#D1FAE5] text-[#065F46]' },
}
// Payment
const PAYMENT_LABELS = {
  unpaid:  { label: 'Unpaid',  cls: 'bg-[#FEF3C7] text-[#92400E]' },
  paid:    { label: 'Paid',    cls: 'bg-[#D1FAE5] text-[#065F46] font-bold' },
  overdue: { label: 'Overdue', cls: 'bg-[#FEE2E2] text-red-700 font-bold' },
}
// Keep for backwards compat badge display
const STATUS_LABELS = { ...STAGE_LABELS, ...DELIVERY_LABELS, ...PAYMENT_LABELS }

// Dropdown colour classes (background + text + border for the select element itself)
const STAGE_SELECT_CLS = {
  draft:          'bg-[#F0F4FF] text-[#325099] border-[#C7D5F8]',
  approved:       'bg-[#EDE9FE] text-[#5B21B6] border-[#C4B5FD]',
  synced_to_xero: 'bg-[#ECFDF5] text-[#065F46] border-[#6EE7B7]',
  voided:         'bg-[#F3F4F6] text-gray-500  border-[#D1D5DB]',
}
const DELIVERY_SELECT_CLS = {
  unsent: 'bg-[#F3F4F6] text-gray-500  border-[#D1D5DB]',
  sent:   'bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]',
}
const PAYMENT_SELECT_CLS = {
  '':      'bg-[#F3F4F6] text-gray-400  border-[#D1D5DB]',
  unpaid:  'bg-[#FEF3C7] text-[#92400E] border-[#FCD34D]',
  paid:    'bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]',
  overdue: 'bg-[#FEE2E2] text-red-700   border-[#FCA5A5]',
}

const fmtMoney = n => `$${(Number(n) || 0).toFixed(2)}`
const fmtDate     = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short',  year: 'numeric' }) : '—'
const fmtDateLong = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'long',  year: 'numeric' }) : '—'

function Warning({ text }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#92400E] bg-[#FEF3C7] border border-[#FDE047] px-2 py-0.5 rounded-full">
      ⚠ {text}
    </span>
  )
}

function getWarnings(inv, prevUnpaid) {
  const w = []
  if (!inv.parent_email)                              w.push('missing email')
  if (!inv.invoice_number)                            w.push('no invoice number')
  if ((inv.total || 0) <= 0)                         w.push('zero/negative total')
  if (inv.status !== 'voided' && prevUnpaid)          w.push('unpaid previous invoice')
  const missingFee  = (inv.line_items || []).filter(l => l.type === 'enrolment' && !l.unit_price)
  if (missingFee.length)                              w.push(`${missingFee.length} missing fee`)
  const missingTime = (inv.line_items || []).filter(l => l.type === 'enrolment' && !l.start_time)
  if (missingTime.length)                             w.push(`${missingTime.length} missing time`)
  const creditTotal = (inv.line_items || []).filter(l => l.type === 'credit').reduce((s, l) => s + Math.abs(l.amount || 0), 0)
  if (creditTotal > (inv.subtotal || 0) * 0.5 && creditTotal > 50) w.push('unusual credit')
  return w
}

// ── PDF generation (client-side jsPDF, Xero-style layout) ────────────────────
async function generateInvoicePdf(inv, termName, termDates) {
  const { jsPDF } = await import('jspdf')

  const doc      = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const W        = doc.internal.pageSize.getWidth()   // 210mm
  const H        = doc.internal.pageSize.getHeight()  // 297mm
  const navy     = [15,  43,  89]
  const blue     = [30,  100, 200]
  const black    = [20,  20,  20]
  const darkgrey = [80,  80,  80]
  const midgrey  = [140, 140, 140]
  const linegrey = [210, 210, 210]
  const L = 14          // left margin
  const R = W - 14      // right margin (196mm)

  // Plain number formatter — NO dollar sign prefix (fmtMoney includes $)
  const num = n => (Number(n) || 0).toFixed(2)

  // ── Logo (navy hexagon with white "C" arc) ───────────────────────────────
  const logoCx = R - 2, logoCy = 21, logoR = 14
  const hexPts = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    hexPts.push([logoCx + logoR * Math.cos(a), logoCy + logoR * Math.sin(a)])
  }
  doc.setFillColor(...navy)
  doc.setDrawColor(...navy)
  const segs = hexPts.slice(1).map((p, i) => [p[0] - hexPts[i][0], p[1] - hexPts[i][1]])
  doc.lines(segs, hexPts[0][0], hexPts[0][1], [1, 1], 'F', true)
  doc.setDrawColor(255, 255, 255)
  doc.setLineWidth(2.2)
  const arcPts = []
  for (let i = 0; i <= 20; i++) {
    const a = Math.PI * 0.2 + Math.PI * 1.6 * (i / 20)
    arcPts.push([logoCx + 6.5 * Math.cos(a), logoCy + 6.5 * Math.sin(a)])
  }
  for (let i = 0; i < arcPts.length - 1; i++) {
    doc.line(arcPts[i][0], arcPts[i][1], arcPts[i + 1][0], arcPts[i + 1][1])
  }
  doc.setLineWidth(0.4)

  // ── Title ────────────────────────────────────────────────────────────────
  doc.setTextColor(...black)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text(inv.status === 'draft' ? 'Draft Tax Invoice' : 'Tax Invoice', L, 22)

  let y = 46

  // ── Address block (left: client, right: CUBE) ─────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...black)
  doc.text(inv.parent_name || '—', L, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...darkgrey)
  let ly = y + 5.5
  if (inv.parent_email) { doc.text(inv.parent_email, L, ly); ly += 5 }
  if (inv.parent_phone) { doc.text(inv.parent_phone, L, ly); ly += 5 }

  let ry = y
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...black)
  doc.text('CUBE Tuition', R, ry, { align: 'right' }); ry += 5.5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...darkgrey)
  doc.text('2 Help St', R, ry, { align: 'right' }); ry += 5
  doc.text('CHATSWOOD NSW 2067', R, ry, { align: 'right' }); ry += 5.5
  doc.text('ABN: 12685204335', R, ry, { align: 'right' }); ry += 5
  doc.text('admin@cubetuition.com.au', R, ry, { align: 'right' })

  y = Math.max(ly, ry) + 10

  // ── Key info bar ─────────────────────────────────────────────────────────
  doc.setDrawColor(...linegrey)
  doc.setLineWidth(0.4)
  doc.line(L, y, R, y)
  y += 7

  const totalIncGst = parseFloat(inv.total) || 0
  const issueDate   = inv.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10)

  // colWidths must sum to exactly R - L = 182mm
  const infoItems = [
    { label: 'Amount due',     value: '$' + num(totalIncGst),    size: 16 },
    { label: 'Due date',       value: fmtDateLong(inv.due_date), size: 13 },
    { label: 'Issue date',     value: fmtDateLong(issueDate),    size: 10 },
    { label: 'Invoice number', value: inv.invoice_number || '—', size: 10 },
    { label: 'Reference',      value: inv.reference_code || '—', size: 10 },
  ]
  const colWidths = [38, 46, 34, 34, 30] // total = 182mm = R - L
  let colX = L
  infoItems.forEach(({ label, value, size }, i) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...midgrey)
    doc.text(label, colX, y)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(size)
    doc.setTextColor(...black)
    doc.text(value, colX, y + 8)   // consistent baseline for all columns
    colX += colWidths[i]
  })

  y += 19
  doc.setDrawColor(...linegrey)
  doc.setLineWidth(0.8)
  doc.line(L, y, R, y)
  doc.setLineWidth(0.4)
  y += 9

  // ── Table header ─────────────────────────────────────────────────────────
  const cDesc  = L
  const cQty   = 140
  const cPrice = 157
  const cTax   = 172
  const cAmt   = R

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...midgrey)
  doc.text('Description', cDesc,  y)
  doc.text('Qty',         cQty,   y, { align: 'center' })
  doc.text('Price',       cPrice, y, { align: 'right' })
  doc.text('Tax',         cTax,   y, { align: 'center' })
  doc.text('Amount',      cAmt,   y, { align: 'right' })

  y += 3
  doc.setDrawColor(...linegrey)
  doc.line(L, y, R, y)
  y += 6

  // ── Table rows ────────────────────────────────────────────────────────────
  const enrolLines    = (inv.line_items || []).filter(l => l.type === 'enrolment')
  const discountLines = (inv.line_items || []).filter(l => l.type === 'discount')
  const creditLines2  = (inv.line_items || []).filter(l => l.type === 'credit')
  const allLines      = [...enrolLines, ...discountLines, ...creditLines2]

  const LINE_H = 5      // line height in mm for 9pt text
  const ROW_PAD = 4     // padding above and below text within a row

  allLines.forEach(l => {
    const desc = l.type === 'enrolment'
      ? [l.student_name, l.class_name, l.day ? (l.day + (l.start_time ? ' ' + l.start_time : '')) : null]
          .filter(Boolean).join(' — ')
      : l.reason || (l.type === 'credit' ? 'Credit' : 'Discount')

    const amt      = Number(l.amount) || 0
    const price    = Number(l.unit_price ?? l.amount) || 0
    const taxLabel = amt !== 0 ? '10%' : ''

    const descLines = doc.splitTextToSize(desc, cQty - cDesc - 6)
    const textH     = descLines.length * LINE_H
    const rowH      = textH + ROW_PAD * 2

    // New page if row doesn't fit
    if (y + rowH > H - 55) { doc.addPage(); y = 20 }

    const textY = y + ROW_PAD + LINE_H - 1   // baseline of first text line

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...black)
    doc.text(descLines, cDesc, textY)
    doc.text('1',       cQty,   textY, { align: 'center' })
    doc.text(num(price), cPrice, textY, { align: 'right' })
    doc.setTextColor(...midgrey)
    doc.text(taxLabel,  cTax,   textY, { align: 'center' })
    doc.setTextColor(...black)
    doc.text(num(amt),  cAmt,   textY, { align: 'right' })

    y += rowH
    doc.setDrawColor(...linegrey)
    doc.line(L, y, R, y)
  })

  y += 10

  // ── Payment instructions (left) + Totals (right) ─────────────────────────
  if (y > H - 60) { doc.addPage(); y = 20 }

  // Record starting y for both columns
  const sectionY = y

  // Left: payment instructions
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...blue)
  doc.text('Payment instructions', L, sectionY)

  const instrRaw = (inv.payment_instructions || 'Please contact admin@cubetuition.com.au for payment details.')
    .replace('[Invoice Number]', inv.invoice_number || '')
    .replace('[Reference]', inv.reference_code || inv.invoice_number || '')
  const instrLines = doc.splitTextToSize(instrRaw, 100)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...darkgrey)
  instrLines.forEach((line, i) => doc.text(line, L, sectionY + 6 + i * 5))

  // Right: totals block — aligned to same sectionY
  const gst = totalIncGst / 11
  const tx  = 125
  let   ty  = sectionY

  const totRow = (label, value, lineAbove) => {
    if (lineAbove) {
      doc.setDrawColor(...linegrey)
      doc.line(tx, ty - 2, R, ty - 2)
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...midgrey)
    doc.text(label, tx, ty)
    doc.setTextColor(...black)
    doc.text(value, R, ty, { align: 'right' })
    ty += 6
  }

  totRow('Subtotal', num(totalIncGst))

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...midgrey)
  doc.text('Includes GST of ' + num(gst), tx, ty)
  ty += 6

  totRow('Total', num(totalIncGst), true)

  ty += 3
  doc.setDrawColor(...linegrey)
  doc.line(tx, ty - 2, R, ty - 2)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...midgrey)
  doc.text('Amount due', tx, ty + 6)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...black)
  doc.text('$' + num(totalIncGst), R, ty + 6, { align: 'right' })

  // ── Footer on every page ────────────────────────────────────────────────
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(180, 185, 200)
    doc.text(
      'CUBE Tuition Pty Ltd  ·  ABN: 12685204335  ·  ' +
      (inv.invoice_number || '') +
      (inv.reference_code ? '  ·  ' + inv.reference_code : '') +
      '  ·  Page ' + p + ' of ' + pages,
      W / 2, H - 8, { align: 'center' }
    )
  }

  return doc
}

// ── Xero Banner + Account Mapping ────────────────────────────────────────────
function XeroBanner({ xeroConnected, xeroResult, xeroSyncing, termId, onSync }) {
  const [showSettings,  setShowSettings]  = useState(false)
  const [activeTab,     setActiveTab]     = useState('global') // 'global' | 'items'
  const [accounts,      setAccounts]      = useState([])
  const [xeroItems,     setXeroItems]     = useState([])  // Xero Products & Services
  const [settings,      setSettings]      = useState({ enrolment_account_code: '', discount_account_code: '', credit_account_code: '' })
  const [loadingAcc,    setLoadingAcc]    = useState(false)
  const [accError,      setAccError]      = useState(null)
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)
  // Per-course item mappings: class_name → { item_code, item_name }
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

  const allAccounts = accounts

  const AccountSelect = ({ field, label }) => (
    <div>
      <label className="block text-[10px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-1">{label}</label>
      <select
        value={settings[field] || ''}
        onChange={e => setSettings(p => ({ ...p, [field]: e.target.value }))}
        className="w-full border border-[#DEE7FF] rounded-lg px-2.5 py-1.5 text-xs text-[#062E63] bg-white focus:outline-none focus:border-[#325099]"
      >
        <option value="">— not mapped</option>
        {allAccounts.map(a => (
          <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
        ))}
      </select>
    </div>
  )

  // All unique course names: from this term + any previously saved mappings
  const allCourseNames = [...new Set([
    ...courseNames,
    ...Object.keys(itemMappings).filter(k => itemMappings[k].item_code),
  ])].sort()

  return (
    <div className="bg-white border border-[#DEE7FF] rounded-xl mb-5 overflow-hidden">
      {/* Top row */}
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

      {/* Account mapping panel */}
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
              {/* Tabs */}
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

              {/* Global defaults tab */}
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

              {/* Per-course item mapping tab */}
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

// ── Add Credit Modal ──────────────────────────────────────────────────────────
function AddCreditModal({ members, onClose, onSave }) {
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

// ── Log Referral Modal ────────────────────────────────────────────────────────
function ReferralModal({ students, onClose, onSave }) {
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

// ── Top-up Invoice Modal ──────────────────────────────────────────────────────
function TopUpInvoiceModal({ inv, allStudents, onClose, onCreated }) {
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
      status: 'draft', is_topup: true,
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

// ── Send Invoice Modal ────────────────────────────────────────────────────────
function buildEmailBody(inv, template, termName) {
  return (template || '')
    .replace(/\{\{guardian\}\}/g,     inv.parent_name ? inv.parent_name.split(' ')[0] : 'there')
    .replace(/\{\{studentNames\}\}/g, (inv.student_names || []).join(', ') || inv.parent_name || '—')
    .replace(/\{\{term\}\}/g,         termName || '')
    .replace(/\{\{invNo\}\}/g,        inv.invoice_number || '—')
    .replace(/\{\{amount\}\}/g,       fmtMoney(inv.total))
    .replace(/\{\{dueDate\}\}/g,      fmtDate(inv.due_date))
}

function SendEmailModal({ inv, term, emailTemplate, emailSubjectTemplate, onClose, onSent }) {
  const [subject,  setSubject]  = useState(() => (emailSubjectTemplate || 'Invoice for {{studentNames}} – {{term}}')
    .replace(/\{\{studentNames\}\}/g, (inv.student_names || []).join(', ') || inv.parent_name || '—')
    .replace(/\{\{term\}\}/g,         term?.name || '')
    .replace(/\{\{invNo\}\}/g,        inv.invoice_number || ''))
  const [body,     setBody]     = useState(() => buildEmailBody(inv, emailTemplate, term?.name))
  const [sending,  setSending]  = useState(false)
  const [error,    setError]    = useState(null)
  const [tab,      setTab]      = useState('edit') // 'edit' | 'preview'

  const handleSend = async () => {
    if (!inv.parent_email) { setError('No email address on file for this family.'); return }
    setSending(true); setError(null)
    try {
      // Generate PDF as base64
      const termDates = term ? `${fmtDate(term.start_date)} to ${fmtDate(term.end_date)}` : ''
      const doc = await generateInvoicePdf(inv, term?.name || '', termDates)
      // Use arraybuffer → Uint8Array → binary string → btoa for reliable base64
      const pdfArrayBuffer = doc.output('arraybuffer')
      const pdfUint8 = new Uint8Array(pdfArrayBuffer)
      let binary = ''
      for (let i = 0; i < pdfUint8.length; i++) binary += String.fromCharCode(pdfUint8[i])
      const pdf_base64  = btoa(binary)
      const pdf_filename = `${inv.invoice_number || 'invoice'}.pdf`

      const res = await fetch('/api/send-invoice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_id:   inv.id,
          email_to:     inv.parent_email,
          subject,
          body,
          pdf_base64,
          pdf_filename,
        }),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error || 'Send failed')
      }
      onSent(inv.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#DEE7FF]">
          <div>
            <h3 className="font-bold text-[#062E63] text-sm">Send Invoice</h3>
            <p className="text-[11px] text-[#325099]/50 mt-0.5">
              To: <span className="font-semibold text-[#325099]">{inv.parent_name}</span>
              {' · '}<span className="text-blue-600">{inv.parent_email || 'no email'}</span>
              {' · '}{inv.invoice_number}
            </p>
          </div>
          <button onClick={onClose} className="text-[#325099]/40 hover:text-[#325099] text-lg">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3">
          {['edit', 'preview'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition capitalize ${tab === t ? 'bg-[#062E63] text-white' : 'text-[#325099]/60 hover:text-[#325099]'}`}>
              {t === 'edit' ? 'Edit' : 'Preview'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="px-6 py-4 flex-1 overflow-y-auto space-y-3">
          {tab === 'edit' ? (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-1">Subject</label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#062E63] focus:outline-none focus:border-[#325099]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-1">Email body</label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={18}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#062E63] font-mono resize-y focus:outline-none focus:border-[#325099]"
                />
              </div>
            </>
          ) : (
            <div className="border border-[#DEE7FF] rounded-xl overflow-hidden">
              {/* Email client-style header */}
              <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-4 py-3 space-y-1">
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">From:</span> CUBE Tuition &lt;admin@cubetuition.com.au&gt;</p>
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">To:</span> {inv.parent_name} &lt;{inv.parent_email}&gt;</p>
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">Subject:</span> {subject}</p>
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">Attachment:</span> 📎 {inv.invoice_number || 'invoice'}.pdf</p>
              </div>
              {/* Email body */}
              <div className="bg-white px-5 py-4">
                <div className="text-xs text-[#1a1a2e] font-sans leading-relaxed whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html:
                    body
                      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                      .replace(/\n/g, '<br>')
                  }}
                />
              </div>
            </div>
          )}
          <p className="text-[11px] text-[#325099]/40">
            📎 Invoice PDF ({inv.invoice_number || 'invoice'}.pdf) will be generated and attached automatically.
          </p>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#DEE7FF] flex justify-end gap-2">
          <button onClick={onClose} className="text-xs text-[#325099]/60 border border-[#DEE7FF] px-4 py-2 rounded-full hover:border-[#325099] transition">
            Cancel
          </button>
          <button onClick={handleSend} disabled={sending || !inv.parent_email}
            className="text-xs font-semibold bg-[#062E63] text-white px-6 py-2 rounded-full hover:bg-[#325099] transition disabled:opacity-40">
            {sending ? 'Sending…' : '✉ Send Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function InvoiceDashboard() {
  return <Suspense><InvoiceDashboardInner /></Suspense>
}

function InvoiceDashboardInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [profile,    setProfile]    = useState(null)
  const [terms,      setTerms]      = useState([])
  const [termId,     setTermId]     = useState('')
  const [invoices,   setInvoices]   = useState([])
  const [loading,    setLoading]    = useState(false)
  const [generating, setGenerating] = useState(false)
  const [approvingId, setApprovingId] = useState(null)
  const [pdfGenId,   setPdfGenId]   = useState(null)
  const [regenAll,   setRegenAll]   = useState(false)
  const [regenProgress, setRegenProgress] = useState({ done: 0, total: 0 })
  const [error,      setError]      = useState(null)
  const [successMsg, setSuccessMsg] = useState(null)
  const [creditModal,   setCreditModal]   = useState(null)  // { invoiceId, members }
  const [referralModal, setReferralModal] = useState(false)
  const [topUpModal,    setTopUpModal]    = useState(null)  // invoice object
  const [allStudents,   setAllStudents]   = useState([])
  const [statusEditing, setStatusEditing] = useState(null) // invoice id being status-edited
  const [sendModalInv,      setSendModalInv]      = useState(null)
  const [emailTemplate,     setEmailTemplate]     = useState('')
  const [emailSubjectTmpl,  setEmailSubjectTmpl]  = useState('')

  // Xero
  const [xeroConnected, setXeroConnected] = useState(null)  // null=loading, true, false
  const [xeroSyncing,   setXeroSyncing]   = useState(false)
  const [xeroResult,    setXeroResult]    = useState(null)  // { pushed, skipped, errors }

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) router.replace('/tutor')
      else setProfile(profile)
    })
    fetchAllTerms().then(allTerms => {
      setTerms(allTerms)
      const cur = getCurrentTerm(allTerms)
      if (cur) setTermId(cur.id)
    })
    supabase.from('portal_settings')
      .select('key, value')
      .in('key', ['invoice_email_template', 'invoice_email_subject'])
      .then(({ data }) => {
        if (data) {
          const map = Object.fromEntries(data.map(r => [r.key, r.value]))
          if (map.invoice_email_template) setEmailTemplate(map.invoice_email_template)
          if (map.invoice_email_subject)  setEmailSubjectTmpl(map.invoice_email_subject)
        }
      })
  }, [router])

  // Check Xero connection + handle OAuth callback redirect
  useEffect(() => {
    const xeroParam = searchParams.get('xero')
    if (xeroParam === 'connected') setXeroConnected(true)
    else if (xeroParam === 'error') setError('Xero connection failed — please try again.')

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      fetch('/api/xero/status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).then(r => r.json()).then(d => setXeroConnected(d.connected)).catch(() => setXeroConnected(false))
    })
  }, [searchParams])

  const handleSyncToXero = async () => {
    if (!termId) return
    setXeroSyncing(true); setXeroResult(null); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res  = await fetch('/api/xero/push', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body:    JSON.stringify({ term_id: termId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setXeroResult(data)
      await loadInvoices()
    } catch (e) { setError('Xero sync failed: ' + e.message) }
    finally { setXeroSyncing(false) }
  }

  const term = terms.find(t => t.id === termId)

  const loadInvoices = useCallback(async () => {
    if (!termId) return
    setLoading(true); setError(null)
    try {
      // Load classes for this term
      const { data: classes } = await supabase
        .from('classes').select('id, class_name, day_of_week, start_time, teacher').eq('term_id', termId)
      const classMap = Object.fromEntries((classes || []).map(c => [c.id, c]))
      const classIds = (classes || []).map(c => c.id)

      // Load invoices for this term
      const { data: invs, error: invErr } = await supabase
        .from('invoices')
        .select('*')
        .eq('term_id', termId)
        .not('status', 'eq', 'voided')
        .order('invoice_number', { ascending: true })
      if (invErr) throw invErr

      // For legacy invoices (no line_items), load enrolments directly
      const legacyInvs = (invs || []).filter(i => !i.line_items?.length)
      let legacyEnrolMap = {} // student_id[] per invoice id
      let legacyStudMap  = {} // student by id

      if (legacyInvs.length && classIds.length) {
        const { data: enrs } = await supabase
          .from('enrolments').select('id, student_id, class_id, price, status')
          .in('class_id', classIds).in('status', ['active', 'trial'])
        const { data: studs } = await supabase
          .from('students').select('id, full_name, family_id')
          .in('id', (enrs || []).map(e => e.student_id))
        legacyStudMap = Object.fromEntries((studs || []).map(s => [s.id, s]))

        // Map family_id → enrolments for legacy invoices
        for (const inv of legacyInvs) {
          const matchedEnrs = (enrs || []).filter(e => {
            const s = legacyStudMap[e.student_id]
            return inv.family_id ? s?.family_id === inv.family_id : e.student_id === inv.student_id
          })
          legacyEnrolMap[inv.id] = matchedEnrs
        }
      }

      // Collect all relevant student IDs
      const allStudentIds = [...new Set([
        ...(invs || []).flatMap(inv => {
          if (inv.student_id) return [inv.student_id]
          return (inv.line_items || []).filter(l => l.type === 'enrolment').map(l => l.student_id)
        }),
        ...Object.values(legacyEnrolMap).flat().map(e => e.student_id),
      ])]

      const { data: guardians } = allStudentIds.length
        ? await supabase.from('guardians').select('student_id, full_name, email, phone').in('student_id', allStudentIds)
        : { data: [] }
      const guardianMap = Object.fromEntries((guardians || []).map(g => [g.student_id, g]))

      // Load previous unpaid invoices
      const familyIds = (invs || []).map(i => i.family_id).filter(Boolean)
      let prevUnpaidSet = new Set()
      if (familyIds.length) {
        const { data: prevInvs } = await supabase
          .from('invoices').select('family_id')
          .in('family_id', familyIds)
          .in('payment_status', ['unpaid', 'overdue'])
          .neq('term_id', termId)
        for (const p of prevInvs || []) prevUnpaidSet.add(p.family_id)
      }

      // Enrich invoices — handle both new (line_items) and legacy formats
      const enriched = (invs || []).map(inv => {
        const isLegacy = !inv.line_items?.length

        // Build line_items for legacy invoices on the fly
        const effectiveLineItems = isLegacy
          ? (legacyEnrolMap[inv.id] || []).map(e => ({
              type:         'enrolment',
              student_id:   e.student_id,
              student_name: legacyStudMap[e.student_id]?.full_name || '—',
              class_id:     e.class_id,
              class_name:   classMap[e.class_id]?.class_name || '—',
              day:          classMap[e.class_id]?.day_of_week || '',
              start_time:   classMap[e.class_id]?.start_time || '',
              teacher:      classMap[e.class_id]?.teacher || '',
              unit_price:   parseFloat(e.price) || 0,
              amount:       parseFloat(e.price) || 0,
            })).concat(
              // Add stored discount line items for legacy invoices
              inv.sibling_discount > 0
                ? [{ type: 'discount', reason: `Sibling discount`, amount: -parseFloat(inv.sibling_discount) }]
                : []
            ).concat(
              inv.multi_course_discount > 0
                ? [{ type: 'discount', reason: `Multi-course discount`, amount: -parseFloat(inv.multi_course_discount) }]
                : []
            )
          : (inv.line_items || [])

        const enrolStudentIds = effectiveLineItems.filter(l => l.type === 'enrolment').map(l => l.student_id)
        const firstStudentId  = inv.student_id || enrolStudentIds[0]
        const guardian        = guardianMap[firstStudentId] || {}
        const studentNames    = [...new Set(effectiveLineItems.filter(l => l.type === 'enrolment').map(l => l.student_name))]

        return {
          ...inv,
          line_items:   effectiveLineItems,
          parent_name:  guardian.full_name || '—',
          parent_email: guardian.email     || '',
          parent_phone: guardian.phone     || '',
          student_names: studentNames,
          prev_unpaid:  prevUnpaidSet.has(inv.family_id),
          is_legacy:    isLegacy,
        }
      })

      setInvoices(enriched)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [termId])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  // Load all students for referral modal
  useEffect(() => {
    supabase.from('students').select('id, full_name').order('full_name').then(({ data }) => setAllStudents(data || []))
  }, [])

  // ── Credit handler ────────────────────────────────────────────────────────
  const handleAddCredit = async ({ invoiceId, studentId, amount, reason, notes }) => {
    const { error: err } = await supabase.from('student_credits').insert({
      student_id: studentId, amount: Number(amount), reason,
      notes: notes?.trim() || null, invoice_id: invoiceId,
    })
    if (err) { setError('Failed to add credit: ' + err.message); return }
    const inv = invoices.find(i => i.id === invoiceId)
    if (inv) await supabase.from('invoices').update({ total: Math.max(0, Number(inv.total) - Number(amount)) }).eq('id', invoiceId)
    setCreditModal(null)
    await loadInvoices()
  }

  // ── Referral handler ──────────────────────────────────────────────────────
  const handleLogReferral = async ({ referringStudentId, referredStudentId }) => {
    const { error: refErr } = await supabase.from('referrals').insert({
      referring_student_id: referringStudentId, referred_student_id: referredStudentId,
    })
    if (refErr) { setError('Failed to log referral: ' + refErr.message); return }

    const { data: referredInv } = await supabase.from('invoices')
      .select('id, total').eq('student_id', referredStudentId).neq('status', 'paid')
      .order('id', { ascending: false }).limit(1).maybeSingle()

    await supabase.from('student_credits').insert({
      student_id: referredStudentId, amount: 50, reason: 'referral_referred',
      notes: 'Referral discount — welcome credit', invoice_id: referredInv?.id ?? null,
    })
    if (referredInv) {
      await supabase.from('invoices').update({ total: Math.max(0, Number(referredInv.total) - 50) }).eq('id', referredInv.id)
    }
    await supabase.from('student_credits').insert({
      student_id: referringStudentId, amount: 50, reason: 'referral_referring',
      notes: 'Referral reward — $50 off next invoice', invoice_id: null,
    })

    setReferralModal(false)
    setSuccessMsg('Referral logged. $50 applied to referred family; $50 pending for referring family\'s next invoice.')
    await loadInvoices()
  }

  // ── Status change handler ─────────────────────────────────────────────────
  const handleStatusChange = async (invoiceId, field, value) => {
    setStatusEditing(invoiceId)
    try {
      const res = await fetch('/api/update-invoice-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoiceId, field, value }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, [field]: value } : i))
    } catch (e) { setError('Status update failed: ' + e.message) }
    setStatusEditing(null)
  }

  const handleGenerate = async () => {
    setGenerating(true); setError(null); setSuccessMsg(null)
    try {
      const res  = await fetch('/api/generate-draft-invoices', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ term_id: termId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSuccessMsg(`Created ${data.created} draft invoice${data.created !== 1 ? 's' : ''}. ${data.skipped ? `${data.skipped} already existed.` : ''}`)
      await loadInvoices()
    } catch (e) { setError(e.message) } finally { setGenerating(false) }
  }

  const [refreshingId, setRefreshingId] = useState(null)

  const handleRefresh = async (inv) => {
    setRefreshingId(inv.id)
    try {
      const res  = await fetch('/api/refresh-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: inv.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setInvoices(prev => prev.map(i => i.id === inv.id
        ? { ...i, line_items: data.line_items, subtotal: data.total, total: data.total }
        : i
      ))
      if (data.updated === 0) setSuccessMsg('Prices already up to date.')
      else setSuccessMsg(`Refreshed ${data.updated} line item${data.updated !== 1 ? 's' : ''} with latest prices.`)
    } catch (e) { setError(e.message) }
    finally { setRefreshingId(null) }
  }

  const handleApprove = async (inv) => {
    setApprovingId(inv.id)
    try {
      const res = await fetch('/api/approve-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: inv.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: 'approved' } : i))
    } catch (e) { setError(e.message) } finally { setApprovingId(null) }
  }

  const handleRegenerateAllPdfs = async () => {
    const targets = invoices.filter(i => i.status !== 'voided')
    setRegenAll(true)
    setRegenProgress({ done: 0, total: targets.length })
    const termDates = term ? `${fmtDate(term.start_date)} to ${fmtDate(term.end_date)}` : ''
    for (let idx = 0; idx < targets.length; idx++) {
      const inv = targets[idx]
      try {
        const doc = await generateInvoicePdf(inv, term?.name || '', termDates)
        const pdfBlob = doc.output('blob')
        const filename = `${inv.invoice_number || 'invoice'}.pdf`
        const path = `invoices/${termId}/${filename}`
        const { error: upErr } = await supabase.storage
          .from('invoices')
          .upload(path, pdfBlob, { upsert: true, contentType: 'application/pdf' })
        if (!upErr) {
          await supabase.from('invoices').update({ pdf_path: path }).eq('id', inv.id)
          setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, pdf_path: path } : i))
        }
      } catch (e) { /* skip failed invoice, continue */ }
      setRegenProgress({ done: idx + 1, total: targets.length })
    }
    setRegenAll(false)
    setSuccessMsg(`Regenerated ${targets.length} invoice PDFs.`)
  }

  const handleGeneratePdf = async (inv) => {
    setPdfGenId(inv.id)
    try {
      const termDates = term
        ? `${fmtDate(term.start_date)} to ${fmtDate(term.end_date)}`
        : ''
      const doc = await generateInvoicePdf(inv, term?.name || '', termDates)

      // Download PDF
      const filename = `${inv.invoice_number || 'invoice'}.pdf`
      doc.save(filename)

      // Upload to Supabase Storage
      const pdfBlob = doc.output('blob')
      const path    = `invoices/${termId}/${filename}`
      const { error: upErr } = await supabase.storage
        .from('invoices')
        .upload(path, pdfBlob, { upsert: true, contentType: 'application/pdf' })

      if (!upErr) {
        await supabase.from('invoices').update({ pdf_path: path }).eq('id', inv.id)
        setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, pdf_path: path } : i))
      }
    } catch (e) { setError(e.message) } finally { setPdfGenId(null) }
  }

  // ── Summary stats ─────────────────────────────────────────────────────────
  const stats = {
    total:    invoices.length,
    draft:    invoices.filter(i => i.status === 'draft').length,
    approved: invoices.filter(i => ['approved', 'synced_to_xero'].includes(i.status)).length,
    paid:     invoices.filter(i => i.payment_status === 'paid').length,
    overdue:  invoices.filter(i => i.payment_status === 'overdue').length,
    revenue:  invoices.filter(i => i.status !== 'voided' && i.status !== 'draft').reduce((s, i) => s + (Number(i.total) || 0), 0),
    warnings: invoices.filter(i => getWarnings(i, i.prev_unpaid).length > 0).length,
  }

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />

      <div className="max-w-6xl mx-auto px-6 pt-10 pb-24">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link href="/tutor/payroll" className="text-sm text-[#325099]/50 hover:text-[#325099] transition">← Accounting</Link>
        </div>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Invoices</h1>
            <p className="text-sm text-[#325099]/60 mt-1">Generate, approve, and manage term invoices.</p>
          </div>
          <div className="flex items-center gap-2">
            {termId && (
              <button
                onClick={handleRegenerateAllPdfs}
                disabled={regenAll}
                className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-4 py-2 rounded-full transition disabled:opacity-50"
              >
                {regenAll
                  ? `↻ Regenerating… (${regenProgress.done}/${regenProgress.total})`
                  : '↻ Regenerate All PDFs'}
              </button>
            )}
            <button
              onClick={() => setReferralModal(true)}
              className="text-xs font-semibold text-[#7C3AED] border border-[#EDE9FE] bg-white hover:bg-[#F5F3FF] px-4 py-2 rounded-full transition"
            >
              🤝 Log Referral
            </button>
            <select
              value={termId}
              onChange={e => { setTermId(e.target.value); setInvoices([]) }}
              className="border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm text-[#062E63] bg-white focus:outline-none focus:ring-2 focus:ring-[#325099]/25"
            >
              <option value="">Select term…</option>
              {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>

        {error   && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-5">{error}</div>}
        {successMsg && <div className="bg-[#D1FAE5] border border-[#34D399] text-[#065F46] text-sm rounded-xl px-4 py-3 mb-5">{successMsg}</div>}

        {/* Xero connection banner */}
        <XeroBanner
          xeroConnected={xeroConnected}
          xeroResult={xeroResult}
          xeroSyncing={xeroSyncing}
          termId={termId}
          onSync={handleSyncToXero}
        />

        {termId && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
              {[
                { label: 'Total',    value: stats.total,                            cls: 'text-[#062E63]' },
                { label: 'Draft',    value: stats.draft,                            cls: 'text-[#325099]' },
                { label: 'Approved', value: stats.approved,                         cls: 'text-[#5B21B6]' },
                { label: 'Paid',     value: stats.paid,                             cls: 'text-[#065F46]' },
                { label: 'Overdue',  value: stats.overdue,                          cls: stats.overdue > 0 ? 'text-red-600' : 'text-[#325099]' },
                { label: 'Warnings', value: stats.warnings,                         cls: stats.warnings > 0 ? 'text-[#92400E]' : 'text-[#325099]' },
                { label: 'Revenue',  value: `$${stats.revenue.toLocaleString('en-AU', { minimumFractionDigits: 0 })}`, cls: 'text-[#062E63]' },
              ].map(s => (
                <div key={s.label} className="bg-white border border-[#DEE7FF] rounded-xl px-3 py-3 text-center">
                  <div className={`text-lg font-bold ${s.cls}`}>{s.value}</div>
                  <div className="text-[10px] text-[#325099]/60 font-semibold mt-0.5 uppercase tracking-wider">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Generate button */}
            {invoices.length === 0 && !loading && (
              <div className="bg-white rounded-2xl border border-[#DEE7FF] p-10 text-center mb-6">
                <p className="text-4xl mb-4">📄</p>
                <p className="text-sm font-semibold text-[#062E63] mb-1">No invoices for {term?.name}</p>
                <p className="text-xs text-[#325099]/60 mb-6">Generate draft invoices from active enrolments to get started.</p>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="bg-[#062E63] text-white text-sm font-semibold px-8 py-3 rounded-full hover:bg-[#325099] transition disabled:opacity-40"
                >
                  {generating ? 'Generating…' : '⚡ Generate draft invoices'}
                </button>
              </div>
            )}

            {invoices.length > 0 && (
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-[#325099]/60">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</span>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] px-4 py-1.5 rounded-full hover:bg-[#F0F4FF] transition disabled:opacity-40"
                >
                  {generating ? 'Generating…' : '+ Generate new drafts'}
                </button>
              </div>
            )}

            {/* Invoice table */}
            {loading ? (
              <div className="text-center py-16 text-[#325099]/40 text-sm">Loading invoices…</div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
                {invoices.map(inv => {
                  const warnings    = getWarnings(inv, inv.prev_unpaid)
                  const statusStyle = STATUS_LABELS[inv.status] || STATUS_LABELS.draft
                  const isApproving = approvingId === inv.id
                  const isGenPdf    = pdfGenId    === inv.id
                  // All amounts are inc-GST. GST is a component of the total (total ÷ 11).
                  const total    = parseFloat(inv.total) || 0
                  const gst      = inv.is_legacy ? 0 : total / 11
                  const subtotal = total  // displayed in totals row
                  const enrolLines    = (inv.line_items || []).filter(l => l.type === 'enrolment')
                  const discountLines = (inv.line_items || []).filter(l => l.type === 'discount')
                  const creditLines   = (inv.line_items || []).filter(l => l.type === 'credit')

                  return (
                    <div key={inv.id} className={`bg-white rounded-2xl border overflow-hidden transition ${warnings.length ? 'border-[#FDE047]' : 'border-[#DEE7FF]'}`}>
                      {/* Invoice header */}
                      <div className="px-5 py-4 flex items-start justify-between gap-4 border-b border-[#DEE7FF]">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-[#062E63]">{inv.invoice_number || `#${inv.id}`}</span>
                            {/* Stage badge */}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${(STAGE_LABELS[inv.status] || STAGE_LABELS.draft).cls}`}>
                              {(STAGE_LABELS[inv.status] || STAGE_LABELS.draft).label}
                            </span>
                            {/* Delivery badge */}
                            {inv.delivery_status && (
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${DELIVERY_LABELS[inv.delivery_status]?.cls || 'bg-[#F3F4F6] text-gray-500'}`}>
                                {DELIVERY_LABELS[inv.delivery_status]?.label || inv.delivery_status}
                              </span>
                            )}
                            {/* Payment badge */}
                            {inv.payment_status && (
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PAYMENT_LABELS[inv.payment_status]?.cls || 'bg-[#F3F4F6] text-gray-500'}`}>
                                {PAYMENT_LABELS[inv.payment_status]?.label || inv.payment_status}
                              </span>
                            )}
                            {inv.is_legacy && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F3F4F6] text-gray-500">Legacy</span>}
                            {inv.xero_invoice_id
                              ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#065F46]">✓ Xero</span>
                              : xeroConnected && inv.status !== 'draft' && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F3F4F6] text-gray-400">Not synced</span>
                            }
                            {warnings.map(w => <Warning key={w} text={w} />)}
                          </div>
                          <p className="text-sm font-semibold text-[#2A2035] mt-0.5">{inv.parent_name}</p>
                          <p className="text-xs text-[#325099]/50">{inv.parent_email || 'no email'}</p>
                          {inv.student_names?.length > 0 && (
                            <p className="text-xs text-[#325099]/70 mt-0.5">{inv.student_names.join(', ')}</p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-lg font-bold text-[#062E63]">{fmtMoney(total)}</p>
                          <p className="text-[10px] text-[#325099]/50">inc GST · due {fmtDate(inv.due_date)}</p>
                        </div>
                      </div>

                      {/* Line items */}
                      <div className="px-5 py-3">
                        <table className="w-full text-xs">
                          <tbody>
                            {enrolLines.map((l, i) => (
                              <tr key={i} className="border-b border-[#F0F4FF] last:border-0">
                                <td className="py-1.5 font-medium text-[#062E63]">{l.student_name}</td>
                                <td className="py-1.5 text-[#325099]/70">
                                  {l.class_name}
                                  {l.day && <span className="text-[#325099]/40 ml-1">· {l.day}{l.start_time ? ` ${l.start_time}` : ''}</span>}
                                </td>
                                <td className="py-1.5 text-right text-[#325099]">{fmtMoney(l.amount)}</td>
                              </tr>
                            ))}
                            {discountLines.map((l, i) => (
                              <tr key={`d${i}`} className="border-b border-[#F0F4FF] last:border-0">
                                <td className="py-1.5 text-[#7C3AED] italic" colSpan={2}>{l.reason}</td>
                                <td className="py-1.5 text-right text-[#7C3AED]">({fmtMoney(Math.abs(l.amount))})</td>
                              </tr>
                            ))}
                            {creditLines.map((l, i) => (
                              <tr key={`c${i}`} className="border-b border-[#F0F4FF] last:border-0">
                                <td className="py-1.5 text-[#065F46] italic" colSpan={2}>Credit: {l.reason}</td>
                                <td className="py-1.5 text-right text-[#065F46]">({fmtMoney(Math.abs(l.amount))})</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {/* Totals row */}
                        <div className="mt-2 pt-2 border-t border-[#DEE7FF] flex justify-end gap-6 text-xs text-[#325099]/70">
                          {!inv.is_legacy && <span>GST included <strong className="text-[#2A2035]">{fmtMoney(gst)}</strong></span>}
                          <span className="font-bold text-[#062E63]">Total {fmtMoney(total)}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="px-5 py-3 bg-[#F8FAFF] border-t border-[#DEE7FF] flex items-center gap-2 flex-wrap">
                        {inv.status === 'draft' && (
                          <>
                            <button onClick={() => handleRefresh(inv)} disabled={refreshingId === inv.id}
                              className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-4 py-1.5 rounded-full transition disabled:opacity-40">
                              {refreshingId === inv.id ? 'Refreshing…' : '↻ Refresh prices'}
                            </button>
                            <button onClick={() => handleApprove(inv)} disabled={isApproving || warnings.length > 0}
                              title={warnings.length > 0 ? `Resolve ${warnings.length} warning${warnings.length > 1 ? 's' : ''} before approving` : ''}
                              className="text-xs font-semibold bg-[#062E63] text-white px-4 py-1.5 rounded-full hover:bg-[#325099] transition disabled:opacity-40">
                              {isApproving ? 'Approving…' : '✓ Approve'}
                            </button>
                          </>
                        )}
                        {['approved', 'synced_to_xero'].includes(inv.status) && (
                          <button onClick={() => handleGeneratePdf(inv)} disabled={isGenPdf}
                            className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-4 py-1.5 rounded-full transition disabled:opacity-40">
                            {isGenPdf ? 'Generating…' : inv.pdf_path ? '↻ PDF' : '📄 Generate PDF'}
                          </button>
                        )}
                        {inv.pdf_path && (
                          <a href={supabase.storage.from('invoices').getPublicUrl(inv.pdf_path).data.publicUrl}
                            target="_blank" rel="noopener noreferrer"
                            className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] bg-white hover:bg-[#F0F4FF] px-4 py-1.5 rounded-full transition">
                            ↗ View PDF
                          </a>
                        )}
                        {/* Add Credit */}
                        {inv.status !== 'voided' && inv.status !== 'draft' && (() => {
                          const members = [...new Map(
                            (inv.line_items || []).filter(l => l.type === 'enrolment')
                              .map(l => [l.student_id, { id: l.student_id, full_name: l.student_name }])
                          ).values()]
                          return (
                            <button onClick={() => setCreditModal({ invoiceId: inv.id, members })}
                              className="text-xs font-semibold text-[#065F46] border border-[#A7F3D0] bg-white hover:bg-[#F0FDF4] px-4 py-1.5 rounded-full transition">
                              + Credit
                            </button>
                          )
                        })()}
                        {/* Top-up (only on paid invoices) */}
                        {inv.payment_status === 'paid' && (
                          <button onClick={() => setTopUpModal(inv)}
                            className="text-xs font-semibold text-[#7C3AED] border border-[#EDE9FE] bg-white hover:bg-[#F5F3FF] px-4 py-1.5 rounded-full transition">
                            + Top-up
                          </button>
                        )}
                        {/* Three status dropdowns */}
                        <div className="ml-auto flex gap-1.5">
                          <select
                            value={inv.status}
                            disabled={statusEditing === inv.id}
                            onChange={e => handleStatusChange(inv.id, 'status', e.target.value)}
                            className={`text-[11px] font-semibold border rounded-full px-2.5 py-1 focus:outline-none disabled:opacity-40 transition-colors ${STAGE_SELECT_CLS[inv.status] || STAGE_SELECT_CLS.draft}`}
                          >
                            <option value="draft">Draft</option>
                            <option value="approved">Approved</option>
                            <option value="synced_to_xero">In Xero</option>
                            <option value="voided">Voided</option>
                          </select>
                          {inv.delivery_status === 'sent' ? (
                            <span
                              title="Click to mark as unsent"
                              onClick={() => handleStatusChange(inv.id, 'delivery_status', 'unsent')}
                              className="cursor-pointer text-[11px] font-semibold border rounded-full px-2.5 py-1 transition-colors bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7] hover:opacity-70"
                            >
                              ✉ Sent
                            </span>
                          ) : (
                            <button
                              onClick={() => setSendModalInv(inv)}
                              disabled={statusEditing === inv.id || !inv.parent_email || inv.status === 'draft' || inv.status === 'voided'}
                              title={inv.status === 'draft' ? 'Approve invoice before sending' : inv.status === 'voided' ? 'Invoice is voided' : !inv.parent_email ? 'No email on file' : 'Send invoice by email'}
                              className="text-[11px] font-semibold border rounded-full px-2.5 py-1 transition-colors bg-[#F0F4FF] text-[#325099] border-[#C7D5F8] hover:bg-[#DEE7FF] disabled:opacity-40"
                            >
                              ✉ Send
                            </button>
                          )}
                          <select
                            value={inv.payment_status || ''}
                            disabled={statusEditing === inv.id}
                            onChange={e => handleStatusChange(inv.id, 'payment_status', e.target.value || null)}
                            className={`text-[11px] font-semibold border rounded-full px-2.5 py-1 focus:outline-none disabled:opacity-40 transition-colors ${PAYMENT_SELECT_CLS[inv.payment_status || ''] || PAYMENT_SELECT_CLS['']}`}
                          >
                            <option value="">— Payment</option>
                            <option value="unpaid">Unpaid</option>
                            <option value="paid">Paid</option>
                            <option value="overdue">Overdue</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {!termId && (
          <div className="bg-white rounded-2xl border border-[#DEE7FF] p-16 text-center text-[#325099]/40 text-sm">
            Select a term to view invoices.
          </div>
        )}

      </div>

      {/* Modals */}
      {creditModal && (
        <AddCreditModal
          members={creditModal.members}
          onClose={() => setCreditModal(null)}
          onSave={(fields) => handleAddCredit({ invoiceId: creditModal.invoiceId, ...fields })}
        />
      )}
      {referralModal && (
        <ReferralModal
          students={allStudents}
          onClose={() => setReferralModal(false)}
          onSave={handleLogReferral}
        />
      )}
      {topUpModal && (
        <TopUpInvoiceModal
          inv={topUpModal}
          allStudents={allStudents}
          onClose={() => setTopUpModal(null)}
          onCreated={() => { setTopUpModal(null); loadInvoices() }}
        />
      )}
      {sendModalInv && (
        <SendEmailModal
          inv={sendModalInv}
          term={term}
          emailTemplate={emailTemplate}
          emailSubjectTemplate={emailSubjectTmpl}
          onClose={() => setSendModalInv(null)}
          onSent={(id) => {
            setSendModalInv(null)
            setInvoices(prev => prev.map(i => i.id === id ? { ...i, delivery_status: 'sent' } : i))
          }}
        />
      )}
    </div>
  )
}
