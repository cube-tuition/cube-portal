/*
 * The level-test feedback email, in one place — the marking page renders the
 * SAME text as its preview that the API route actually sends, so the two can
 * never drift. Parent-friendly template first, then the teacher's comment
 * (when there is one), then the sign-off.
 */

export function levelTestEmailSubject({ studentName, testTitle }) {
  const title = testTitle || 'Level Test'
  return `${studentName ? studentName + ' — ' : ''}${title} Feedback Report`
}

export function levelTestEmailBody({ studentName, testTitle, comment, teacherName }) {
  const who = studentName ? studentName.split(' ')[0] : 'your child'
  const title = testTitle || 'Level Test'
  const paragraphs = [
    'Hi,',
    `Thank you for bringing ${who} in to sit the ${title} with us — it was lovely to have them in the centre.`,
    `Please find ${who}'s feedback report attached. It shows the overall result and a topic-by-topic breakdown, highlighting the areas ${who} is already doing well in and the areas we'd suggest focusing on next. A level test is a snapshot of where a student is right now, so it's best read as a starting point rather than a judgement.`,
    ...(comment && comment.trim() ? [comment.trim()] : []),
    'If you have any questions, or would like to chat about the next steps, just reply to this email — we’re always happy to help.',
    `Warm regards,\n${teacherName ? `${teacherName}\n` : ''}CUBE Tuition`,
  ]
  return paragraphs.join('\n\n')
}
