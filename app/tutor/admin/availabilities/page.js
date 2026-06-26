'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getAuthProfile } from '../../../../lib/getProfile'
import TutorNav from '../../../../components/TutorNav'

const WEEKDAYS      = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const DAYS          = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAY_SLOTS = ['16:00','16:30','17:00','17:30','18:00','18:30','19:00','19:30']
const SAT_SLOTS     = ['10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30',
                       '14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30']

const CHIP_COLORS = [
  { bg: '#EEF4FF', text: '#325099', border: '#C7D5F8' },
  { bg: '#FDF4FF', text: '#7C3AED', border: '#DDD6FE' },
  { bg: '#ECFDF5', text: '#065F46', border: '#A7F3D0' },
  { bg: '#FFF7ED', text: '#92400E', border: '#FDE68A' },
  { bg: '#FEF2F2', text: '#991B1B', border: '#FCA5A5' },
  { bg: '#F0FDFA', text: '#134E4A', border: '#99F6E4' },
  { bg: '#FFF1F2', text: '#9F1239', border: '#FDA4AF' },
  { bg: '#FFFBEB', text: '#78350F', border: '#FCD34D' },
]

function fmtSlot(t) {
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')}${period}`
}

function initials(name) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
}

// ── Edit modal ────────────────────────────────────────────────────────────────
function EditModal({ day, slot, tutors, avail, onClose, onToggle }) {
  const key       = `${day}|${slot}`
  const presentIds = avail[key] || []

  return (
    <div
      className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-[#DEE7FF] p-6 w-80 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-[10px] font-bold tracking-widest text-[#325099]/50 uppercase mb-0.5">{day}</p>
            <p className="text-2xl font-bold text-[#062E63]">{fmtSlot(slot)}</p>
            <p className="text-xs text-[#325099]/50 mt-0.5">
              {presentIds.length} / {tutors.length} tutors available
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#325099]/30 hover:text-[#325099] text-xl leading-none mt-1"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2">
          {tutors.map((t, i) => {
            const col  = CHIP_COLORS[i % CHIP_COLORS.length]
            const isOn = presentIds.includes(t.id)
            return (
              <button
                key={t.id}
                onClick={() => onToggle(day, slot, t.id, isOn)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left"
                style={{
                  background  : isOn ? col.bg  : 'white',
                  borderColor : isOn ? col.border : '#E8EDF8',
                }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                  style={{ background: col.bg, color: col.text, border: `1.5px solid ${col.border}` }}
                >
                  {initials(t.full_name)}
                </div>
                <span className="text-sm font-semibold text-[#062E63] flex-1">{t.full_name}</span>
                <span className={`text-[10px] font-bold flex-shrink-0 ${isOn ? 'text-emerald-600' : 'text-[#325099]/25'}`}>
                  {isOn ? '✓ Available' : '—'}
                </span>
              </button>
            )
          })}
        </div>

        <p className="text-[10px] text-[#325099]/40 mt-4 text-center">
          Click a tutor to toggle their availability
        </p>
      </div>
    </div>
  )
}

// ── Individual cell ───────────────────────────────────────────────────────────
function AvailCell({ day, slot, tutors, avail, filter, colorOf, onClick }) {
  const key    = `${day}|${slot}`
  const allIds = avail[key] || []
  const ids    = filter ? allIds.filter(id => id === filter) : allIds
  const heat   = ids.length / Math.max(1, tutors.length)

  const shown = ids.slice(0, 4)
  const extra = ids.length - shown.length
  const tooltip = allIds
    .map(id => tutors.find(t => t.id === id)?.full_name ?? id)
    .join(', ')

  if (ids.length === 0) {
    return (
      <td className="px-2 py-1.5 border-r border-b border-[#DEE7FF] last:border-r-0 min-w-[100px]">
        <button
          onClick={onClick}
          className="w-full h-9 rounded-xl bg-[#F8FAFF] hover:bg-[#EEF4FF] border border-transparent hover:border-[#C7D5F8] transition-all"
          title="Click to edit"
        />
      </td>
    )
  }

  return (
    <td className="px-2 py-1.5 border-r border-b border-[#DEE7FF] last:border-r-0 min-w-[100px]">
      <button
        onClick={onClick}
        title={tooltip}
        className="w-full h-9 rounded-xl flex items-center justify-center hover:brightness-95 transition-all"
        style={{ background: `rgba(6,46,99,${0.05 + heat * 0.1})` }}
      >
        <div className="flex -space-x-1.5">
          {shown.map(id => {
            const col  = colorOf(id)
            const name = tutors.find(t => t.id === id)?.full_name ?? '?'
            return (
              <div
                key={id}
                className="w-6 h-6 rounded-full border-[1.5px] border-white flex items-center justify-center text-[9px] font-bold"
                style={{ background: col.bg, color: col.text }}
              >
                {initials(name)}
              </div>
            )
          })}
          {extra > 0 && (
            <div className="w-6 h-6 rounded-full border-[1.5px] border-white bg-[#DEE7FF] flex items-center justify-center text-[9px] font-bold text-[#325099]">
              +{extra}
            </div>
          )}
        </div>
      </button>
    </td>
  )
}

// ── Schedule table ─────────────────────────────────────────────────────────────
function ScheduleTable({ days, slots, tutors, avail, filter, colorOf, onCellClick }) {
  const countAt = (day, slot) => {
    const ids = avail[`${day}|${slot}`] || []
    return filter ? ids.filter(id => id === filter).length : ids.length
  }

  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="w-20 px-4 py-3 text-left text-[10px] font-semibold text-[#325099]/50 uppercase tracking-wider border-b border-r border-[#DEE7FF] bg-[#F8FAFF]">
              Time
            </th>
            {days.map(day => {
              const total = slots.reduce((sum, s) => sum + countAt(day, s), 0)
              return (
                <th
                  key={day}
                  className="px-3 py-3 text-center border-b border-r border-[#DEE7FF] last:border-r-0 bg-[#F8FAFF]"
                >
                  <p className="text-[10px] font-bold text-[#325099]/70 uppercase tracking-wider">
                    {day.slice(0, 3)}
                  </p>
                  <p className="text-[10px] font-semibold text-[#325099]/35 mt-0.5">
                    {total > 0 ? `${total} slot${total !== 1 ? 's' : ''}` : '—'}
                  </p>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot, si) => (
            <tr key={slot} className={si % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFF]'}>
              <td className="px-4 py-1.5 text-xs font-semibold text-[#325099]/60 border-r border-b border-[#DEE7FF] whitespace-nowrap">
                {fmtSlot(slot)}
              </td>
              {days.map(day => (
                <AvailCell
                  key={day}
                  day={day}
                  slot={slot}
                  tutors={tutors}
                  avail={avail}
                  filter={filter}
                  colorOf={colorOf}
                  onClick={() => onCellClick(day, slot)}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Tutor card (by-tutor view) ─────────────────────────────────────────────────
function TutorCard({ tutor, color, avail, onCellClick }) {
  const mySlots = Object.entries(avail)
    .filter(([, ids]) => ids.includes(tutor.id))
    .map(([key]) => {
      const [day, slot] = key.split('|')
      return { day, slot }
    })

  const byDay = {}
  for (const { day, slot } of mySlots) {
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(slot)
  }

  return (
    <div className="bg-white rounded-2xl border border-[#DEE7FF] p-5 hover:border-[#C7D5F8] transition-colors">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
          style={{ background: color.bg, color: color.text, border: `1.5px solid ${color.border}` }}
        >
          {initials(tutor.full_name)}
        </div>
        <div>
          <p className="font-bold text-[#062E63] text-sm leading-tight">{tutor.full_name}</p>
          <p className="text-xs text-[#325099]/50 mt-0.5">
            {mySlots.length === 0 ? 'No availability set' : `${mySlots.length} slot${mySlots.length !== 1 ? 's' : ''} available`}
          </p>
        </div>
      </div>

      {mySlots.length === 0 ? (
        <p className="text-[11px] text-[#325099]/30 italic">
          Tutor hasn&apos;t set their availability yet.
        </p>
      ) : (
        <div className="space-y-2.5">
          {DAYS.filter(d => byDay[d]).map(day => (
            <div key={day} className="flex items-start gap-2.5">
              <span className="text-[10px] font-bold text-[#325099]/40 uppercase tracking-wider w-7 mt-0.5 flex-shrink-0">
                {day.slice(0, 3)}
              </span>
              <div className="flex flex-wrap gap-1">
                {byDay[day].sort().map(slot => (
                  <button
                    key={slot}
                    onClick={() => onCellClick(day, slot)}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full border transition hover:opacity-75"
                    style={{ background: color.bg, color: color.text, borderColor: color.border }}
                  >
                    {fmtSlot(slot)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function AllAvailabilitiesPage() {
  const router = useRouter()
  const [profile,  setProfile]  = useState(null)
  const [tutors,   setTutors]   = useState([])
  const [avail,    setAvail]    = useState({})   // { "day|slot": [tutorId, ...] }
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState('')
  const [view,     setView]     = useState('grid')  // 'grid' | 'tutor'
  const [editCell, setEditCell] = useState(null)    // { day, slot } | null

  useEffect(() => {
    getAuthProfile().then(({ profile, role }) => {
      if (!profile || (role !== 'admin' && role !== 'director')) {
        router.replace('/tutor'); return
      }
      setProfile(profile)
    })
  }, [router])

  useEffect(() => {
    if (!profile) return
    ;(async () => {
      setLoading(true)
      const [{ data: tutorRows }, { data: availRows }] = await Promise.all([
        supabase.from('tutors').select('id, full_name').eq('active', true).order('full_name'),
        supabase.from('teacher_availability').select('tutor_id, day_of_week, slot_time'),
      ])
      setTutors(tutorRows || [])
      const map = {}
      for (const r of availRows || []) {
        const key = `${r.day_of_week}|${r.slot_time}`
        if (!map[key]) map[key] = []
        map[key].push(r.tutor_id)
      }
      setAvail(map)
      setLoading(false)
    })()
  }, [profile])

  const colorOf = (tutorId) => {
    const idx = tutors.findIndex(t => t.id === tutorId)
    return CHIP_COLORS[idx % CHIP_COLORS.length] ?? CHIP_COLORS[0]
  }

  const handleToggle = async (day, slot, tutorId, isCurrentlyOn) => {
    const key = `${day}|${slot}`
    // Optimistic update
    setAvail(prev => {
      const next = { ...prev }
      if (isCurrentlyOn) {
        next[key] = (next[key] || []).filter(id => id !== tutorId)
        if (!next[key].length) delete next[key]
      } else {
        next[key] = [...(next[key] || []), tutorId]
      }
      return next
    })
    // Persist
    if (isCurrentlyOn) {
      await supabase.from('teacher_availability')
        .delete()
        .eq('tutor_id', tutorId)
        .eq('day_of_week', day)
        .eq('slot_time', slot)
    } else {
      await supabase.from('teacher_availability')
        .insert({ tutor_id: tutorId, day_of_week: day, slot_time: slot })
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />

      {editCell && (
        <EditModal
          day={editCell.day}
          slot={editCell.slot}
          tutors={tutors}
          avail={avail}
          onClose={() => setEditCell(null)}
          onToggle={handleToggle}
        />
      )}

      <div className="max-w-6xl mx-auto px-6 pt-10 pb-24">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#062E63]">Teacher Availabilities</h1>
            <p className="text-sm text-[#325099]/60 mt-1">
              Weekly recurring availability across all tutors.
            </p>
          </div>
          {/* View toggle */}
          <div className="flex items-center gap-1 bg-[#EEF4FF] p-1 rounded-xl">
            {[['grid', 'Grid'], ['tutor', 'By Tutor']].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition ${
                  view === v
                    ? 'bg-white text-[#062E63] shadow-sm'
                    : 'text-[#325099]/60 hover:text-[#325099]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Filter chips — grid view only */}
            {view === 'grid' && (
              <div className="flex flex-wrap items-center gap-2 mb-5">
                <button
                  onClick={() => setFilter('')}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                    filter === ''
                      ? 'bg-[#062E63] text-white border-[#062E63]'
                      : 'bg-white text-[#325099]/60 border-[#DEE7FF] hover:border-[#325099]/40'
                  }`}
                >
                  All tutors
                </button>
                {tutors.map((t, i) => {
                  const col    = CHIP_COLORS[i % CHIP_COLORS.length]
                  const active = filter === t.id
                  return (
                    <button
                      key={t.id}
                      onClick={() => setFilter(f => f === t.id ? '' : t.id)}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                        active ? 'ring-2 ring-offset-1' : 'hover:opacity-80'
                      }`}
                      style={{ background: col.bg, color: col.text, borderColor: col.border }}
                    >
                      {t.full_name.split(' ')[0]}
                    </button>
                  )
                })}
              </div>
            )}

            {view === 'grid' ? (
              <div className="space-y-6">
                {/* Weekdays */}
                <div>
                  <p className="text-[11px] font-bold text-[#325099]/40 uppercase tracking-widest mb-2 px-1">
                    Weekdays · 4:00 pm – 8:00 pm
                  </p>
                  <ScheduleTable
                    days={WEEKDAYS}
                    slots={WEEKDAY_SLOTS}
                    tutors={tutors}
                    avail={avail}
                    filter={filter}
                    colorOf={colorOf}
                    onCellClick={(day, slot) => setEditCell({ day, slot })}
                  />
                </div>

                {/* Saturday */}
                <div>
                  <p className="text-[11px] font-bold text-[#325099]/40 uppercase tracking-widest mb-2 px-1">
                    Saturday · 10:00 am – 6:00 pm
                  </p>
                  <ScheduleTable
                    days={['Saturday']}
                    slots={SAT_SLOTS}
                    tutors={tutors}
                    avail={avail}
                    filter={filter}
                    colorOf={colorOf}
                    onCellClick={(day, slot) => setEditCell({ day, slot })}
                  />
                </div>
              </div>
            ) : (
              /* By Tutor view */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {tutors.map((t, i) => (
                  <TutorCard
                    key={t.id}
                    tutor={t}
                    color={CHIP_COLORS[i % CHIP_COLORS.length]}
                    avail={avail}
                    onCellClick={(day, slot) => setEditCell({ day, slot })}
                  />
                ))}
              </div>
            )}

            {Object.keys(avail).length === 0 && (
              <p className="text-center text-sm text-[#325099]/40 mt-6">
                No availability set yet — tutors can update theirs from the Availability page.
              </p>
            )}

            <p className="text-[11px] text-[#325099]/40 mt-4 text-center">
              Click any slot to view or edit tutor availability · Changes save instantly
            </p>
          </>
        )}
      </div>
    </div>
  )
}
