import { redirect } from 'next/navigation'

// The students directory has moved into the Database explorer (students → Directory view).
export default function StudentsRedirect() {
  redirect('/tutor/database')
}
