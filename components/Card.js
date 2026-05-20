/**
 * Soft card matching the marketing site language:
 * white bg, light blue border, rounded-2xl. Optional uppercase eyebrow + title.
 */
export default function Card({
  eyebrow,
  title,
  trailing,
  children,
  padding = 'p-6',
  className = '',
}) {
  const hasHeader = eyebrow || title || trailing
  return (
    <div
      className={`bg-white rounded-2xl border border-[#DEE7FF] ${className}`}
    >
      {hasHeader && (
        <div className="px-6 pt-6 pb-3 flex items-start justify-between gap-4">
          <div>
            {eyebrow && (
              <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-1.5 font-display">
                {eyebrow}
              </p>
            )}
            {title && (
              <h3 className="text-base md:text-lg font-semibold text-[#2A2035] font-display">
                {title}
              </h3>
            )}
          </div>
          {trailing && <div>{trailing}</div>}
        </div>
      )}
      <div className={hasHeader ? `px-6 pb-6 pt-1` : padding}>{children}</div>
    </div>
  )
}
