import { redirect } from 'next/navigation'

// Level Tests moved out of Trials into Monitoring; keep old links working.
export default function LevelTestsMoved() {
  redirect('/tutor/admin/monitoring/level-tests')
}
