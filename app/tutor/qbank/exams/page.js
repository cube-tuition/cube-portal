import { redirect } from 'next/navigation'

// The exams list now lives in the unified Tests hub (Term Tests tab). The list
// logic moved into components/resources/ExamsPanel.js; the per-exam editor
// stays at /tutor/qbank/exams/[id]. This old index route forwards to the hub so
// existing links/bookmarks keep working.
export default function ExamsIndexRedirect() {
  redirect('/tutor/resources/tests')
}
