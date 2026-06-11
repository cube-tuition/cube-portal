'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getAuthProfile } from '../../../lib/getProfile'
import TutorNav from '../../../components/TutorNav'

const DAYS         = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAY_SLOTS = ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30']
const SAT_SLOTS     = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
                       '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30']
const slotsFor = (day) => day === 'Saturday' ? SAT_SLOTS : WEEKDAY_SLOTS
// All unique slots across all days, for row rendering
const ALL_SLOTS = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
                   '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
                   '18:00', '18:30', '19:00', '19:30']

function fmtSlot(t) {
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')}${period}`
}

export default function AvailabilityPage() {
  const router  = useRouter()
  const [profile,  setProfile]  = useState(null)
  const [isAdmin,  setIsAdmin]  = useState(false)
  const [avail,    setAvail]    = useState(new Set()) // Set of "day|slot" strings
  const [toggling, setToggling] = useState(new Set()) // cells currently saving
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile) { router.replace('/'); return }
      setProfile(profile)
      setIsAdmin(role === 'admin' || role === 'director')
    })
  }, [router])

  const loadAvail = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const { data } = await supabase
      .from('teacher_availability')
      .select('day_of_week, slot_time')
      .eq('tutor_id', profile.id)
    const keys = new Set((data || []).map(r => `${r.day_of_week}|${r.slot_time}`))
    setAvail(keys)
    setLoading(false)
  }, [profile])

  useEffect(() => { loadAvail() }, [loadAvail])

  const toggle = async (day, slot) => {
    const key = `${day}|${slot}`
    if (toggling.has(key)) return
    setToggling(prev => new Set([...prev, key]))

    const isOn = avail.has(key)
    // Optimistic update
    setAvail(prev => {
      const next = new Set(prev)
      isOn ? next.delete(key) : next.add(key)
      return next
    })

    if (isOn) {
      await supabase.from('teacher_availability')
        .delete()
        .eq('tutor_id', profile.id)
        .eq('day_of_week', day)
        .eq('slot_time', slot)
    } else {
      await supabase.from('teacher_availability')
        .insert({ tutor_id: profile.id, day_of_week: day, slot_time: slot })
    }

    setToggling(prev => { const n = new Set(prev); n.delete(key); return n })
  }

  const availCount = avail.size

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin={isAdmin} />

      <div className="max-w-5xl mx-auto px-6 pt-10 pb-24">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#062E63]">My Availability</h1>
          <p className="text-sm text-[#325099]/60 mt-1">
            Click a slot to mark yourself available. Changes save instantly.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Summary chip */}
            <div className="flex items-center gap-2 mb-5">
              <span className="text-xs font-semibold text-[#325099] bg-[#EEF4FF] border border-[#DEE7FF] px-3 py-1 rounded-full">
                {availCount} slot{availCount !== 1 ? 's' : ''} marked available
              </span>
              {availCount > 0 && (
                <button
                  onClick={async () => {
                    await supabase.from('teacher_availability').delete().eq('tutor_id', profile.id)
                    setAvail(new Set())
                  }}
                  className="text-[11px] text-[#325099]/50 hover:text-red-500 transition"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Grid */}
            <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="w-20 px-4 py-3 text-left text-[10px] font-semibold text-[#325099]/50 uppercase tracking-wider border-b border-r border-[#DEE7FF]">
                      Time
                    </th>
                    {DAYS.map(day => (
                      <th key={day} className="px-3 py-3 text-center text-[10px] font-semibold text-[#325099]/70 uppercase tracking-wider border-b border-r border-[#DEE7FF] last:border-r-0">
                        {day.slice(0, 3)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ALL_SLOTS.map((slot, si) => (
                    <tr key={slot} className={si % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFF]'}>
                      <td className="px-4 py-2.5 text-xs font-semibold text-[#325099]/60 border-r border-b border-[#DEE7FF] whitespace-nowrap">
                        {fmtSlot(slot)}
                      </td>
                      {DAYS.map(day => {
                        const applicable = slotsFor(day).includes(slot)
                        const key  = `${day}|${slot}`
                        const on   = avail.has(key)
                        const busy = toggling.has(key)
                        if (!applicable) {
                          return (
                            <td key={day} className="px-2 py-2 text-center border-r border-b border-[#DEE7FF] last:border-r-0">
                              <div className="w-full h-8 rounded-lg bg-[#F3F4F6]" />
                            </td>
                          )
                        }
                        return (
                          <td key={day} className="px-2 py-2 text-center border-r border-b border-[#DEE7FF] last:border-r-0">
                            <button
                              onClick={() => toggle(day, slot)}
                              disabled={busy}
                              className={`w-full h-8 rounded-lg text-xs font-semibold transition-all duration-150 ${
                                on
                                  ? 'bg-[#062E63] text-white shadow-sm hover:bg-[#325099]'
                                  : 'bg-[#F0F4FF] text-[#325099]/40 hover:bg-[#DEE7FF] hover:text-[#325099]'
                              } ${busy ? 'opacity-50 cursor-wait' : ''}`}
                            >
                              {on ? '✓' : ''}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-[#325099]/40 mt-3 text-center">
              Mon – Fri: 4:00 pm – 8:00 pm · Sat: 10:00 am – 6:00 pm · 30-minute blocks
            </p>
          </>
        )}
      </div>
    </div>
  )
}
