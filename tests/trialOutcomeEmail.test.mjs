/*
 * The two trial feedback emails — lib/trialOutcomeEmail.js. Pure.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stageGroups, nextLessonText, buildTrialOutcomeEmailHtml, fillTrialVars, mergeTrialOutcomeContent, TRIAL_EMAIL_STAGES } from '../lib/trialOutcomeEmail.js'

const groups = [
  { classId: 1, subject: 'Y5 Maths', lessons: [{ date: '2026-10-17', feedback: 'Great start' }, { date: '2026-10-24', feedback: 'Fractions clicked' }] },
  { classId: 2, subject: 'Y5 English', lessons: [{ date: '2026-10-20', feedback: 'Shy but keen' }] },
]

test('the lesson 1 email reports each subject’s first trial lesson', () => {
  const g = stageGroups(groups, 'lesson1')
  assert.deepEqual(g.map(x => [x.subject, x.lessons.map(l => [l.label, l.feedback])]),
    [['Y5 Maths', [['Lesson 1', 'Great start']]], ['Y5 English', [['Lesson 1', 'Shy but keen']]]])
})

test('the outcome email reports only lesson 2, leaving out subjects that have not had it yet', () => {
  const g = stageGroups(groups, 'outcome')
  assert.deepEqual(g.map(x => [x.subject, x.lessons.map(l => [l.label, l.feedback])]), [['Y5 Maths', [['Lesson 2', 'Fractions clicked']]]])
})

test('the next lesson reads as day, date and time; per subject when there are two', () => {
  assert.equal(nextLessonText([{ subject: 'Y5 Maths', date: '2026-10-24', start: '09:00:00', end: '10:30:00' }]), 'Saturday 24 October, 9:00am–10:30am')
  assert.equal(nextLessonText([{ subject: 'Y5 Maths', date: '2026-10-24', start: '4:00', end: '5:30' }]), 'Saturday 24 October, 4:00pm–5:30pm')
  assert.equal(nextLessonText([{ subject: 'Y5 Maths', date: '2026-10-24' }]), 'Saturday 24 October')
  assert.equal(
    nextLessonText([{ subject: 'Y5 Maths', date: '2026-10-24', start: '09:00' , end: '10:30' }, { subject: 'Y5 English', date: '2026-10-27', start: '16:00', end: '17:00' }]),
    'Y5 Maths on Saturday 24 October, 9:00am–10:30am and Y5 English on Tuesday 27 October, 4:00pm–5:00pm')
  assert.equal(nextLessonText([]), '')
})

test('{{next_lesson}} fills in, with a gentle fallback', () => {
  assert.equal(fillTrialVars('See you {{next_lesson}}', { nextLesson: 'Saturday 24 October' }), 'See you Saturday 24 October')
  assert.equal(fillTrialVars('See you at {{next_lesson}}', {}), 'See you at the next class')
})

test('each stage has its own wording and sent column; edits override the defaults', () => {
  assert.match(mergeTrialOutcomeContent(null, 'lesson1').subject, /first trial lesson/)
  assert.match(mergeTrialOutcomeContent(null, 'outcome').nextHeading, /Continuing/)
  assert.equal(mergeTrialOutcomeContent({ subject: 'Hi' }, 'lesson1').subject, 'Hi')
  assert.equal(TRIAL_EMAIL_STAGES.lesson1.sentField, 'lesson1_feedback_sent_at')
  assert.equal(TRIAL_EMAIL_STAGES.outcome.sentField, 'outcome_sent_at')
})

test('the lesson 1 email carries the feedback and the next lesson; a blank opt-out line is left out', () => {
  const html = buildTrialOutcomeEmailHtml({ parentName: 'Emiko', studentName: 'Akari', nextLesson: 'Saturday 24 October, 9:00am–10:30am' },
    stageGroups(groups, 'lesson1'), { optOutNote: '' }, 'lesson1')
  assert.match(html, /Great start/)
  assert.doesNotMatch(html, /Fractions clicked/)
  assert.match(html, /<strong>Saturday 24 October, 9:00am–10:30am<\/strong>/)
  assert.match(html, /Next trial lesson/)
  assert.doesNotMatch(html, /opacity:0\.6;">/)
})

test('the outcome email still defaults to its continue-or-not close', () => {
  const html = buildTrialOutcomeEmailHtml({ studentName: 'Akari' }, stageGroups(groups, 'outcome'))
  assert.match(html, /Fractions clicked/)
  assert.match(html, /reply to this email/)
  assert.match(html, /no obligation/)
})
