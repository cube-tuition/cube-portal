'use client'
import { authedFetch } from '../../lib/authedFetch'
import { useState } from 'react'
import { fmtMoney, fmtDate } from '../../lib/format'
import { generateInvoicePdf } from '../../lib/invoicePdf'
import { TEST_RECIPIENT } from '../../lib/emailConfig'
import { CASH_PAYMENT_INSTRUCTIONS, BANK_PAYMENT_INSTRUCTIONS } from '../../lib/cashDiscount'

function daysOverdue(dueDate) {
  if (!dueDate) return 0
  const ms = Date.now() - new Date(dueDate + 'T00:00:00').getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

/*
 * How this family actually pays, for the email's "how to pay" section.
 *
 * Prefers the invoice's own payment_instructions — kept in step with the
 * payment method by the generator, the Refresh action and the payment-method
 * switch — so a cash family is never sent bank details. [Reference] is filled
 * the same way the PDF fills it.
 */
function paymentDetailsFor(inv) {
  const fallback = inv?.payment_method === 'cash' ? CASH_PAYMENT_INSTRUCTIONS : BANK_PAYMENT_INSTRUCTIONS
  return (inv?.payment_instructions || fallback)
    .replace('[Invoice Number]', inv?.invoice_number || '')
    .replace('[Reference]', inv?.reference_code || inv?.invoice_number || '')
}

/*
 * What changed since the copy the family received. The send flow snapshots the
 * invoice (sent_snapshot), so the list is a real diff — it survives several
 * refreshes, reverts and hand edits between sends. Falls back to the summary
 * Refresh recorded, then to a generic line (snapshots only exist for sends
 * made after the feature shipped).
 */
const lineKey = (l) => l.type === 'enrolment'
  ? `e:${l.student_id}__${l.class_id}`
  : `${l.type}:${l.reason || l.description || l.class_name || ''}`
const lineLabel = (l) => l.type === 'enrolment'
  ? [l.student_name, l.class_name].filter(Boolean).join(' – ')
  : (l.reason || l.description || l.class_name || l.type)
export function changesSince(inv) {
  const snap = inv.sent_snapshot
  if (snap && Array.isArray(snap.line_items)) {
    const before = new Map(snap.line_items.map(l => [lineKey(l), l]))
    const after  = new Map((inv.line_items || []).map(l => [lineKey(l), l]))
    const out = []
    for (const [k, l] of after) {
      const old = before.get(k)
      if (!old) out.push(`Added ${lineLabel(l)} (${fmtMoney(l.amount)})`)
      else if (Number(old.amount) !== Number(l.amount)) out.push(`${lineLabel(l)}: ${fmtMoney(old.amount)} → ${fmtMoney(l.amount)}`)
    }
    for (const [k, l] of before) {
      if (!after.has(k)) out.push(`Removed ${lineLabel(l)} (${fmtMoney(l.amount)})`)
    }
    if (Number(snap.total) !== Number(inv.total)) out.push(`Total ${fmtMoney(snap.total)} → ${fmtMoney(inv.total)}`)
    if (out.length) return out
  }
  if (Array.isArray(inv.change_summary) && inv.change_summary.length) return inv.change_summary
  return ['The invoice details were updated.']
}

export function buildEmailBody(inv, template, termName) {
  const changes = changesSince(inv).map(c => `• ${c}`).join('\n')
  return (template || '')
    .replace(/\{\{changes\}\}/g,      changes)
    .replace(/\{\{paymentDetails\}\}/g, paymentDetailsFor(inv))
    .replace(/\{\{guardian\}\}/g,     inv.parent_name ? inv.parent_name.split(' ')[0] : 'there')
    .replace(/\{\{studentNames\}\}/g, (inv.student_names || []).join(', ') || inv.parent_name || '—')
    .replace(/\{\{term\}\}/g,         termName || '')
    .replace(/\{\{invNo\}\}/g,        inv.invoice_number || '—')
    .replace(/\{\{amount\}\}/g,       fmtMoney(inv.total))
    .replace(/\{\{dueDate\}\}/g,      fmtDate(inv.due_date))
    .replace(/\{\{daysOverdue\}\}/g,  String(daysOverdue(inv.due_date)))
}

// Built-in templates for re-sending an invoice that changed after it was
// delivered: say it is a revision and what changed (editable in the modal).
const REVISED_SUBJECT = 'Revised invoice {{invNo}} for {{studentNames}} – {{term}}'
const REVISED_BODY =
`Hi {{guardian}},

Please find attached a revised invoice {{invNo}} for {{studentNames}} ({{term}}). It replaces the copy we sent earlier.

What changed:
{{changes}}

The updated amount is {{amount}}, due {{dueDate}}.

{{paymentDetails}}

If you have any questions about the change, simply reply to this email.

Kind regards,
CUBE Tuition`

// Built-in default templates for an overdue reminder (editable in the modal).
const REMINDER_SUBJECT = 'Overdue: Invoice {{invNo}} for {{studentNames}} – {{term}}'
const REMINDER_BODY =
`Hi {{guardian}},

This is a friendly reminder that invoice {{invNo}} for {{studentNames}} ({{term}}) is now overdue. The amount of {{amount}} was due on {{dueDate}} ({{daysOverdue}} days ago).

If you have already arranged payment, please disregard this email and accept our thanks. Otherwise, we would appreciate it if you could settle the invoice at your earliest convenience. A copy is attached for your reference.

If you have any questions or believe this is in error, simply reply to this email.

Kind regards,
CUBE Tuition`

export function SendEmailModal({ inv, term, emailTemplate, emailSubjectTemplate, reminder = false, onClose, onSent }) {
  // A re-send of an invoice that changed after delivery opens as a REVISED
  // invoice email: it says so and lists the recorded changes.
  const revised = !reminder && !!inv.updated_since_sent
  const [subject,  setSubject]  = useState(() =>
    buildEmailBody(inv,
      reminder ? REMINDER_SUBJECT
        : revised ? REVISED_SUBJECT
        : (emailSubjectTemplate || 'Invoice for {{studentNames}} – {{term}}'), term?.name))
  const [body,     setBody]     = useState(() =>
    buildEmailBody(inv, reminder ? REMINDER_BODY : revised ? REVISED_BODY : emailTemplate, term?.name))
  const [sending,  setSending]  = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [testNote, setTestNote] = useState(null)
  const [error,    setError]    = useState(null)
  const [tab,      setTab]      = useState('edit')

  // test=true → exact same email, but delivered to CUBE staff only (marked
  // TEST), and the invoice's real "sent" status is left untouched.
  const handleSend = async (test = false) => {
    if (!inv.parent_email) { setError('No email address on file for this family.'); return }
    test ? setTesting(true) : setSending(true)
    setError(null); setTestNote(null)
    try {
      const termDates = term ? `${fmtDate(term.start_date)} to ${fmtDate(term.end_date)}` : ''
      const doc = await generateInvoicePdf(inv, term?.name || '', termDates)
      const pdfArrayBuffer = doc.output('arraybuffer')
      const pdfUint8 = new Uint8Array(pdfArrayBuffer)
      let binary = ''
      for (let i = 0; i < pdfUint8.length; i++) binary += String.fromCharCode(pdfUint8[i])
      const pdf_base64  = btoa(binary)
      const pdf_filename = `${inv.invoice_number || 'invoice'}.pdf`

      const res = await authedFetch('/api/send-invoice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: inv.id, email_to: inv.parent_email, subject, body, pdf_base64, pdf_filename, is_reminder: reminder, test }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Send failed')
      }
      const data = await res.json().catch(() => ({}))
      if (test) {
        setTestNote(`Test sent to ${TEST_RECIPIENT}. The family was not emailed.`)
      } else {
        onSent(inv.id, data.reminder_sent_at)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      test ? setTesting(false) : setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm md:px-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90dvh] md:max-h-[90vh]">
        <div className="flex items-start md:items-center justify-between gap-3 px-4 md:px-6 pt-5 pb-4 border-b border-[#DEE7FF]">
          <div className="min-w-0">
            <h3 className="font-bold text-[#062E63] text-sm">{reminder ? 'Send Overdue Reminder' : 'Send Invoice'}</h3>
            <p className="text-[11px] text-[#325099]/50 mt-0.5">
              To: <span className="font-semibold text-[#325099]">{inv.parent_name}</span>
              {' · '}<span className="text-blue-600 break-all md:break-normal">{inv.parent_email || 'no email'}</span>
              {' · '}{inv.invoice_number}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-[#325099]/40 hover:text-[#325099] text-lg p-2 -m-2 md:p-0 md:m-0">✕</button>
        </div>

        <div className="flex gap-1 px-4 md:px-6 pt-3">
          {['edit', 'preview'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs font-semibold px-4 py-2 md:py-1.5 rounded-lg transition capitalize ${tab === t ? 'bg-[#062E63] text-white' : 'text-[#325099]/60 hover:text-[#325099]'}`}>
              {t === 'edit' ? 'Edit' : 'Preview'}
            </button>
          ))}
        </div>

        <div className="px-4 md:px-6 py-4 flex-1 overflow-y-auto space-y-3">
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
              <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-4 py-3 space-y-1 break-words">
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">From:</span> CUBE Tuition &lt;admin@cubetuition.com.au&gt;</p>
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">To:</span> {inv.parent_name} &lt;{inv.parent_email}&gt;</p>
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">Subject:</span> {subject}</p>
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">Attachment:</span> 📎 {inv.invoice_number || 'invoice'}.pdf</p>
              </div>
              <div className="bg-white px-4 md:px-5 py-4 break-words">
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
          {testNote && <p className="text-xs font-semibold text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3 py-2">🧪 {testNote}</p>}
        </div>

        <div className="px-4 md:px-6 py-4 border-t border-[#DEE7FF] flex flex-wrap md:flex-nowrap justify-end gap-2">
          <button onClick={onClose} className="text-xs text-[#325099]/60 border border-[#DEE7FF] px-4 py-2.5 md:py-2 rounded-full hover:border-[#325099] transition">
            Cancel
          </button>
          <button onClick={() => handleSend(true)} disabled={sending || testing || !inv.parent_email}
            title="Send this exact email to CUBE staff only (marked TEST)"
            className="text-xs font-semibold text-[#92400E] border border-[#FDE68A] bg-[#FFFBEB] px-4 py-2.5 md:py-2 rounded-full hover:bg-[#FEF3C7] transition disabled:opacity-40">
            {testing ? 'Testing…' : '🧪 Test'}
          </button>
          <button onClick={() => handleSend(false)} disabled={sending || testing || !inv.parent_email}
            className="text-xs font-semibold bg-[#062E63] text-white px-6 py-2.5 md:py-2 rounded-full hover:bg-[#325099] transition disabled:opacity-40">
            {sending ? 'Sending…' : (reminder ? '✉ Send Reminder' : '✉ Send Invoice')}
          </button>
        </div>
      </div>
    </div>
  )
}
