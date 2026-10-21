'use client'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { requireStudent } from '../../lib/requireStudent'
import { T_STUDENTS } from '../../lib/tables'
import { isHighSchoolYear } from '../../lib/chat'
import PortalNav from '../../components/PortalNav'
import StaffChat from '../../components/chat/StaffChat'
import PushEnable from '../../components/PushEnable'

/*
 * Messages — /chat (students, Years 7–12)
 *
 * The student side of student messaging: a private thread with CUBE (every
 * director reads and replies as CUBE) and a channel for each of their
 * classes. The same StaffChat component the directors use, in student mode;
 * what a student may see and send is enforced by the database
 * (migrations/20261021_chat_students_live.sql), not by this page.
 *
 * ?c=<channel id> opens a conversation straight away (the link a push carries).
 */
const NOTICE_KEY = 'cube:chat-notice-seen'

export default function StudentChatPage() {
  return <Suspense><StudentChatInner /></Suspense>
}

function StudentChatInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [student, setStudent] = useState(null)
  const [me, setMe] = useState(null)
  const [state, setState] = useState('loading')   // loading | ok | primary
  const [noticeSeen, setNoticeSeen] = useState(true)

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!requireStudent(user, router)) return
      const { data } = await supabase.from(T_STUDENTS).select('id, full_name, year').eq('id', user.id).maybeSingle()
      setStudent(data)
      if (!isHighSchoolYear(data?.year)) { setState('primary'); return }
      setMe({ id: user.id, full_name: data?.full_name || user.email, isAdmin: false, isStudent: true })
      setState('ok')
      try { setNoticeSeen(localStorage.getItem(NOTICE_KEY) === '1') } catch { setNoticeSeen(true) }
    })()
  }, [router])

  const dismissNotice = () => { setNoticeSeen(true); try { localStorage.setItem(NOTICE_KEY, '1') } catch { /* fine */ } }

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <PortalNav studentName={student?.full_name} />
      {state === 'loading' && <p className="text-center text-sm text-[#2A2035]/40 py-20 animate-pulse">Loading…</p>}
      {state === 'primary' && (
        <div className="max-w-xl mx-auto px-6 py-20 text-center">
          <p className="text-lg font-bold text-[#062E63] mb-2">Messages are for Years 7–12</p>
          <p className="text-sm text-[#2A2035]/60">For now, families of primary students reach CUBE by text or phone.</p>
        </div>
      )}
      {state === 'ok' && me && (
        <div className="flex flex-col h-[calc(100dvh-64px)]">
          {!noticeSeen && (
            <div className="shrink-0 bg-[#FFF7E6] border-b border-[#FDE68A] px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <p className="text-[13px] text-[#92400E] flex-1 min-w-[16rem]">
                <span className="font-semibold">A quick word.</span> Messages here go to the CUBE directors and your teacher, and are kept on record.
              </p>
              <button onClick={dismissNotice} className="text-[12px] font-bold rounded-full px-3 py-1 bg-[#92400E] text-white">Got it</button>
            </div>
          )}
          <div className="shrink-0 bg-white border-b border-[#DEE7FF] px-4 py-1.5 flex items-center justify-between gap-3">
            <p className="text-[11px] text-[#2A2035]/50">Get a notification on this device when CUBE or your teacher messages you.</p>
            <PushEnable />
          </div>
          <div className="flex-1 min-h-0">
            <StaffChat me={me} audience="students" initialChannel={searchParams.get('c') || ''} className="h-full" />
          </div>
        </div>
      )}
    </div>
  )
}
