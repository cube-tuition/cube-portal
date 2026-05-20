export default function PortalHero({
  tagline,
  heading,
  description,
  align = 'left',
  children,
}) {
  return (
    <section
      className="bg-gradient-to-r from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF] px-6 md:px-10 py-12 md:py-16 border-b border-[#DEE7FF]"
    >
      <div
        className={`max-w-7xl mx-auto ${
          align === 'center' ? 'text-center' : ''
        }`}
      >
        {tagline && (
          <p
            className="text-[11px] tracking-[0.35em] uppercase text-[#325099] font-semibold mb-3 font-display"
          >
            {tagline}
          </p>
        )}
        <h1
          className="text-3xl md:text-[2.6rem] font-bold leading-tight tracking-tight text-[#2A2035] mb-3 font-display"
        >
          {heading}
        </h1>
        {description && (
          <p className="text-sm md:text-base text-[#2A2035]/70 max-w-2xl leading-relaxed">
            {description}
          </p>
        )}
        {children && <div className="mt-6">{children}</div>}
      </div>
    </section>
  )
}
