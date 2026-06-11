/**
 * Stable identifiers for every Supabase table used by the portal.
 *
 * HOW TO RENAME A TABLE
 * ─────────────────────
 * 1. Run the SQL migration:  ALTER TABLE old_name RENAME TO new_name;
 * 2. Update the string value below (e.g. 'old_name' → 'new_name').
 * 3. Done. Every file that imports from here picks up the new name
 *    automatically — no grep, no 15-file hunt.
 *
 * Constant names (the keys) are the stable "IDs" and must never change.
 * String values are what actually hits the database.
 */

// ── Core ─────────────────────────────────────────────────────────────────────
export const T_STUDENTS           = 'students'
export const T_TUTORS             = 'tutors'
export const T_ADMINS             = 'directors'
export const T_PARENTS            = 'guardians'
export const T_COURSES            = 'courses'
export const T_CLASSES            = 'classes'
export const T_ENROLMENTS         = 'enrolments'
export const T_TERMS              = 'terms'

// ── Attendance & Results ──────────────────────────────────────────────────────
export const T_ATTENDANCE         = 'attendance'
export const T_QUIZ_RESULTS       = 'quiz_results'
export const T_RESULTS            = 'results'
export const T_EXAMS              = 'exams'
export const T_PREPOST_TESTS      = 'prepost_tests'
export const T_PREPOST_SCORES     = 'prepost_scores'

// ── Content ───────────────────────────────────────────────────────────────────
export const T_BOOKLETS           = 'booklets'
export const T_CLASS_BOOKLETS     = 'class_booklets'
export const T_INFO_PAGES         = 'info_pages'
export const T_FAQ_CATEGORIES     = 'faq_categories'
export const T_FAQ_ITEMS          = 'faq_items'

// ── Scheduling ────────────────────────────────────────────────────────────────
export const T_LESSONS            = 'lessons'
export const T_TIMETABLE          = 'timetable'
export const T_DROPIN_SESSIONS    = 'dropin_sessions'
export const T_DROPIN_SIGNINS     = 'dropin_signins'
export const T_SHIFTS             = 'shifts'
export const T_SUB_ASSIGNMENTS    = 'sub_assignments'

// ── Finance ───────────────────────────────────────────────────────────────────
export const T_INVOICES           = 'invoices'
export const T_STUDENT_CREDITS    = 'student_credits'
export const T_REFERRALS          = 'referrals'
export const T_PAY_RUNS           = 'pay_runs'
export const T_PAY_RUN_SHIFTS     = 'pay_run_shifts'
export const T_CURRENT_TUTOR_RATES = 'current_tutor_rates'
export const T_TUTOR_RATE_MATRIX  = 'tutor_rate_matrix'

// ── Reports ───────────────────────────────────────────────────────────────────
export const T_TERM_CRITERIA      = 'term_criteria'
export const T_TERM_COMMENTS      = 'term_comments'

// ── Operations ────────────────────────────────────────────────────────────────
export const T_TERM_TRANSITIONS   = 'term_transitions'
export const T_ENQUIRIES          = 'enquiries'
export const T_TRIAL_SUBMISSIONS  = 'trial_submissions'

// ── Question Bank (qbank) ─────────────────────────────────────────────────────
export const T_QBANK_SUBJECTS        = 'qbank_subjects'
export const T_QBANK_TOPICS          = 'qbank_topics'
export const T_QBANK_SKILLS          = 'qbank_skills'
export const T_QBANK_QUESTIONS       = 'qbank_questions'
export const T_QBANK_QUESTION_PARTS  = 'qbank_question_parts'
export const T_QBANK_QUESTION_IMAGES = 'qbank_question_images'
export const QBANK_BUCKET            = 'qbank-images'
