import { createClient } from '@supabase/supabase-js'

/*
 * POST /api/generate-draft-invoices
 *
 * Body: { term_id: string }
 *
 * For each family with active enrolments in the term that doesn't already
 * have an invoice for this term:
 *   - Creates a draft invoice record
 *   - Assigns a global invoice number: CUBE-{year}-T{term_number}-{seq}
 *   - Builds line_items JSONB from enrolments
 *   - Calculates subtotal (ex-GST), GST (10%), total (inc-GST)
 *   - Sets due_date = today + 14 days
 */

const PAYMENT_INSTRUCTIONS =
`Bank Transfer:
Account name: CUBE Tuition Pty Ltd
BSB: XXX-XXX  |  Account: XXXXXXXX
Reference: [Invoice Number]

Please update BSB/Account in app/api/generate-draft-invoices/route.js`

export async function POST(req) {
  try {
    const { term_id } = await req.json()
    if (!term_id) return Response.json({ error: 'Missing term_id' }, { status: 400 })

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // ── Load term ────────────────────────────────────────────────────────────
    const { data: term, error: termErr } = await sb
      .from('terms').select('id, name, year, term_number, start_date, end_date')
      .eq('id', term_id).single()
    if (termErr || !term) return Response.json({ error: 'Term not found' }, { status: 404 })

    // ── Load active enrolments with class + student + guardian ───────────────
    const { data: classes } = await sb
      .from('classes').select('id, class_name, day_of_week, start_time, end_time, teacher')
      .eq('term_id', term_id)
    const classMap = Object.fromEntries((classes || []).map(c => [c.id, c]))
    const classIds = (classes || []).map(c => c.id)
    if (!classIds.length) return Response.json({ created: 0, skipped: 0, message: 'No classes in term' })

    const { data: enrolments } = await sb
      .from('enrolments')
      .select('id, student_id, class_id, price, status')
      .in('class_id', classIds)
      .eq('status', 'active')

    if (!enrolments?.length) return Response.json({ created: 0, skipped: 0, message: 'No active enrolments' })

    const studentIds = [...new Set(enrolments.map(e => e.student_id))]

    const [{ data: students }, { data: guardians }] = await Promise.all([
      sb.from('students').select('id, full_name, family_id').in('id', studentIds),
      sb.from('guardians').select('student_id, full_name, email, phone').in('student_id', studentIds),
    ])

    const studMap     = Object.fromEntries((students  || []).map(s => [s.id, s]))
    const guardianMap = Object.fromEntries((guardians || []).map(g => [g.student_id, g]))

    // ── Load credits per student ─────────────────────────────────────────────
    const { data: credits } = await sb
      .from('student_credits').select('student_id, amount, reason')
      .in('student_id', studentIds).is('invoice_id', null) // unapplied credits
    const creditsByStudent = {}
    for (const c of credits || []) {
      if (!creditsByStudent[c.student_id]) creditsByStudent[c.student_id] = []
      creditsByStudent[c.student_id].push(c)
    }

    // ── Check existing invoices for this term ────────────────────────────────
    const { data: existing } = await sb
      .from('invoices').select('family_id, student_id')
      .eq('term_id', term_id)
      .not('status', 'eq', 'voided')
    const existingFamilies = new Set(
      (existing || []).map(i => i.family_id ?? `student:${i.student_id}`)
    )

    // ── Group enrolments by family ───────────────────────────────────────────
    const familyMap = {}
    for (const e of enrolments) {
      const s   = studMap[e.student_id]
      const key = s?.family_id ?? `student:${e.student_id}`
      if (!familyMap[key]) familyMap[key] = {
        family_id:  s?.family_id ?? null,
        student_id: s?.family_id ? null : e.student_id, // for solo students
        enrolments: [],
      }
      familyMap[key].enrolments.push(e)
    }

    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 14)
    const dueDateIso = dueDate.toISOString().slice(0, 10)

    let created = 0
    let skipped = 0
    const errors = []

    // Base sequence on MAX existing invoice number, not COUNT (gaps in numbering cause collisions)
    const { data: maxInvRow } = await sb
      .from('invoices').select('invoice_number')
      .not('invoice_number', 'is', null)
      .order('invoice_number', { ascending: false })
      .limit(1)
      .single()
    const maxSeq = maxInvRow?.invoice_number
      ? parseInt(maxInvRow.invoice_number.split('-')[1], 10) || 0
      : 0

    for (const [key, family] of Object.entries(familyMap)) {
      if (existingFamilies.has(key)) { skipped++; continue }

      // Build line items — prices are stored inc-GST as-is
      const lineItems = []
      let subtotalIncGst = 0

      for (const e of family.enrolments) {
        const s   = studMap[e.student_id]
        const cls = classMap[e.class_id]
        const fee = parseFloat(e.price) || 0  // inc-GST
        subtotalIncGst += fee
        lineItems.push({
          student_id:   e.student_id,
          student_name: s?.full_name || '—',
          class_id:     e.class_id,
          class_name:   cls?.class_name || '—',
          day:          cls?.day_of_week || '',
          start_time:   cls?.start_time || '',
          unit_price:   fee,
          quantity:     1,
          amount:       fee,
          type:         'enrolment',
        })
      }

      // ── Sibling discount: ≥2 distinct students → student_count × $50 (inc-GST) ─────
      const distinctStudents = [...new Set(family.enrolments.map(e => e.student_id))]
      const siblingDiscount  = distinctStudents.length >= 2 ? distinctStudents.length * 50 : 0
      if (siblingDiscount > 0) {
        lineItems.push({ type: 'discount', reason: `Sibling discount (${distinctStudents.length} students)`, amount: -siblingDiscount })
      }

      // ── Multi-course discount: per student with ≥2 enrolments → count × $50 (inc-GST)
      const enrolsByStudent = {}
      for (const e of family.enrolments) {
        if (!enrolsByStudent[e.student_id]) enrolsByStudent[e.student_id] = 0
        enrolsByStudent[e.student_id]++
      }
      let multiCourseDiscount = 0
      for (const [sid, cnt] of Object.entries(enrolsByStudent)) {
        if (cnt >= 2) {
          const disc = cnt * 50
          multiCourseDiscount += disc
          lineItems.push({ type: 'discount', reason: `Multi-course discount (${studMap[sid]?.full_name?.split(' ')[0] || 'student'}, ${cnt} courses)`, amount: -disc })
        }
      }

      // ── Referral / other credits (unapplied: invoice_id = null) ──────────
      let totalCredits = 0
      const creditStudents = new Set(family.enrolments.map(e => e.student_id))
      for (const sid of creditStudents) {
        for (const c of creditsByStudent[sid] || []) {
          const amt = parseFloat(c.amount) || 0
          totalCredits += amt
          lineItems.push({ type: 'credit', reason: c.reason, amount: -amt })
        }
      }

      // All amounts are inc-GST; GST is a component of the total (total ÷ 11), not added on top
      const total = Math.max(0, subtotalIncGst - siblingDiscount - multiCourseDiscount - totalCredits)

      const seqNum = maxSeq + created + 1

      const year2d        = String(term.year).slice(-2)  // e.g. '26'
      const invoiceNumber = `${year2d}T${term.term_number}-${String(seqNum).padStart(4, '0')}`  // e.g. '26T2-0001'
      const referenceCode = `INV${String(seqNum).padStart(4, '0')}`                             // e.g. 'INV0001'

      // IDs of held credits being applied to this invoice
      const appliedCreditIds = []
      for (const sid of creditStudents) {
        for (const c of creditsByStudent[sid] || []) {
          if (c.id) appliedCreditIds.push(c.id)
        }
      }

      const { error: insErr, data: newInvoice } = await sb.from('invoices').insert({
        term_id:              term_id,
        family_id:            family.family_id,
        student_id:           family.student_id,
        invoice_number:       invoiceNumber,
        reference_code:       referenceCode,
        status:               'draft',
        subtotal:             total,
        sibling_discount:     siblingDiscount,
        multi_course_discount: multiCourseDiscount,
        total:                total,
        due_date:             dueDateIso,
        line_items:           lineItems,
        payment_instructions: PAYMENT_INSTRUCTIONS,
        email_sent:           false,
      }).select('id').single()

      if (insErr) { errors.push({ key, error: insErr.message }); continue }

      // Link held credits to the new invoice
      if (newInvoice?.id && appliedCreditIds.length > 0) {
        await sb.from('student_credits')
          .update({ invoice_id: newInvoice.id })
          .in('id', appliedCreditIds)
      }

      created++
    }

    return Response.json({ created, skipped, errors: errors.length ? errors : undefined })

  } catch (err) {
    console.error('[generate-draft-invoices]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
