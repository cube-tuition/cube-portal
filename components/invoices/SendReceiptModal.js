'use client'
import { authedFetch } from '../../lib/authedFetch'
import { useState } from 'react'
import { fmtMoney, fmtDate } from '../../lib/format'
import { generateReceiptPdf, receiptNumber, paymentMethodLabel } from '../../lib/receiptPdf'
import { TEST_RECIPIENT } from '../../lib/emailConfig'

/*
 * SendReceiptModal — email a payment receipt for a PAID invoice.
 *
 * Patterned on SendEmailModal (edit/preview tabs, test send, PDF attached),
 * but attaches the receipt template (lib/receiptPdf) instead of the invoice,
 * and adds a paid-date field: the receipt states when payment was received, so
 * when the invoice has no recorded paid_date staff correct it here rather than
 * sending a receipt dated by guesswork. Defaults to paid_date, else today.
 *
 * Sends through /api/send-invoice with kind:'receipt', which records
 * receipt_sent_at (never delivery_status — the invoice was already delivered).
 */

const RECEIPT_SUBJECT = 'Receipt {{receiptNo}} – payment received for {{studentNames}}'
const RECEIPT_BODY =
`Hi {{guardian}},

Thank you — we have received your payment of {{amount}} for {{studentNames}} ({{term}}), paid on {{paidDate}}.

Your receipt is attached for your records. It references invoice {{invNo}}.

No further action is needed. If anything on the receipt looks incorrect, simply reply to this email.

Kind regards,
CUBE Tuition`

function buildReceiptText(inv, template, termName, paidDate) {
  return (template || '')
    .replace(/\{\{guardian\}\}/g,     inv.parent_name ? inv.parent_name.split(' ')[0] : 'there')
    .replace(/\{\{studentNames\}\}/g, (inv.student_names || []).join(', ') || inv.parent_name || '—')
    .replace(/\{\{term\}\}/g,         termName || '')
    .replace(/\{\{invNo\}\}/g,        inv.invoice_number || '—')
    .replace(/\{\{receiptNo\}\}/g,    receiptNumber(inv))
    .replace(/\{\{amount\}\}/g,       fmtMoney(inv.total))
    .replace(/\{\{paidDate\}\}/g,     fmtDate(paidDate) || '—')
    .replace(/\{\{method\}\}/g,       paymentMethodLabel(inv))
}

export function SendReceiptModal({ inv, term, onClose, onSent }) {
  const [paidDate, setPaidDate] = useState(() => inv.paid_date || new Date().toISOString().slice(0, 10))
  const [subject,  setSubject]  = useState(() => buildReceiptText(inv, RECEIPT_SUBJECT, term?.name, inv.paid_date || new Date().toISOString().slice(0, 10)))
  const [body,     setBody]     = useState(() => buildReceiptText(inv, RECEIPT_BODY, term?.name, inv.paid_date || new Date().toISOString().slice(0, 10)))
  const [sending,  setSending]  = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [testNote, setTestNote] = useState(null)
  const [error,    setError]    = useState(null)
  const [tab,      setTab]      = useState('edit')

  // Changing the paid date re-derives subject/body from the templates — the
  // date appears in the text, and stale text on a corrected date is exactly
  // the mistake this field exists to prevent. Any manual edits to the text are
  // redone after the change, which the modal makes obvious by re-rendering.
  const changePaidDate = (d) => {
    setPaidDate(d)
    setSubject(buildReceiptText(inv, RECEIPT_SUBJECT, term?.name, d))
    setBody(buildReceiptText(inv, RECEIPT_BODY, term?.name, d))
  }

  const makePdf = async () => {
    const doc = await generateReceiptPdf(inv, term?.name || '', paidDate)
    return doc
  }

  const handleDownload = async () => {
    setError(null)
    try {
      const doc = await makePdf()
      doc.save(`${receiptNumber(inv)}.pdf`)
    } catch (e) { setError(e.message) }
  }

  // Open the receipt in a new tab, exactly as it will be attached — generated
  // fresh so it always reflects the current paid date. Same convention as the
  // invoice rows' "View PDF".
  const handleView = async () => {
    setError(null)
    try {
      const doc = await makePdf()
      window.open(URL.createObjectURL(doc.output('blob')), '_blank', 'noopener')
    } catch (e) { setError(e.message) }
  }

  // test=true → exact same email, delivered to CUBE staff only (marked TEST);
  // receipt_sent_at is left untouched.
  const handleSend = async (test = false) => {
    if (!inv.parent_email) { setError('No email address on file for this family.'); return }
    test ? setTesting(true) : setSending(true)
    setError(null); setTestNote(null)
    try {
      const doc = await makePdf()
      const pdfUint8 = new Uint8Array(doc.output('arraybuffer'))
      let binary = ''
      for (let i = 0; i < pdfUint8.length; i++) binary += String.fromCharCode(pdfUint8[i])

      const res = await authedFetch('/api/send-invoice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_id: inv.id, email_to: inv.parent_email, subject, body,
          pdf_base64: btoa(binary), pdf_filename: `${receiptNumber(inv)}.pdf`,
          kind: 'receipt', test,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Send failed')
      }
      const data = await res.json().catch(() => ({}))
      if (test) {
        setTestNote(`Test sent to ${TEST_RECIPIENT}. The family was not emailed.`)
      } else {
        onSent(inv.id, data.receipt_sent_at)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      test ? setTesting(false) : setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#DEE7FF]">
          <div>
            <h3 className="font-bold text-[#065F46] text-sm">Send Payment Receipt</h3>
            <p className="text-[11px] text-[#325099]/50 mt-0.5">
              To: <span className="font-semibold text-[#325099]">{inv.parent_name}</span>
              {' · '}<span className="text-blue-600">{inv.parent_email || 'no email'}</span>
              {' · '}{receiptNumber(inv)} for {inv.invoice_number}
            </p>
          </div>
          <button onClick={onClose} className="text-[#325099]/40 hover:text-[#325099] text-lg">✕</button>
        </div>

        <div className="flex items-center justify-between px-6 pt-3 gap-3 flex-wrap">
          <div className="flex gap-1">
            {['edit', 'preview'].map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition capitalize ${tab === t ? 'bg-[#065F46] text-white' : 'text-[#325099]/60 hover:text-[#325099]'}`}>
                {t === 'edit' ? 'Edit' : 'Preview'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-[#325099]/60">
            Paid on
            <input
              type="date"
              value={paidDate}
              onChange={e => changePaidDate(e.target.value)}
              className="border border-[#DEE7FF] rounded-lg px-2 py-1 text-xs text-[#062E63] focus:outline-none focus:border-[#065F46]"
            />
            {!inv.paid_date && (
              <span className="font-normal text-[#92400E]" title="The invoice has no recorded paid date, so today's date is assumed — correct it if payment arrived earlier.">
                (not recorded on the invoice)
              </span>
            )}
          </label>
        </div>

        <div className="px-6 py-4 flex-1 overflow-y-auto space-y-3">
          {tab === 'edit' ? (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-1">Subject</label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#062E63] focus:outline-none focus:border-[#065F46]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-1">Email body</label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={14}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#062E63] font-mono resize-y focus:outline-none focus:border-[#065F46]"
                />
              </div>
            </>
          ) : (
            <div className="border border-[#DEE7FF] rounded-xl overflow-hidden">
              <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-4 py-3 space-y-1">
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">From:</span> CUBE Tuition &lt;admin@cubetuition.com.au&gt;</p>
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">To:</span> {inv.parent_name} &lt;{inv.parent_email}&gt;</p>
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">Subject:</span> {subject}</p>
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">Attachment:</span> 📎 {receiptNumber(inv)}.pdf</p>
              </div>
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
            📎 Receipt PDF ({receiptNumber(inv)}.pdf) will be generated and attached automatically — amount paid only, no invoice line items.
          </p>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {testNote && <p className="text-xs font-semibold text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3 py-2">🧪 {testNote}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[#DEE7FF] flex justify-end gap-2 flex-wrap">
          <button onClick={onClose} className="text-xs text-[#325099]/60 border border-[#DEE7FF] px-4 py-2 rounded-full hover:border-[#325099] transition">
            Cancel
          </button>
          <button onClick={handleView}
            title="Open the receipt PDF in a new tab, exactly as it will be attached"
            className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] px-4 py-2 rounded-full hover:bg-[#F0F4FF] transition">
            ↗ View PDF
          </button>
          <button onClick={handleDownload}
            title="Download the receipt PDF without emailing anything"
            className="text-xs font-semibold text-[#325099] border border-[#DEE7FF] px-4 py-2 rounded-full hover:bg-[#F0F4FF] transition">
            ⬇ Download PDF
          </button>
          <button onClick={() => handleSend(true)} disabled={sending || testing || !inv.parent_email}
            title="Send this exact email to CUBE staff only (marked TEST)"
            className="text-xs font-semibold text-[#92400E] border border-[#FDE68A] bg-[#FFFBEB] px-4 py-2 rounded-full hover:bg-[#FEF3C7] transition disabled:opacity-40">
            {testing ? 'Testing…' : '🧪 Test'}
          </button>
          <button onClick={() => handleSend(false)} disabled={sending || testing || !inv.parent_email}
            className="text-xs font-semibold bg-[#065F46] text-white px-6 py-2 rounded-full hover:bg-[#047857] transition disabled:opacity-40">
            {sending ? 'Sending…' : '✉ Send Receipt'}
          </button>
        </div>
      </div>
    </div>
  )
}
