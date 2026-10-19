'use client'
import { useLayoutEffect, useRef } from 'react'

/*
 * The email's own text, open for editing in the composer — each part (subject,
 * greeting, intro, …) in the order it reads, pre-filled with the template
 * wording. Write a personal line straight into the part it belongs in; the
 * preview beside it is what sends. Reset puts the template back.
 *
 *   fields   [{ key, label }]   in email order (each box fits its text)
 *   values   { key: text }            the current wording (template + edits)
 *   onChange (key, text)
 *   onReset  ()                       omit to hide the Reset link
 *   hint     the placeholders that fill in automatically
 */
function GrowingText({ value, onChange }) {
  const ref = useRef(null)
  // Grow with the text so nothing hides behind a scrollbar — and re-measure
  // when the width changes (the modal lays out after the first measure).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    let width = 0
    const fit = () => {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight + 2}px`
    }
    fit()
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      if (w !== width) { width = w; fit() }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      rows={1}
      className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs leading-relaxed text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] resize-none overflow-hidden"
    />
  )
}

export default function EmailWording({ fields, values, onChange, onReset, hint }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <p className="text-[11px] font-bold tracking-widest uppercase text-[#325099]">Email</p>
        {onReset && (
          <button onClick={onReset} className="text-[11px] font-semibold text-[#325099] hover:underline">Reset to template</button>
        )}
      </div>
      <p className="text-[10px] text-[#2A2035]/45 mb-2.5">
        The template text — edit any part, or add a personal line where it fits. {hint ? `${hint} ` : ''}**bold** works.
      </p>
      <div className="space-y-2.5">
        {fields.map(f => (
          <div key={f.key}>
            <label className="block text-[10px] font-semibold text-[#325099]/60 mb-0.5">{f.label}</label>
            <GrowingText value={values[f.key]} onChange={(v) => onChange(f.key, v)} />
          </div>
        ))}
      </div>
    </div>
  )
}
