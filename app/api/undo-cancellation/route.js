import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/undo-cancellation
 * Body: { cancellation_id: number }
 *
 * Reverses a lesson cancellation:
 *  1. Delete the attendance 'cancelled' row (or revert to previous status)
 *  2. Delete the student_credit row and restore invoice total
 *  3. Mark lesson_cancellations row as undone
 */
export async function POST(req) {
  try {
    const { cancellation_id } = await req.json()
    if (!cancellation_id) return NextResponse.json({ error: 'Missing cancellation_id' }, { status: 400 })

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    // Fetch the cancellation record
    const { data: canc, error: cancErr } = await sb
      .from('lesson_cancellations')
      .select('*')
      .eq('id', cancellation_id)
      .single()
    if (cancErr || !canc) return NextResponse.json({ error: 'Cancellation not found' }, { status: 404 })
    if (canc.undone_at) return NextResponse.json({ error: 'Already undone' }, { status: 400 })

    // 1. Remove cancelled attendance row
    if (canc.attendance_id) {
      await sb.from('attendance').delete().eq('id', canc.attendance_id).eq('status', 'cancelled')
    }

    // 2. Remove credit and restore invoice total
    if (canc.student_credit_id) {
      await sb.from('student_credits').delete().eq('id', canc.student_credit_id)
      if (canc.applied_invoice_id && canc.credit_amount) {
        const { data: inv } = await sb.from('invoices').select('total').eq('id', canc.applied_invoice_id).single()
        if (inv) {
          await sb.from('invoices').update({ total: Number(inv.total) + Number(canc.credit_amount) }).eq('id', canc.applied_invoice_id)
        }
      }
    }

    // 3. Mark as undone
    await sb.from('lesson_cancellations').update({ undone_at: new Date().toISOString() }).eq('id', cancellation_id)

    // 4. Restore lesson status to 'scheduled' if it was fully cancelled
    await sb.from('lessons').update({ status: 'scheduled' }).eq('id', canc.lesson_id).eq('status', 'cancelled')

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[undo-cancellation]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
