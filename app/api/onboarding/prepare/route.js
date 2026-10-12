import { requireApiRole } from '../../../../lib/apiAuth'
import { serviceClient, newToken } from '../../../../lib/onboardingServer'

/*
 * POST /api/onboarding/prepare — directors only
 * Body: { name, email, startDate? }
 *
 * Step one of sending a pack: find the tutor by email or create their tutor
 * record (so they can be given pay rates before the pack goes out, and appear
 * in Payroll), and find or open their onboarding pack. A pack still in
 * progress is reused rather than duplicated.
 */
export async function POST(request) {
  const auth = await requireApiRole(request, ['admin', 'director'])
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
  try {
    const { name, email, startDate } = await request.json()
    const fullName = String(name || '').trim()
    const mail = String(email || '').trim().toLowerCase()
    if (!fullName) return Response.json({ error: 'Enter their name.' }, { status: 400 })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return Response.json({ error: 'Enter a valid email address.' }, { status: 400 })
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(startDate || '')) ? startDate : null

    const sb = serviceClient()
    const { data: found } = await sb.from('tutors').select('id, full_name, email, active, pay_method, started_on').ilike('email', mail).limit(1)
    let tutor = found?.[0] || null
    let tutorCreated = false
    if (!tutor) {
      const { data, error } = await sb.from('tutors')
        .insert({ full_name: fullName, email: mail, active: true, started_on: start })
        .select('id, full_name, email, active, pay_method, started_on').single()
      if (error) throw error
      tutor = data; tutorCreated = true
    } else if (start && !tutor.started_on) {
      await sb.from('tutors').update({ started_on: start }).eq('id', tutor.id)
    }

    const { data: open } = await sb.from('tutor_onboarding').select('*')
      .eq('tutor_id', tutor.id).neq('status', 'complete').order('created_at', { ascending: false }).limit(1)
    let onboarding = open?.[0] || null
    if (onboarding) {
      const { data } = await sb.from('tutor_onboarding')
        .update({ full_name: fullName, email: mail, start_date: start ?? onboarding.start_date, updated_at: new Date().toISOString() })
        .eq('id', onboarding.id).select('*').single()
      onboarding = data || onboarding
    } else {
      const { data, error } = await sb.from('tutor_onboarding')
        .insert({ tutor_id: tutor.id, full_name: fullName, email: mail, start_date: start, token: newToken() })
        .select('*').single()
      if (error) throw error
      onboarding = data
    }
    return Response.json({ onboarding, tutor, tutorCreated })
  } catch (e) {
    console.error('[onboarding/prepare]', e)
    return Response.json({ error: e.message || 'Could not prepare the pack.' }, { status: 500 })
  }
}
