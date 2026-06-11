'use client'
import LatexContent from './LatexContent'

/*
 * LatexField — a labelled textarea with a live KaTeX preview underneath.
 * Used for every LaTeX input in the question editor (stem, solution, parts).
 */
export default function LatexField({
  label, value, onChange, placeholder, rows = 4, hint,
}) {
  return (
    <div>
      {label && (
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-semibold text-[#062E63]">{label}</label>
          {hint && <span className="text-[10px] text-[#2A2035]/40">{hint}</span>}
        </div>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full border border-[#DEE7FF] rounded-xl px-3 py-2 text-sm font-mono text-[#2A2035] focus:outline-none focus:border-[#325099] bg-white resize-y"
      />
      <div className="mt-1.5 rounded-xl border border-dashed border-[#DEE7FF] bg-[#F8FAFF] px-3 py-2 min-h-[2.25rem]">
        <span className="text-[10px] uppercase tracking-wide text-[#2A2035]/30 mr-2">Preview</span>
        {value?.trim()
          ? <LatexContent text={value} className="text-sm text-[#2A2035]" />
          : <span className="text-xs text-[#2A2035]/30 italic">…</span>}
      </div>
    </div>
  )
}
