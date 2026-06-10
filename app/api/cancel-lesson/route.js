import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/cancel-lesson
 *
 * Body: {
 *   lesson_id:    number   — the lesson being cancelled
 *   student_id:   string   — the student being cancelled
 *   type:         'credit' | 'non_credit'
 *   reason:       string   (optional)
 * }
 *
 * Logic:
 *  1. Fetch lesson + student enrolment price to calculate credit (price / 10)
 *  2. Create/update attendance row → status 'cancelled'
 *  3. If type === 'credit':
 *       a. Find open (unsent) invoice for this student's family this term
 *       b. If found: add student_credit row linked to that invoice, deduct from invoice total
 *       c. If not found: add student_credit row with invoice_id = null (held balance)
 *  4. Create lesson_cancellations row
 *  5. Send email to guardian if credit applied
 */
export async function POST(req) {
  try {
    const { lesson_id, student_id, type, reason } = await req.json()
    if (!lesson_id || !student_id || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    // ── 1. Fetch lesson + class info ─────────────────────────────────────────
    const { data: lesson, error: lessonErr } = await sb
      .from('lessons')
      .select('id, lesson_date, class_id, classes(id, class_name, term_id)')
      .eq('id', lesson_id)
      .single()
    if (lessonErr || !lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })

    const termId = lesson.classes?.term_id

    // ── 2. Fetch enrolment price for this student in this class ──────────────
    const { data: enrolment } = await sb
      .from('enrolments')
      .select('id, price')
      .eq('student_id', student_id)
      .eq('class_id', lesson.class_id)
      .maybeSingle()

    const creditAmount = type === 'credit' && enrolment?.price
      ? Math.round((Number(enrolment.price) / 10) * 100) / 100
      : null

    // ── 3. Create/update attendance row as 'cancelled' ───────────────────────
    const { data: existingAtt } = await sb
      .from('attendance')
      .select('id')
      .eq('student_id', student_id)
      .eq('class_id', lesson.class_id)
      .eq('session_date', lesson.lesson_date)
      .maybeSingle()

    let attendanceId = existingAtt?.id
    if (attendanceId) {
      await sb.from('attendance').update({ status: 'cancelled' }).eq('id', attendanceId)
    } else {
      const { data: newAtt } = await sb.from('attendance').insert({
        student_id,
        class_id: lesson.class_id,
        session_date: lesson.lesson_date,
        status: 'cancelled',
      }).select('id').single()
      attendanceId = newAtt?.id
    }

    // ── 4. Credit logic ──────────────────────────────────────────────────────
    let studentCreditId = null
    let appliedInvoiceId = null
    let heldForNextTerm = false

    if (type === 'credit' && creditAmount) {
      // Find student's family_id
      const { data: student } = await sb.from('students').select('family_id').eq('id', student_id).single()

      // Look for an open (unsent) invoice for this family/student in this term
      let openInvoice = null
      if (termId) {
        const invoiceQuery = sb
          .from('invoices')
          .select('id, total, delivery_status')
          .eq('term_id', termId)
          .neq('status', 'voided')
          .in('delivery_status', ['unsent', null])
          .order('created_at', { ascending: false })
          .limit(1)

        if (student?.family_id) {
          invoiceQuery.eq('family_id', student.family_id)
        } else {
          invoiceQuery.eq('student_id', student_id)
        }
        const { data: invoices } = await invoiceQuery
        openInvoice = invoices?.[0] || null
      }

      if (openInvoice) {
        // Apply credit to current open invoice
        appliedInvoiceId = openInvoice.id
        const creditReason = `Lesson cancellation – ${lesson.classes?.class_name || 'class'} on ${lesson.lesson_date}`
        const { data: credit } = await sb.from('student_credits').insert({
          student_id,
          amount: creditAmount,
          reason: creditReason,
          notes: reason || null,
          invoice_id: openInvoice.id,
        }).select('id').single()
        studentCreditId = credit?.id

        // Deduct from invoice total AND add credit line item so it shows on the invoice
        const { data: invRow } = await sb.from('invoices').select('total, line_items').eq('id', openInvoice.id).single()
        const existingItems = Array.isArray(invRow?.line_items) ? invRow.line_items : []
        const creditLineItem = { type: 'credit', reason: creditReason, amount: -creditAmount, student_id }
        const newTotal = Math.max(0, Number(invRow?.total ?? openInvoice.total) - creditAmount)
        await sb.from('invoices').update({
          total: newTotal,
          line_items: [...existingItems, creditLineItem],
        }).eq('id', openInvoice.id)
      } else {
        // Hold credit for next term
        heldForNextTerm = true
        const { data: credit } = await sb.from('student_credits').insert({
          student_id,
          amount: creditAmount,
          reason: `Lesson cancellation – ${lesson.classes?.class_name || 'class'} on ${lesson.lesson_date} (held for next term)`,
          notes: reason || null,
          invoice_id: null,
        }).select('id').single()
        studentCreditId = credit?.id
      }

    }

    // ── 6. Create lesson_cancellations record ────────────────────────────────
    const { data: cancellation } = await sb.from('lesson_cancellations').insert({
      lesson_id,
      student_id,
      type,
      reason: reason || null,
      credit_amount: creditAmount,
      student_credit_id: studentCreditId,
      attendance_id: attendanceId,
      applied_invoice_id: appliedInvoiceId,
      held_for_next_term: heldForNextTerm,
    }).select('id').single()

    // ── 7. Mark lesson as cancelled if ALL enrolled students are now cancelled ─
    const { data: enrolledStudents } = await sb
      .from('enrolments')
      .select('student_id')
      .eq('class_id', lesson.class_id)
      .in('status', ['active', 'trial'])

    if (enrolledStudents?.length) {
      const enrolledIds = enrolledStudents.map(e => e.student_id)
      const { data: activeCancellations } = await sb
        .from('lesson_cancellations')
        .select('student_id')
        .eq('lesson_id', lesson_id)
        .is('undone_at', null)

      const cancelledIds = new Set((activeCancellations || []).map(c => c.student_id))
      const allCancelled = enrolledIds.every(id => cancelledIds.has(id))

      if (allCancelled) {
        await sb.from('lessons').update({ status: 'cancelled' }).eq('id', lesson_id)
      }
    }

    return NextResponse.json({
      success: true,
      cancellation_id: cancellation?.id,
      credit_amount: creditAmount,
      applied_invoice_id: appliedInvoiceId,
      held_for_next_term: heldForNextTerm,
    })
  } catch (err) {
    console.error('[cancel-lesson]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
