'use client'
import { useEffect, useState } from 'react'

/*
 * How a trial moves through the pipeline — the flow the team works to, drawn
 * on the Trials page. Two rows: before the trial (with or without a level
 * test first) and the trial itself, through to Convert / Drop.
 *
 * Each step says where it happens; ⚡ marks the emails that send themselves
 * (lib/autoReminders, 24 hours before). Collapsible, remembered per browser.
 */

const W = 150, H = 46
const KIND = {
  start:  { fill: '#FFF7E6', stroke: '#D9A43B', text: '#7A5410' },
  email:  { fill: '#EEF3FF', stroke: '#325099', text: '#062E63' },
  lesson: { fill: '#F4EFFF', stroke: '#7C5CC4', text: '#3F2A7A' },
  end:    { fill: '#E9F8F1', stroke: '#2F9E6E', text: '#14563A' },
}

function Node({ x, y, kind, lines, caption, dashed = false, auto = false, w = W }) {
  const k = KIND[kind]
  return (
    <g>
      <rect x={x} y={y} width={w} height={H} rx={10} fill={k.fill} stroke={k.stroke} strokeWidth={1.4}
        strokeDasharray={dashed ? '5 4' : undefined} />
      {lines.map((t, i) => (
        <text key={i} x={x + w / 2} y={y + H / 2 + (i - (lines.length - 1) / 2) * 14 + 4}
          textAnchor="middle" fontSize={12} fontWeight={i === 0 ? 600 : 400} fill={k.text}>{t}</text>
      ))}
      {/* sent automatically */}
      {auto && (
        <g>
          <circle cx={x + w - 2} cy={y + 2} r={10} fill="#FDE68A" stroke="#D97706" strokeWidth={1.2} />
          <text x={x + w - 2} y={y + 6} textAnchor="middle" fontSize={11}>⚡</text>
        </g>
      )}
      {caption && (
        <text x={x + w / 2} y={y + H + 14} textAnchor="middle" fontSize={10} fill="#325099" opacity={0.65}>{caption}</text>
      )}
    </g>
  )
}

// A line with an arrowhead, through any number of points.
function Arrow({ points, label, labelAt }) {
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')
  return (
    <g>
      <path d={d} fill="none" stroke="#9AAAD0" strokeWidth={1.5} markerEnd="url(#pf-arrow)" />
      {label && <text x={labelAt[0]} y={labelAt[1]} fontSize={11} fontWeight={700} fill="#325099">{label}</text>}
    </g>
  )
}

const STORE = 'cube_trials_flow_open'

// collapsible: false — always open, no toggle (the Info Centre page shows it in full).
export default function PipelineFlow({ collapsible = true }) {
  const [stored, setOpen] = useState(true)
  const open = !collapsible || stored
  // The remembered choice lives in the browser; read it after mount.
  useEffect(() => {
    const t = setTimeout(() => {
      try { const v = localStorage.getItem(STORE); if (v != null) setOpen(v === '1') } catch { /* private mode */ }
    }, 0)
    return () => clearTimeout(t)
  }, [])
  const toggle = () => setOpen(o => {
    try { localStorage.setItem(STORE, o ? '0' : '1') } catch { /* private mode */ }
    return !o
  })

  // Row 1 (before the trial) and row 2 (the trial), vertical centres.
  // "No" runs straight along the middle line to the invitation; the trial row
  // sits close under it.
  const yes = 22, mid = 96, row2 = 200
  const mid2 = mid + H / 2, yes2 = yes + H / 2
  const dx = 210, dy = mid2           // decision diamond centre
  const r2 = [35, 215, 395, 575, 755, 935]

  return (
    <div className={`ih-wide bg-white border border-[#DEE7FF] rounded-xl overflow-hidden ${collapsible ? 'mb-6' : ''}`}>
      {collapsible ? (
        <button onClick={toggle} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#F8FAFF] transition">
          <span className="text-sm font-semibold text-[#062E63]">How a trial moves</span>
          <span className="text-[#325099]/40 text-sm">{open ? '▲' : '▼'}</span>
        </button>
      ) : null}
      {open && (
        <div className={`${collapsible ? 'border-t border-[#DEE7FF] ' : ''}px-4 pt-3 pb-4`}>
          <div className="overflow-x-auto">
            <svg viewBox="0 0 1120 268" className="w-full min-w-[700px]" role="img"
              aria-label="Trial pipeline: new trial, optional level test, trial invitation, trial lesson reminder, two trial lessons with feedback, trial outcome, then convert or drop">
              <defs>
                <marker id="pf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" fill="#9AAAD0" />
                </marker>
              </defs>

              {/* Before the trial */}
              <text x={0} y={12} fontSize={10} fontWeight={700} letterSpacing={1} fill="#325099" opacity={0.5}>BEFORE THE TRIAL</text>
              <Node x={20} y={mid} kind="start" lines={['New trial']} caption="Stage: New" w={120} />
              <Arrow points={[[140, mid2], [dx - 52, dy]]} />
              {/* decision */}
              <polygon points={`${dx},${dy - 34} ${dx + 52},${dy} ${dx},${dy + 34} ${dx - 52},${dy}`} fill="#FFFFFF" stroke="#062E63" strokeWidth={1.4} />
              <text x={dx} y={dy + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="#062E63">Level test?</text>

              {/* Yes: level test first */}
              <Arrow points={[[dx, dy - 34], [dx, yes2], [300, yes2]]} label="Yes" labelAt={[dx + 6, yes2 + 30]} />
              <Node x={300} y={yes} kind="email" lines={['Level test invitation']} caption="Trial card · → Contacted" />
              <Arrow points={[[450, yes2], [480, yes2]]} />
              <Node x={480} y={yes} kind="email" lines={['Level test reminder']} caption="Automatic · 24h before the test" auto />
              <Arrow points={[[630, yes2], [660, yes2]]} />
              <Node x={660} y={yes} kind="lesson" lines={['Level test results', '+ trial invitation']} caption="Monitoring → Level tests · one email" />
              <Arrow points={[[810, yes2], [915, yes2], [915, mid - 2]]} />

              {/* No: straight to the invitation */}
              <Arrow points={[[dx + 52, dy], [838, mid2]]} label="No" labelAt={[dx + 62, dy - 7]} />

              <Node x={840} y={mid} kind="email" lines={['Trial invitation']} caption="Family picks a class → books itself" />

              {/* The trial */}
              <text x={0} y={row2 - 22} fontSize={10} fontWeight={700} letterSpacing={1} fill="#325099" opacity={0.5}>THE TRIAL <tspan fontWeight={400} letterSpacing={0}>— the family’s pick (or assigning a class) moves the card to Trial scheduled</tspan></text>
              <Arrow points={[[990, mid2], [1060, mid2], [1060, row2 - 14], [r2[0] + W / 2, row2 - 14], [r2[0] + W / 2, row2 - 2]]} />
              <Node x={r2[0]} y={row2} kind="email" lines={['Trial lesson reminder']} caption="Automatic · 24h before lesson 1" auto />
              <Arrow points={[[r2[0] + W, row2 + H / 2], [r2[1], row2 + H / 2]]} />
              <Node x={r2[1]} y={row2} kind="lesson" lines={['Trial lesson 1', '1/2']} caption="→ Trial 1/2 completed" />
              <Arrow points={[[r2[1] + W, row2 + H / 2], [r2[2], row2 + H / 2]]} />
              <Node x={r2[2]} y={row2} kind="email" lines={['Lesson 1 feedback']} caption="Trial card" />
              <Arrow points={[[r2[2] + W, row2 + H / 2], [r2[3], row2 + H / 2]]} />
              <Node x={r2[3]} y={row2} kind="lesson" lines={['Trial lesson 2', '2/2']} caption="⚡ Reminder · → Trial 2/2 completed" />
              <Arrow points={[[r2[3] + W, row2 + H / 2], [r2[4], row2 + H / 2]]} />
              <Node x={r2[4]} y={row2} kind="email" lines={['Trial outcome']} caption="Trial card" />
              <Arrow points={[[r2[4] + W, row2 + H / 2], [r2[5], row2 + H / 2]]} />
              <Node x={r2[5]} y={row2} kind="end" lines={['Convert / Drop']} caption="→ Enrolled / Declined" />
            </svg>
          </div>
          <div className="flex items-center gap-4 flex-wrap mt-2 text-[10px] text-[#325099]/70">
            {[['email', 'Email to the family'], ['lesson', 'Lesson or test'], ['end', 'Decision']].map(([k, label]) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded" style={{ background: KIND[k].fill, border: `1.4px solid ${KIND[k].stroke}` }} />{label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-[#FDE68A] border border-[#D97706] text-[9px] leading-none flex items-center justify-center">⚡</span>Sent automatically
            </span>
            <span className="ml-auto">Any time: <strong>On hold</strong> when the family pauses — from the opened card, which reopens it too.</span>
          </div>
        </div>
      )}
    </div>
  )
}
