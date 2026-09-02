/*
 * Weekly timetable → landscape A4 PDF, for printing or sending around.
 * Off-screen HTML grid (same visual language as the timetable page: day
 * columns against an hour ruler, tutor-coloured cards, overlap lanes),
 * rasterised with the shared nodeToJpeg → jsPDF. The caller chooses which
 * classes are in — the grid only shows days and hours that selection uses.
 *
 * rows: [{ id, name, day, s, e, room, teacher, color: { bg, text, border } }]
 *   s/e are minutes from midnight; day is the full weekday name.
 */

import { nodeToJpeg } from './rasterise'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const PAGE_W = 1123   // landscape A4 @ 96dpi
const PAGE_H = 794
const PAD = 26
const TITLE_H = 46
const DAYHEAD_H = 26
const GUTTER_W = 44

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtTime = (mins) => {
  const h = Math.floor(mins / 60), m = mins % 60
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${period}`
}

// Same greedy lane layout as the timetable page, so overlaps read identically.
function layout(rows) {
  const evs = [...rows].sort((a, b) => a.s - b.s || a.e - b.e)
  const laneEnds = []
  evs.forEach(ev => {
    let lane = laneEnds.findIndex(end => end <= ev.s)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(ev.e) } else laneEnds[lane] = ev.e
    ev._lane = lane
  })
  let curEnd = -1, cluster = []
  const flush = () => { const n = cluster.length ? Math.max(...cluster.map(x => x._lane)) + 1 : 1; cluster.forEach(x => { x._lanes = n }); cluster = [] }
  evs.forEach(ev => { if (cluster.length && ev.s >= curEnd) { flush(); curEnd = -1 } cluster.push(ev); curEnd = Math.max(curEnd, ev.e) })
  flush()
  return evs
}

// The grid html alone — exported so a test can render and eyeball it.
export function timetableHtml({ rows, termLabel }) {

  const days = DAYS.filter(d => rows.some(r => r.day === d))
  const startHour = Math.floor(Math.min(...rows.map(r => r.s)) / 60)
  const endHour = Math.ceil(Math.max(...rows.map(r => r.e)) / 60)
  const hours = []
  for (let h = startHour; h <= endHour; h++) hours.push(h)

  const gridH = PAGE_H - PAD * 2 - TITLE_H - DAYHEAD_H
  const hourPx = gridH / (endHour - startHour)
  const colW = (PAGE_W - PAD * 2 - GUTTER_W) / days.length

  const dayCol = (day, di) => {
    const evs = layout(rows.filter(r => r.day === day))
    const cards = evs.map(ev => {
      const top = ((ev.s - startHour * 60) / 60) * hourPx
      const h = Math.max(24, ((ev.e - ev.s) / 60) * hourPx - 2)
      const laneW = (colW - 4) / (ev._lanes || 1)
      const c = ev.color || { bg: '#F1F3F7', text: '#5B6477', border: '#D4D9E3' }
      const roomy = h >= 46
      return `<div style="position:absolute;top:${top}px;left:${2 + (ev._lane || 0) * laneW}px;width:${laneW - 2}px;height:${h}px;
          background:${c.bg};border:1.2px solid ${c.border};border-radius:6px;padding:3px 5px;overflow:hidden;box-sizing:border-box">
        <div style="font-size:10px;font-weight:700;color:${c.text};line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ev.name)}</div>
        <div style="font-size:8.5px;color:${c.text};opacity:.85;white-space:nowrap;overflow:hidden">${fmtTime(ev.s)}–${fmtTime(ev.e)}</div>
        ${roomy && (ev.teacher || ev.room) ? `<div style="font-size:8.5px;color:${c.text};opacity:.75;white-space:nowrap;overflow:hidden">${esc([ev.teacher, ev.room].filter(Boolean).join(' · '))}</div>` : ''}
      </div>`
    }).join('')
    const lines = hours.map((h, i) => i > 0
      ? `<div style="position:absolute;left:0;right:0;top:${i * hourPx}px;border-top:1px solid #EEF2FB"></div>` : '').join('')
    return `<div style="position:absolute;left:${GUTTER_W + di * colW}px;top:${DAYHEAD_H}px;width:${colW}px;height:${gridH}px;border-left:1px solid #E4EAF6">${lines}${cards}</div>
      <div style="position:absolute;left:${GUTTER_W + di * colW}px;top:0;width:${colW}px;height:${DAYHEAD_H}px;display:flex;align-items:center;justify-content:center;
        font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#325099;border-left:1px solid #E4EAF6;background:#F8FAFF;border-bottom:1px solid #DEE7FF">${day.slice(0, 3)}</div>`
  }

  const ruler = hours.map((h, i) => i > 0
    ? `<div style="position:absolute;left:0;width:${GUTTER_W - 8}px;text-align:right;top:${DAYHEAD_H + i * hourPx - 5}px;font-size:8.5px;font-weight:600;color:rgba(50,80,153,.55)">${fmtTime(h * 60)}</div>` : '').join('')

  const html = `<div style="width:${PAGE_W}px;height:${PAGE_H}px;box-sizing:border-box;padding:${PAD}px;background:#fff;
      font-family:'Avenir Next','Avenir','Segoe UI',system-ui,Helvetica,Arial,sans-serif">
    <div style="height:${TITLE_H}px;display:flex;align-items:baseline;justify-content:space-between">
      <div>
        <span style="font-size:19px;font-weight:700;color:#062E63">CUBE Tuition</span>
        <span style="font-size:12px;color:rgba(42,32,53,.55);margin-left:10px">Timetable${termLabel ? ` · ${esc(termLabel)}` : ''}</span>
      </div>
      <span style="font-size:10px;color:rgba(42,32,53,.4)">${rows.length} class${rows.length === 1 ? '' : 'es'}</span>
    </div>
    <div style="position:relative;height:${DAYHEAD_H + gridH}px">
      ${ruler}
      ${days.map(dayCol).join('')}
    </div>
  </div>`
  return html
}

export async function downloadTimetablePdf({ rows, termLabel, filename = 'timetable.pdf' }) {
  if (!rows.length) throw new Error('No classes selected')
  const { jsPDF } = await import('jspdf')
  const html = timetableHtml({ rows, termLabel })

  const stage = document.createElement('div')
  stage.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1'
  stage.innerHTML = html
  document.body.appendChild(stage)
  try {
    const dataUrl = await nodeToJpeg(stage.firstElementChild, {
      quality: 0.95, width: PAGE_W, height: PAGE_H, backgroundColor: '#ffffff', pixelRatio: 2,
    })
    const pdf = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' })
    pdf.addImage(dataUrl, 'JPEG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight())
    pdf.save(filename)
  } finally {
    document.body.removeChild(stage)
  }
}
