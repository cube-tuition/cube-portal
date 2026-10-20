/*
 * The one thing a trial card is waiting on — the trial flow chart
 * (components/trials/PipelineFlow) applied to one subject's submission.
 *
 * Returns either an action for staff
 *   { key, label }            key: 'first' | 'invitation' | 'level_test' |
 *                                  'lt_results' | 'assign' | 'lesson1' |
 *                                  'outcome' | 'decide'
 * or something the family / the timetable / an automatic email is doing
 *   { wait }                  a short "waiting for …" line
 * or null when the trial is decided (enrolled / declined) or on hold.
 *
 * `sub` is a trial_submissions row with the Trials page's extras:
 *   _levelTest   { booked: { date, start }, note, reportSent }
 *   _trialDates  the trial's two lesson dates (ISO), when a class is assigned
 * Pure (tests/trialNextStep.test.mjs).
 */
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const shortDay = (iso) => {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  return `${DAY[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`
}
const AUTO = 'reminder sends automatically'

export function nextStep(sub, today) {
  if (!sub || ['enrolled', 'declined', 'on_hold'].includes(sub.status)) return null
  const dates = sub._trialDates || []
  const lessonWait = (i) => {
    const d = dates[i]
    if (!d) return { wait: `Waiting for trial lesson ${i + 1}` }
    if (d < today) return { wait: `Trial lesson ${i + 1} was ${shortDay(d)} — waiting for the tutor to mark the roll and write feedback` }
    return { wait: `Waiting for trial lesson ${i + 1} · ${shortDay(d)} — ${AUTO}` }
  }

  if (sub.status === 'trial_completed') {
    return sub.outcome_sent_at ? { key: 'decide', label: 'Convert or drop' } : { key: 'outcome', label: '✉ Trial outcome' }
  }
  if (sub.status === 'trial_1_completed') {
    return sub.lesson1_feedback_sent_at ? lessonWait(1) : { key: 'lesson1', label: '✉ Lesson 1 feedback' }
  }
  if (sub.trial_class_id != null) return lessonWait(0)
  if (sub.status === 'trial_scheduled') return { key: 'assign', label: 'Assign a trial class' }

  // New / Contacted, no class yet: the first emails, with or without a level test.
  if (sub.invitation_sent_at) return { key: 'assign', label: 'Assign a trial class' }
  if (sub.level_test_invitation_sent_at) {
    const lt = sub._levelTest || {}
    if (lt.booked?.date) {
      if (lt.booked.date >= today) return { wait: `Level test booked · ${shortDay(lt.booked.date)} — ${AUTO}` }
      return lt.reportSent ? { key: 'invitation', label: '✉ Trial invitation' } : { key: 'lt_results', label: 'Level test results' }
    }
    if (lt.note) return { key: 'level_test', label: '✉ Offer new level test times' }
    return { wait: 'Waiting for the family to pick a level test time' }
  }
  return { key: 'first', label: '✉ Trial invitation' }
}

// Which button inside the card each action is — the one to highlight.
export const ACTION_BUTTON = {
  first: 'invitation', invitation: 'invitation', level_test: 'level_test',
  assign: 'assign', lesson1: 'lesson1', outcome: 'outcome', decide: 'decide',
}
