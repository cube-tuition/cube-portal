import Airtable from 'airtable'
import { createClient } from '@supabase/supabase-js'
import { T_CLASSES, T_ENROLMENTS, T_STUDENTS } from '../../../lib/tables'

/*
 * /api/sync-classes
 * ─────────────────────────────────────────────────────────────────────────────
 * Pulls the Airtable "Classes" table (env: AIRTABLE_CLASSES_TABLE) and:
 *   1. Upserts each Airtable row into public.classes (keyed by airtable_id).
 *   2. Parses the "Students" rollup/text into a list of full names.
 *   3. Looks each name up in public.students (case-insensitive).
 *   4. Reconciles public.enrolments — inserts new enrolments, deletes
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
      .from(T_STUDENTS)
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
      classes_archived: 0,          // present in Supabase, gone from Airtable
      classes_reactivated: 0,       // archived_at cleared because they reappeared
      classes_skipped: [],          // rows we couldn't process
      enrolments_added: 0,
      enrolments_dropped: 0,
      students_not_matched: new Set(), // names we couldn't find
    }

    // Track which Airtable IDs we saw this run — used by the sweep below.
    const seenAirtableIds = new Set()

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

      // Mark this Airtable row as "seen" BEFORE any per-row skip logic.
      // The sweep uses this set to decide what to archive — rows that are
      // present in Airtable but skipped here for any reason (no name, etc.)
      // should NOT be treated as absent.
      seenAirtableIds.add(rec.id)

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
      let wasArchived = false
      if (dryRun) {
        // Resolve the existing id if any so the student-match step still works.
        // Count as "would upsert" regardless of whether the row exists yet.
        const { data: existing } = await supabase
          .from(T_CLASSES)
          .select('id, archived_at')
          .eq('airtable_id', rec.id)
          .maybeSingle()
        classId = existing?.id
        wasArchived = !!existing?.archived_at
        stats.classes_upserted += 1
        if (wasArchived) stats.classes_reactivated += 1
      } else {
        // Clear archived_at on every upsert — if a class is back in Airtable,
        // it's active again.
        const { data: upserted, error: upErr } = await supabase
          .from(T_CLASSES)
          .upsert({ ...classRow, archived_at: null }, { onConflict: 'airtable_id' })
          .select('id, archived_at')
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
        .from(T_ENROLMENTS)
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
          .from(T_ENROLMENTS)
          .insert(toInsert.map(sid => ({ student_id: sid, class_id: classId })))
        if (!insErr) stats.enrolments_added += toInsert.length
      } else if (dryRun) {
        stats.enrolments_added += toInsert.length
      }

      if (!dryRun && toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from(T_ENROLMENTS)
          .delete()
          .in('id', toDelete)
        if (!delErr) stats.enrolments_dropped += toDelete.length
      } else if (dryRun) {
        stats.enrolments_dropped += toDelete.length
      }
    }

    // ── 5. Sweep: archive Supabase classes that are no longer in Airtable ──
    // Only safe on full pulls. Term-scoped pulls would otherwise archive every
    // class outside the filtered term.
    const archivePreview = []
    if (!termFilter) {
      const { data: allActive, error: actErr } = await supabase
        .from(T_CLASSES)
        .select('id, airtable_id, class_name, archived_at')
        .is('archived_at', null)
        .not('airtable_id', 'is', null)
      if (!actErr && allActive) {
        const toArchive = allActive.filter(c => !seenAirtableIds.has(c.airtable_id))
        for (const c of toArchive) {
          archivePreview.push({ id: c.id, airtable_id: c.airtable_id, class_name: c.class_name })
        }
        if (!dryRun && toArchive.length > 0) {
          const ids = toArchive.map(c => c.id)
          const { error: arErr } = await supabase
            .from(T_CLASSES)
            .update({ archived_at: new Date().toISOString() })
            .in('id', ids)
          if (!arErr) stats.classes_archived = ids.length
        } else if (dryRun) {
          stats.classes_archived = toArchive.length
        }
      }
    }

    return Response.json({
      success: true,
      dry_run: dryRun,
      term_filter: termFilter || null,
      sweep_skipped_due_to_term_filter: !!termFilter,
      ...stats,
      students_not_matched: [...stats.students_not_matched],
      ...(dryRun ? { archive_preview: archivePreview } : {}),
      ...(fieldSamples ? { field_samples: fieldSamples } : {}),
    })
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}
