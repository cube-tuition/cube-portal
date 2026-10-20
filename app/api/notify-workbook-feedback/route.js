import { createClient } from '@supabase/supabase-js'
import { requireApiRole } from '../../../lib/apiAuth'
import { sendPushToUsers } from '../../../lib/push'
import { bookletLabel } from '../../../lib/format'

/*
 * POST /api/notify-workbook-feedback
 * Body: { bookletId, list: 'fixes' | 'suggestions', text, className?, date? }
 *
 * A teacher has just added a Workbook Error or a Suggestion for Improvement
 * to a booklet's checklist (the lesson page's "Improving this workbook" box,
 * or the booklet's own checklist). Push the directors' phones — the iPhone app
 * and web push — linking to that booklet's checklist. Whoever wrote it is left
 * out, so a director noting something for themselves isn't buzzed by it.
 *
 * Best effort: the item is already saved and on the checklist, so a push
 * outage never looks like lost feedback.
 */
export const dynamic = 'force-dynamic'

export async function POST(req) {
  const auth = await requireApiRole(req, ['admin', 'tutor', 'director'])
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { bookletId, list, text, className, date } = body || {}
  if (!bookletId || !['fixes', 'suggestions'].includes(list) || !String(text || '').trim()) {
    return Response.json({ error: 'bookletId, list and text are required' }, { status: 400 })
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const [{ data: booklet }, { data: directors }, { data: who }] = await Promise.all([
    sb.from('booklets').select('id, booklet_name, year, subject').eq('id', bookletId).maybeSingle(),
    sb.from('directors').select('id'),
    sb.from('tutors').select('full_name').eq('id', auth.user.id).maybeSingle(),
  ])
  if (!booklet) return Response.json({ error: 'Booklet not found' }, { status: 404 })

  const recipients = (directors || []).map(d => d.id).filter(id => id !== auth.user.id)
  const author = who?.full_name || auth.user.user_metadata?.full_name || ''
  const dateLabel = date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''
  const context = [author, [className, dateLabel].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
  const kind = list === 'fixes' ? 'Workbook error' : 'Suggestion'

  const { sent } = await sendPushToUsers(recipients, {
    title: `${list === 'fixes' ? '🛠' : '💡'} ${kind} — ${bookletLabel(booklet)}`,
    body: [String(text).trim().slice(0, 300), context].filter(Boolean).join('\n'),
    url: `/tutor/booklets?booklet=${booklet.id}`,
    tag: `workbook-${booklet.id}-${list}-${Date.now()}`,   // one notification per item, never collapsed
  }).catch(() => ({ sent: 0 }))

  return Response.json({ ok: true, sent })
}
