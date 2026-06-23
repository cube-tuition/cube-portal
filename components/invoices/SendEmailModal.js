'use client'
import { authedFetch } from '../../lib/authedFetch'
import { useState } from 'react'
import { fmtMoney, fmtDate } from '../../lib/format'
import { generateInvoicePdf } from '../../lib/invoicePdf'

function daysOverdue(dueDate) {
  if (!dueDate) return 0
  const ms = Date.now() - new Date(dueDate + 'T00:00:00').getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

export function buildEmailBody(inv, template, termName) {
  return (template || '')
    .replace(/\{\{guardian\}\}/g,     inv.parent_name ? inv.parent_name.split(' ')[0] : 'there')
    .replace(/\{\{studentNames\}\}/g, (inv.student_names || []).join(', ') || inv.parent_name || '—')
    .replace(/\{\{term\}\}/g,         termName || '')
    .replace(/\{\{invNo\}\}/g,        inv.invoice_number || '—')
    .replace(/\{\{amount\}\}/g,       fmtMoney(inv.total))
    .replace(/\{\{dueDate\}\}/g,      fmtDate(inv.due_date))
    .replace(/\{\{daysOverdue\}\}/g,  String(daysOverdue(inv.due_date)))
}

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
  const [subject,  setSubject]  = useState(() =>
    buildEmailBody(inv, reminder ? REMINDER_SUBJECT : (emailSubjectTemplate || 'Invoice for {{studentNames}} – {{term}}'), term?.name))
  const [body,     setBody]     = useState(() => buildEmailBody(inv, reminder ? REMINDER_BODY : emailTemplate, term?.name))
  const [sending,  setSending]  = useState(false)
  const [error,    setError]    = useState(null)
  const [tab,      setTab]      = useState('edit')

  const handleSend = async () => {
    if (!inv.parent_email) { setError('No email address on file for this family.'); return }
    setSending(true); setError(null)
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
        body: JSON.stringify({ invoice_id: inv.id, email_to: inv.parent_email, subject, body, pdf_base64, pdf_filename, is_reminder: reminder }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Send failed')
      }
      const data = await res.json().catch(() => ({}))
      onSent(inv.id, data.reminder_sent_at)
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#DEE7FF]">
          <div>
            <h3 className="font-bold text-[#062E63] text-sm">{reminder ? 'Send Overdue Reminder' : 'Send Invoice'}</h3>
            <p className="text-[11px] text-[#325099]/50 mt-0.5">
              To: <span className="font-semibold text-[#325099]">{inv.parent_name}</span>
              {' · '}<span className="text-blue-600">{inv.parent_email || 'no email'}</span>
              {' · '}{inv.invoice_number}
            </p>
          </div>
          <button onClick={onClose} className="text-[#325099]/40 hover:text-[#325099] text-lg">✕</button>
        </div>

        <div className="flex gap-1 px-6 pt-3">
          {['edit', 'preview'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition capitalize ${tab === t ? 'bg-[#062E63] text-white' : 'text-[#325099]/60 hover:text-[#325099]'}`}>
              {t === 'edit' ? 'Edit' : 'Preview'}
            </button>
          ))}
        </div>

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
              <div className="bg-[#F8FAFF] border-b border-[#DEE7FF] px-4 py-3 space-y-1">
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">From:</span> CUBE Tuition &lt;admin@cubetuition.com.au&gt;</p>
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">To:</span> {inv.parent_name} &lt;{inv.parent_email}&gt;</p>
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">Subject:</span> {subject}</p>
                <p className="text-[11px] text-[#325099]/50"><span className="font-semibold">Attachment:</span> 📎 {inv.invoice_number || 'invoice'}.pdf</p>
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
            📎 Invoice PDF ({inv.invoice_number || 'invoice'}.pdf) will be generated and attached automatically.
          </p>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[#DEE7FF] flex justify-end gap-2">
          <button onClick={onClose} className="text-xs text-[#325099]/60 border border-[#DEE7FF] px-4 py-2 rounded-full hover:border-[#325099] transition">
            Cancel
          </button>
          <button onClick={handleSend} disabled={sending || !inv.parent_email}
            className="text-xs font-semibold bg-[#062E63] text-white px-6 py-2 rounded-full hover:bg-[#325099] transition disabled:opacity-40">
            {sending ? 'Sending…' : (reminder ? '✉ Send Reminder' : '✉ Send Invoice')}
          </button>
        </div>
      </div>
    </div>
  )
}
