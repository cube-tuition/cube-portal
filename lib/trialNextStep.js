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
 *   _trialInvite { pick: option, note } — the family's answer on the trial
 *                invitation's class picker (lib/trialInvite), when it had one
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

// Sydney's date and wall-clock time, for the "has the test finished" check.
export function sydneyClock(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]))
  return { today: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` }
}
// A booked level test is still to come until its slot has ended (its end
// time, or its start when no end is known). Without a time of day only the
// date is compared, as before.
const stillToCome = (booked, today, nowTime) => {
  if (booked.date > today) return true
  if (booked.date < today) return false
  if (!nowTime) return true
  const ends = String(booked.end || booked.start || '23:59').slice(0, 5)
  return ends > nowTime
}
export function nextStep(sub, today, nowTime = null) {
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
  if (sub.invitation_sent_at) {
    const ti = sub._trialInvite
    // A class pick books itself; a 1:1 time is staff's to set up.
    if (ti?.pick?.kind === 'slot') return { key: 'assign', label: `Set up 1:1 trial · ${shortDay(ti.pick.date)} ${ti.pick.start}` }
    if (ti?.note) return { key: 'invitation', label: '✉ Offer other times' }
    if (ti) return { wait: 'Waiting for the family to pick a class' }
    return { key: 'assign', label: 'Assign a trial class' }
  }
  if (sub.level_test_invitation_sent_at) {
    const lt = sub._levelTest || {}
    if (lt.booked?.date) {
      if (stillToCome(lt.booked, today, nowTime)) return { wait: `Level test booked · ${shortDay(lt.booked.date)} — ${AUTO}` }
      // The results email carries the trial invitation (class picker) for
      // every open enquiry of the family — one send does both steps.
      return lt.reportSent ? { key: 'invitation', label: '✉ Trial invitation' } : { key: 'lt_results', label: '✉ Level test results + trial invitation' }
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

/*
 * The trial's stage as the card shows it — one pill that says where the
 * student is and what (if anything) is needed:
 *
 *   New                         → ✉ Level test invitation or ✉ Trial invitation
 *   Level test invited          → (waiting for the family) / Offer new times
 *   Level test booked           → nothing (reminder sends automatically) — until the slot ends
 *   Level test completed        → Level test results + trial invitation (Monitoring → Level tests)
 *   Trial invitation sent       → nothing (the family picks a class; reminder automatic)
 *   Trial lesson 1/2 completed  → Send feedback
 *   Trial lesson 2/2 completed  → Trial outcome
 *   Awaiting decision           → Convert or drop
 *   On hold / Enrolled / Declined
 *
 * Returns { id, label, action?: { key, label }, note? }. Built on nextStep(),
 * which already knows the rules; this names the stage around it.
 */
export function trialStage(sub, today, nowTime = null) {
  if (!sub) return null
  if (sub.status === 'enrolled') return { id: 'enrolled', label: 'Enrolled' }
  if (sub.status === 'declined') return { id: 'declined', label: 'Declined' }
  if (sub.status === 'on_hold') return { id: 'on_hold', label: 'On hold', note: sub.hold_until ? `check back ${shortDay(sub.hold_until)}` : '' }
  const step = nextStep(sub, today, nowTime) || {}
  const action = step.key ? { key: step.key, label: step.key === 'lesson1' ? '✉ Send feedback' : step.label } : null
  const note = step.wait ? step.wait.replace(/^Waiting for /, 'waiting for ') : ''
  if (sub.status === 'trial_completed') {
    return sub.outcome_sent_at
      ? { id: 'deciding', label: 'Awaiting decision', action }
      : { id: 'trial_2', label: 'Trial lesson 2/2 completed', action }
  }
  if (sub.status === 'trial_1_completed') return { id: 'trial_1', label: 'Trial lesson 1/2 completed', action, note }
  if (sub.invitation_sent_at || sub.trial_class_id != null || sub.status === 'trial_scheduled') {
    // An invitation with no form (sent before the class picker) leaves the
    // class to staff, as the opened card shows; the stage pill stays quiet.
    const quiet = step.key === 'assign' && sub._trialInvite?.pick?.kind !== 'slot'
    return { id: 'invited', label: 'Trial invitation sent', action: quiet ? null : action, note: action && !quiet ? '' : (sub.trial_class_id != null ? note : 'waiting for the family to pick a class') }
  }
  if (sub.level_test_invitation_sent_at) {
    const lt = sub._levelTest || {}
    if (lt.booked?.date) {
      return lt.booked.date >= today
        ? { id: 'lt_booked', label: 'Level test booked', note: `${shortDay(lt.booked.date)} · reminder sends automatically` }
        : { id: 'lt_done', label: 'Level test completed', action }
    }
    return { id: 'lt_invited', label: 'Level test invited', action, note: action ? '' : 'waiting for the family to pick a time' }
  }
  return { id: 'new', label: 'New', action }
}
