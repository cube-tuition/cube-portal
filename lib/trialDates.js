/*
 * Which lessons a trial covers — shared by the trial reminder email
 * (lib/trialReminderEmail) and the trial pipeline nudges (lib/trialPipeline).
 * Pure, so it loads anywhere (browser, server, tests).
 */
export const TRIAL_LESSONS = 2

/** The lessons a trial covers: the class's first two on/after the trial start, cancelled ones skipped. */
export function trialDatesFor(lessonDates = [], trialStart = null) {
  return lessonDates.filter(d => !trialStart || d >= trialStart).slice(0, TRIAL_LESSONS)
}

/**
 * The default first trial lesson for a class: its earliest lesson on or after
 * today (lessonDates ascending, cancelled ones already left out). With nothing
 * scheduled yet it falls back to today, which still means "the next lesson".
 */
export function earliestTrialStart(lessonDates = [], todayISO) {
  return lessonDates.find(d => d >= todayISO) || todayISO
}
