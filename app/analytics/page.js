import { redirect } from 'next/navigation'

// Analytics has been folded into the course-tabbed /results page.
// Each course's tab now includes its own performance trend, quiz tracker,
// homework, exams, and attendance.
export default function AnalyticsRedirect() {
  redirect('/results')
}
