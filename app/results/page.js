import { redirect } from 'next/navigation'

// Results moved into Classes: each class now carries its own results and
// analytics, alongside that week's workbooks. Kept as a redirect so existing
// links and bookmarks still land somewhere useful.
export default function ResultsRedirect() {
  redirect('/classes')
}
