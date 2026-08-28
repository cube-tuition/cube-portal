'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { authedFetch } from '../../lib/authedFetch'

/*
 * "Have they got their login yet?" — the roster behind the monitoring page.
 *
 * Two different facts, kept apart because they answer different questions:
 *   Sent      — staff emailed the login details, and to whom. A delivery.
 *   Signed in — the student has actually used it. The only real proof it landed.
 *
 * The Send button emails the USERNAME and a single-use link for choosing a
 * password. Never a password: Supabase stores only hashes, so an existing one
 * cannot be looked up by anyone, and mailing one would leave it in an inbox for
 * as long as the message survives.
 *
 * Most CUBE logins are @cubetuition.com addresses with no mailbox, so for most
 * students the parent is the only reachable address. The button says which it
 * will use, and refuses rather than guessing when there is nowhere to send.
 */
const fmt = (iso) => {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
const ago = (iso) => {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}
const CHANNEL = { account: 'to them', guardian: 'to their parent', link: 'link handed over' }

// The status a row leads with, so "who has had this?" is answerable at a glance
// rather than by reading two date columns.
function statusOf(r) {
  if (!r.hasLogin) return { key: 'no-login', label: 'No login', fg: '#B23A3A', bg: '#FEF2F2', bd: '#FECACA' }
  if (!r.sentAt)   return { key: 'not-sent', label: 'Not sent', fg: '#B45309', bg: '#FFF7ED', bd: '#FDE2B8' }
  if (!r.lastSignInAt) return { key: 'sent', label: 'Sent · not used', fg: '#5B21B6', bg: '#F5F3FF', bd: '#DDD6FE' }
  return { key: 'in-use', label: 'Signed in', fg: '#047857', bg: '#ECFDF5', bd: '#D1FAE5' }
}

export default function LoginsPanel() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [filter, setFilter] = useState('todo')   // 'todo' | 'all'

  const load = useCallback(async () => {
    try {
      const res = await authedFetch('/api/send-login')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load logins')
      setRows(body.rows || [])
    } catch (e) { setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const send = async (r) => {
    // Their own address when it can receive mail, otherwise the parent's.
    const deliver = r.deliverable ? 'account' : 'guardian'
    const to = deliver === 'account' ? r.username : r.guardianEmail
    if (!to) return
    if (!confirm(`Email ${r.name}'s login details to ${to}?\n\nThey get their username and a link to choose a password — no password is sent.`)) return
    setBusy(r.id); setToast('')
    try {
      const res = await authedFetch('/api/send-login', {
        method: 'POST', body: JSON.stringify({ student_id: r.id, deliver }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Send failed')
      setToast(`Sent to ${body.sentTo}`)
      await load()
    } catch (e) { setToast(e.message) }
    finally { setBusy('') }
  }

  const stats = useMemo(() => {
    const list = rows || []
    const by = (k) => list.filter(r => statusOf(r).key === k).length
    return {
      total: list.length,
      sent: list.filter(r => r.sentAt).length,
      notSent: list.filter(r => !r.sentAt).length,
      noLogin: by('no-login'),
      neverSent: by('not-sent'),
      neverSignedIn: list.filter(r => r.hasLogin && !r.lastSignInAt).length,
      unreachable: list.filter(r => r.hasLogin && !r.deliverable && !r.guardianEmail).length,
    }
  }, [rows])

  const ORDER = { 'no-login': 0, 'not-sent': 1, sent: 2, 'in-use': 3 }
  const shown = useMemo(() => {
    const list = (rows || []).filter((r) => {
      if (filter === 'all') return true
      if (filter === 'not-sent') return !r.sentAt
      if (filter === 'sent') return !!r.sentAt
      return !r.hasLogin || !r.sentAt || !r.lastSignInAt   // 'todo'
    })
    // Anyone still waiting comes first — that is the list staff are working from.
    return [...list].sort((a, b) =>
      (ORDER[statusOf(a).key] - ORDER[statusOf(b).key]) || a.name.localeCompare(b.name))
  }, [rows, filter])

  if (err) return <p className="text-sm text-[#B23A3A]">{err}</p>
  if (!rows) return <div className="h-40 bg-white rounded-2xl border border-[#DEE7FF] animate-pulse" />

  return (
    <section className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#EEF2FF] flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-[#062E63]">Portal logins</h2>
          <p className="text-[12px] text-[#2A2035]/70 mt-0.5">
            <span className="font-bold text-[#047857]">{stats.sent} sent</span>
            <span className="text-[#2A2035]/30"> · </span>
            <span className="font-bold text-[#B45309]">{stats.notSent} not sent</span>
            <span className="text-[#2A2035]/45"> of {stats.total} students</span>
          </p>
          <p className="text-[11px] text-[#2A2035]/45 mt-0.5">
            {stats.noLogin} without a login · {stats.neverSignedIn} never signed in
            {stats.unreachable > 0 && <span className="text-[#B45309]"> · {stats.unreachable} with no address to send to</span>}
          </p>
        </div>
        <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden shrink-0">
          {[['todo', 'Needs attention'], ['not-sent', `Not sent ${stats.notSent}`], ['sent', `Sent ${stats.sent}`], ['all', `All ${stats.total}`]].map(([v, label]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-3 py-1.5 text-xs font-semibold transition ${filter === v ? 'bg-[#325099] text-white' : 'text-[#325099] hover:bg-[#F0F4FF]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {toast && <p className="px-5 py-2 text-xs font-semibold text-[#062E63] bg-[#EEF4FF] border-b border-[#DEE7FF]">{toast}</p>}

      {shown.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-[#2A2035]/45">Everyone has their login and has signed in.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-[#F8FAFF] text-[10px] uppercase tracking-wider text-[#325099]">
              <tr>
                <th className="px-5 py-2.5 font-bold">Student</th>
                <th className="px-3 py-2.5 font-bold">Status</th>
                <th className="px-3 py-2.5 font-bold">Login details sent</th>
                <th className="px-3 py-2.5 font-bold">Username</th>
                <th className="px-3 py-2.5 font-bold">Signed in</th>
                <th className="px-3 py-2.5 font-bold text-right">Send</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF2FF]">
              {shown.map((r) => {
                const target = r.deliverable ? r.username : r.guardianEmail
                const st = statusOf(r)
                return (
                  <tr key={r.id} className={`hover:bg-[#FAFBFF] ${r.sentAt ? '' : 'bg-[#FFFDF7]'}`}>
                    <td className="px-5 py-2.5">
                      <span className="text-sm font-semibold text-[#062E63]">{r.name}</span>
                      {r.year && <span className="ml-1.5 text-[11px] text-[#2A2035]/40">Y{r.year}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border whitespace-nowrap"
                        style={{ color: st.fg, background: st.bg, borderColor: st.bd }}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.sentAt ? (
                        <>
                          <span className="block text-[#2A2035] break-all">{r.sentTo || CHANNEL[r.sentChannel]}</span>
                          <span className="block text-[10px] text-[#2A2035]/45">
                            {fmt(r.sentAt)} · {ago(r.sentAt)}
                            {r.sentChannel === 'guardian' && ' · parent'}
                            {r.sentBy ? ` · by ${r.sentBy.split(' ')[0]}` : ''}
                          </span>
                        </>
                      ) : (
                        <span className="text-[#B45309] font-semibold">Not sent yet</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[#2A2035]/70">
                      {r.hasLogin
                        ? <>
                            <span className="break-all">{r.username}</span>
                            {!r.deliverable && <span className="ml-1.5 text-[10px] font-bold text-[#B45309]" title="No mailbox — this address cannot receive email">no mailbox</span>}
                          </>
                        : <span className="text-[10px] font-bold text-[#B23A3A] bg-[#FEF2F2] border border-[#FECACA] px-1.5 py-0.5 rounded">no login</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.lastSignInAt
                        ? <span className="text-[#065F46]">{fmt(r.lastSignInAt)}</span>
                        : <span className="text-[#B45309] font-semibold">never</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {!r.hasLogin ? (
                        <span className="text-[11px] text-[#2A2035]/40" title="Create the login first, in Database → Students">create login first</span>
                      ) : !target ? (
                        <span className="text-[11px] text-[#B45309]" title="Their login has no mailbox and no parent email is on file">nowhere to send</span>
                      ) : (
                        <button onClick={() => send(r)} disabled={busy === r.id}
                          title={`Sends the username and a set-password link to ${target}`}
                          className="text-xs font-semibold text-white bg-[#325099] hover:bg-[#062E63] rounded-full px-3 py-1.5 disabled:opacity-40">
                          {busy === r.id ? 'Sending…' : r.sentAt ? 'Send again' : 'Send login'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-5 py-3 text-[11px] text-[#2A2035]/45 border-t border-[#EEF2FF]">
        The email carries the username and a single-use link for choosing a password — never a password itself.
        Where a login has no mailbox, it goes to the parent on file.
      </p>
    </section>
  )
}
