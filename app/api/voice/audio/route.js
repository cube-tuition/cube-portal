import { requireApiRole } from '../../../../lib/apiAuth'
import { fetchRecordingAudio } from '../../../../lib/twilio'

/*
 * GET /api/voice/audio?sid=RE… — streams a voicemail recording to a staff
 * browser. Twilio recordings need the account's credentials, which stay on the
 * server; the page just points an <audio> tag here.
 */
export const dynamic = 'force-dynamic'

export async function GET(req) {
  const auth = await requireApiRole(req, ['admin', 'director'])
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  const sid = new URL(req.url).searchParams.get('sid') || ''
  if (!/^RE[a-f0-9]{32}$/.test(sid)) return Response.json({ error: 'Bad recording id' }, { status: 400 })
  const res = await fetchRecordingAudio(sid)
  if (!res.ok) return Response.json({ error: `Twilio ${res.status}` }, { status: 502 })
  return new Response(res.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=3600' } })
}
