import { supabase } from './supabase'
import { T_ATTENDANCE, T_ENROLMENTS, T_LESSONS } from './tables'

/*
 * Booking a makeup for a student who missed (or will miss) a session.
 * Shared by the lessons sidebar in the database and the Absences tab on the
 * attendance page, so both book makeups the same way.
 *
 *   bookGuestMakeup     — the student joins another class's session (a sibling
 *                         class of the same course): the missed session is
 *                         marked 'makeup', the student is marked present as a
 *                         guest on the target, and a makeup lessons row puts
 *                         them on the target's roster and the tutor's calendar.
 *   bookOneToOneMakeup  — a new 1:1 lesson for the student on another date.
 *
 * Each returns { error: null } or { error: message }. The database triggers
 * on lessons/attendance keep the student's absence case in step (→ 'booked').
 *
 * source = the missed session's lessons row { id, class_id, lesson_date }.
 */

// The guard both flows share: a student already enrolled in the class they'd
// be "made up" into would just be double-booked.
async function enrolledIn(studentId, classId) {
  const { data } = await supabase.from(T_ENROLMENTS).select('id')
    .eq('student_id', studentId).eq('class_id', classId)
    .in('status', ['active', 'trial']).maybeSingle()
  return !!data
}

export async function bookGuestMakeup({ student, source, target }) {
  if (await enrolledIn(student.id, target.class_id)) {
    return { error: `${student.full_name} is already enrolled in ${target.classes?.class_name || 'that class'}, so they already attend that session — a makeup there would double-book them.` }
  }

  // 1. The missed session → 'makeup'
  const { error: err1 } = await supabase.from(T_ATTENDANCE).upsert({
    student_id: student.id, class_id: source.class_id,
    session_date: source.lesson_date, status: 'makeup',
  }, { onConflict: 'student_id,class_id,session_date' })
  if (err1) return { error: 'Failed to update original attendance: ' + err1.message }

  // 2. Present on the target session, as a guest
  const { error: err2 } = await supabase.from(T_ATTENDANCE).upsert({
    student_id: student.id, class_id: target.class_id,
    session_date: target.lesson_date, status: 'present',
    notes: `Makeup from ${source.lesson_date}`,
  }, { onConflict: 'student_id,class_id,session_date' })
  if (err2) return { error: 'Failed to update target attendance: ' + err2.message }

  // 3. A makeup lessons row on the target, so the student shows on its roster
  //    and the tutor's weekly calendar (once — skip if it already exists)
  const { data: existing } = await supabase
    .from(T_LESSONS).select('id').eq('is_makeup', true)
    .eq('makeup_student_id', student.id)
    .eq('class_id', target.class_id).eq('lesson_date', target.lesson_date)
    .maybeSingle()
  if (!existing) {
    const { error: err3 } = await supabase.from(T_LESSONS).insert({
      class_id: target.class_id,
      lesson_date: target.lesson_date,
      start_time: target.start_time,
      end_time: target.end_time,
      room: target.classes?.room || null,
      status: 'scheduled',
      week: target.week ?? null,
      is_makeup: true,
      makeup_student_id: student.id,
      makeup_source_lesson_id: source.id,
    })
    if (err3) return { error: 'Failed to create makeup lesson row: ' + err3.message }
  }
  return { error: null }
}

export async function bookOneToOneMakeup({ student, source, date, start, end, room, tutorId }) {
  // A 1:1 on a date the student's own class already runs would double-book them.
  const { data: clash } = await supabase.from(T_LESSONS).select('id')
    .eq('class_id', source.class_id).eq('lesson_date', date).eq('is_makeup', false)
    .limit(1).maybeSingle()
  if (clash && await enrolledIn(student.id, source.class_id)) {
    return { error: `${student.full_name} is already enrolled in this class and it runs on ${date}, so a makeup isn't needed — it would double-book them.` }
  }

  // Week number from any regular lesson on that date
  const { data: weekRef } = await supabase.from(T_LESSONS).select('week')
    .eq('lesson_date', date).eq('is_makeup', false).not('week', 'is', null)
    .limit(1).maybeSingle()

  const { error } = await supabase.from(T_LESSONS).insert({
    class_id: source.class_id,
    lesson_date: date,
    start_time: start || null,
    end_time: end || null,
    room: room || null,
    status: 'scheduled',
    week: weekRef?.week ?? null,
    scheduled_teacher_id: tutorId || null,
    is_makeup: true,
    makeup_student_id: student.id,
    makeup_source_lesson_id: source.id,
  })
  if (error) return { error: 'Failed to create makeup lesson: ' + error.message }

  const { error: attErr } = await supabase.from(T_ATTENDANCE).upsert({
    student_id: student.id, class_id: source.class_id,
    session_date: source.lesson_date, status: 'makeup',
    notes: `1:1 makeup scheduled for ${date}`,
  }, { onConflict: 'student_id,class_id,session_date' })
  if (attErr) return { error: 'Lesson created but failed to update attendance: ' + attErr.message }
  return { error: null }
}

/*
 * Undo a booked makeup that hasn't happened yet: the makeup lessons row goes
 * (its trigger moves the absence case back to "Needs action"), the guest's
 * pre-marked attendance on the target session goes, and the missed session
 * reads 'absent' again.
 *
 * makeupLesson = the makeup lessons row { id, class_id, lesson_date };
 * source = the missed session { class_id, lesson_date }.
 */
export async function cancelMakeup({ studentId, makeupLesson, source }) {
  const { error: delErr } = await supabase.from(T_LESSONS).delete().eq('id', makeupLesson.id).eq('is_makeup', true)
  if (delErr) return { error: 'Could not remove the makeup lesson: ' + delErr.message }
  // The attendance mark on the makeup session itself — a guest's pre-marked
  // "present", or anything marked on a 1:1 that is now not happening.
  await supabase.from(T_ATTENDANCE).delete()
    .eq('student_id', studentId).eq('class_id', makeupLesson.class_id).eq('session_date', makeupLesson.lesson_date)
  const { error: attErr } = await supabase.from(T_ATTENDANCE).upsert({
    student_id: studentId, class_id: source.class_id,
    session_date: source.lesson_date, status: 'absent',
  }, { onConflict: 'student_id,class_id,session_date' })
  if (attErr) return { error: 'Makeup removed, but the missed session could not be set back to absent: ' + attErr.message }
  return { error: null }
}
