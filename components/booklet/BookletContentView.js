'use client'
import { parseBookletContent } from '../../lib/bookletContent'

/*
 * Renders a booklet's "content" summary text with section headers in bold and
 * the syllabus dotpoints grouped beneath each (• main, — subdotpoint).
 */
export default function BookletContentView({ text }) {
  const rows = parseBookletContent(text)
  if (!rows.length) {
    return <p className="text-sm text-[#2A2035]/40 text-center py-8">No content listed for this booklet yet.</p>
  }
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        r.kind === 'header'
          ? <p key={i} className="text-sm font-bold text-[#062E63] mt-3 first:mt-0">{r.text}</p>
          : (
            <div key={i} className={`flex gap-2 text-sm text-[#2A2035] ${r.kind === 'sub' ? 'pl-8' : 'pl-2'}`}>
              <span className="shrink-0">{r.kind === 'sub' ? '—' : '•'}</span>
              <span>{r.text}</span>
            </div>
          )
      ))}
    </div>
  )
}
