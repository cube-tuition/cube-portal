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
  const d = new Date(iso)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
const CHANNEL = { account: 'to them', guardian: 'to parent', link: 'link given' }

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
    return {
      total: list.length,
      noLogin: list.filter(r => !r.hasLogin).length,
      neverSent: list.filter(r => r.hasLogin && !r.sentAt).length,
      neverSignedIn: list.filter(r => r.hasLogin && !r.lastSignInAt).length,
      unreachable: list.filter(r => r.hasLogin && !r.deliverable && !r.guardianEmail).length,
    }
  }, [rows])

  const shown = useMemo(() => {
    const list = rows || []
    if (filter === 'all') return list
    return list.filter(r => !r.hasLogin || !r.sentAt || !r.lastSignInAt)
  }, [rows, filter])

  if (err) return <p className="text-sm text-[#B23A3A]">{err}</p>
  if (!rows) return <div className="h-40 bg-white rounded-2xl border border-[#DEE7FF] animate-pulse" />

  return (
    <section className="bg-white rounded-2xl border border-[#DEE7FF] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#EEF2FF] flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-[#062E63]">Portal logins</h2>
          <p className="text-[11px] text-[#2A2035]/50 mt-0.5">
            {stats.noLogin} without a login · {stats.neverSent} never sent · {stats.neverSignedIn} never signed in
            {stats.unreachable > 0 && <span className="text-[#B45309]"> · {stats.unreachable} with no address to send to</span>}
          </p>
        </div>
        <div className="flex items-center rounded-lg border border-[#DEE7FF] overflow-hidden shrink-0">
          {[['todo', 'Needs attention'], ['all', `All ${stats.total}`]].map(([v, label]) => (
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
                <th className="px-3 py-2.5 font-bold">Username</th>
                <th className="px-3 py-2.5 font-bold">Details sent</th>
                <th className="px-3 py-2.5 font-bold">Signed in</th>
                <th className="px-3 py-2.5 font-bold text-right">Send</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF2FF]">
              {shown.map((r) => {
                const target = r.deliverable ? r.username : r.guardianEmail
                return (
                  <tr key={r.id} className="hover:bg-[#FAFBFF]">
                    <td className="px-5 py-2.5">
                      <span className="text-sm font-semibold text-[#062E63]">{r.name}</span>
                      {r.year && <span className="ml-1.5 text-[11px] text-[#2A2035]/40">Y{r.year}</span>}
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
                      {r.sentAt
                        ? <span className="text-[#065F46]">{fmt(r.sentAt)} <span className="text-[#2A2035]/45">{CHANNEL[r.sentChannel] || ''}</span></span>
                        : <span className="text-[#2A2035]/35">never</span>}
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
