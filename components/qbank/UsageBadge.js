'use client'

/*
 * UsageBadge — shows whether a bank question has been used.
 * `usage` is an entry from fetchQuestionUsage(): { exams, worksheets, count, lastUsed }.
 *   default        → a small "Used ×N" chip (nothing when unused)
 *   details        → chip + where/when lines (and a faint "Not yet used" when unused)
 */
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

export default function UsageBadge({ usage, details = false }) {
  const count = usage?.count || 0

  if (!count) {
    return details ? <span className="text-[11px] text-[#2A2035]/30 italic">Not yet used</span> : null
  }

  const chip = (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E] whitespace-nowrap" title="Used in a worksheet or exam">
      Used ×{count}
    </span>
  )
  if (!details) return chip

  const where = [
    ...usage.exams.map((e) => `Exam: ${e.title || 'Untitled exam'}`),
    ...usage.worksheets.map((w) => `Worksheet${w.title ? `: ${w.title}` : ''}`),
  ]
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">{chip}<span className="text-[11px] text-[#2A2035]/50">last used {fmt(usage.lastUsed)}</span></div>
      <ul className="text-[11px] text-[#2A2035]/50 list-disc pl-4">
        {where.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}
        {where.length > 4 && <li>+{where.length - 4} more</li>}
      </ul>
    </div>
  )
}
