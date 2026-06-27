import { redirect } from 'next/navigation'

// Level tests now live in the unified Tests hub (Level Tests tab). The list +
// builder logic moved into components/resources/LevelTestsPanel.js. This old
// route just forwards there so existing links/bookmarks keep working.
export default function LevelTestIndexRedirect() {
  redirect('/tutor/resources/tests?tab=level-tests')
}
