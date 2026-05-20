import Airtable from 'airtable'
import { createClient } from '@supabase/supabase-js'

/*
 * /api/sync-classes
 * ─────────────────────────────────────────────────────────────────────────────
 * Pulls the Airtable "Classes" table (env: AIRTABLE_CLASSES_TABLE) and:
 *   1. Upserts each Airtable row into public.classes (keyed by airtable_id).
 *   2. Parses the "Students" rollup/text into a list of full names.
 *   3. Looks each name up in public.students (case-insensitive).
 *   4. Reconciles public.student_classes — inserts new enrolments, deletes
 *      enrolments where the student is no longer listed against that class.
 *
 * Auth: Bearer ${CRON_SECRET} (same pattern as /api/sync-quizzes).
 *
 * Optional query params:
 *   ?term=26T2   — only sync rows where Airtable "Term" matches this value.
 *                  Useful so you can run a "current term only" sync without
 *                  rewiring enrolments from previous terms.
 *   ?dry=1       — don't write anything; return what *would* change.
 *
 * Expected Airtable field names (case-insensitive; first match wins):
 *   Class name   → "Class" | "Class Name" | "Name"
 *   Term         → "Term"
 *   Day of week  → "Day" | "Day of Week"
 *   Time range   → "Time"              e.g. "4:00 - 5:30"
 *   Teacher      → "Teacher"
 *   Room         → "Room"
 *   Students     → "Students"          rolled-up or comma-sep text
 */

const pickField = (fields, candidates) => {
  // Match keys case-insensitively
  const keys = Object.keys(fields)
  for (const want of candidates) {
    const hit = keys.find(k => k.toLowerCase() === want.toLowerCase())
    if (hit && fields[hit] != null && fields[hit] !== '') return fields[hit]
  }
  return null
}

const parseTimeRange = (raw) => {
  if (!raw) return { start: null, end: null }
  const parts = String(raw).split(/\s*[-–—]\s*/)
  return {
    start: parts[0]?.trim() || null,
    end:   parts[1]?.trim() || null,
  }
}

const parseStudentList = (raw) => {
  if (!raw) return []
  // Rollups sometimes return arrays; also handle ", " separated strings
  if (Array.isArray(raw)) {
    return raw.flatMap(x => parseStudentList(x))
  }
  return String(raw)
    .split(/\s*,\s*/)
    .map(s => s.trim())
    .filter(Boolean)
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const termFilter = url.searchParams.get('term') // e.g. "26T2"
  const dryRun = url.searchParams.get('dry') === '1'

  try {
    if (!process.env.AIRTABLE_CLASSES_TABLE) {
      return Response.json({ error: 'AIRTABLE_CLASSES_TABLE not set in env' }, { status: 500 })
    }

    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
      .base(process.env.AIRTABLE_BASE_ID)

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // ── 1. Pull all Airtable rows ───────────────────────────────────────────
    const records = await new Promise((resolve, reject) => {
      const all = []
      base(process.env.AIRTABLE_CLASSES_TABLE).select().eachPage(
        (page, fetchNext) => { all.push(...page); fetchNext() },
        (err) => err ? reject(err) : resolve(all)
      )
    })

    // ── 2. Load all students once (id, full_name, airtable_id) for matching
    const { data: studentRows, error: stuErr } = await supabase
      .from('students')
      .select('id, full_name, airtable_id')
    if (stuErr) {
      return Response.json({ error: `Could not load students: ${stuErr.message}` }, { status: 500 })
    }
    const studentByName = new Map(
      (studentRows || []).map(s => [String(s.full_name || '').trim().toLowerCase(), s.id])
    )

    const stats = {
      total_airtable_rows: records.length,
      classes_upserted: 0,
      classes_skipped: [],          // rows we couldn't process
      enrolments_added: 0,
      enrolments_dropped: 0,
      students_not_matched: new Set(), // names we couldn't find
    }

    // In dry runs, surface the Airtable field names we actually see so we
    // can fix any name mismatches without guessing.
    const fieldSamples = dryRun
      ? records.slice(0, 3).map(r => ({ airtable_id: r.id, fields: Object.keys(r.fields || {}) }))
      : null

    // ── 3. Process each Airtable record ─────────────────────────────────────
    for (const rec of records) {
      const f = rec.fields || {}

      // Term filter
      const term = pickField(f, ['Term'])
      if (termFilter && term !== termFilter) continue

      // "Courses" is the human-readable class label (e.g. "Y8 Maths Online")
      // shown to students. "Class ID" is a coded row identifier
      // (e.g. "8.MO.26T2"). Use Courses for display; fall back to Class ID
      // only if Courses is empty.
      const className = pickField(f, ['Courses', 'Course', 'Class', 'Class Name', 'Name', 'Class ID'])
      if (!className) {
        stats.classes_skipped.push({ airtable_id: rec.id, reason: 'no class name' })
        continue
      }

      const day  = pickField(f, ['Day', 'Day of Week'])
      const time = pickField(f, ['Time'])
      const { start, end } = parseTimeRange(time)
      const teacher = pickField(f, ['Main Teacher', 'Teacher'])
      const room    = pickField(f, ['Room'])
      const studentsRaw = pickField(f, ['Students'])

      const classRow = {
        airtable_id: rec.id,
        class_name:  String(className).trim(),
        day_of_week: day  ? String(day).trim()  : null,
        start_time:  start,
        end_time:    end,
        teacher:     teacher ? String(teacher).trim() : null,
        room:        room    ? String(room).trim()    : null,
      }

      let classId
      if (dryRun) {
        // Resolve the existing id if any so the student-match step still works.
        // Count as "would upsert" regardless of whether the row exists yet.
        const { data: existing } = await supabase
          .from('classes')
          .select('id')
          .eq('airtable_id', rec.id)
          .maybeSingle()
        classId = existing?.id
        stats.classes_upserted += 1
      } else {
        const { data: upserted, error: upErr } = await supabase
          .from('classes')
          .upsert(classRow, { onConflict: 'airtable_id' })
          .select('id')
          .single()
        if (upErr) {
          stats.classes_skipped.push({ airtable_id: rec.id, reason: upErr.message })
          continue
        }
        classId = upserted.id
        stats.classes_upserted += 1
      }
      // In dry-run, if the class doesn't exist yet, we can't preview enrolments
      // (no class_id) — skip the join-table preview for those rows. Live runs
      // always have an id at this point.
      if (!classId) continue

      // ── 4. Reconcile enrolments for this class ────────────────────────────
      const names = parseStudentList(studentsRaw)
      const desiredIds = new Set()
      for (const name of names) {
        const id = studentByName.get(name.trim().toLowerCase())
        if (id) desiredIds.add(id)
        else stats.students_not_matched.add(name)
      }

      const { data: existing, error: exErr } = await supabase
        .from('student_classes')
        .select('id, student_id')
        .eq('class_id', classId)
      if (exErr) continue

      const existingByStudent = new Map((existing || []).map(r => [r.student_id, r.id]))
      const toInsert = [...desiredIds].filter(sid => !existingByStudent.has(sid))
      const toDelete = (existing || [])
        .filter(r => !desiredIds.has(r.student_id))
        .map(r => r.id)

      if (!dryRun && toInsert.length > 0) {
        const { error: insErr } = await supabase
          .from('student_classes')
          .insert(toInsert.map(sid => ({ student_id: sid, class_id: classId })))
        if (!insErr) stats.enrolments_added += toInsert.length
      } else if (dryRun) {
        stats.enrolments_added += toInsert.length
      }

      if (!dryRun && toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from('student_classes')
          .delete()
          .in('id', toDelete)
        if (!delErr) stats.enrolments_dropped += toDelete.length
      } else if (dryRun) {
        stats.enrolments_dropped += toDelete.length
      }
    }

    return Response.json({
      success: true,
      dry_run: dryRun,
      term_filter: termFilter || null,
      ...stats,
      students_not_matched: [...stats.students_not_matched],
      ...(fieldSamples ? { field_samples: fieldSamples } : {}),
    })
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}
