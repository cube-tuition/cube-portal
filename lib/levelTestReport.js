/*
 * Level-test parent feedback report → branded one-page A4 PDF.
 * Built as an off-screen HTML node, rasterised with html-to-image → jsPDF
 * (same approach as the worksheet/booklet exporters).
 *
 *   exportLevelTestReport(args, { preview, base64 })
 *     default        → saves the PDF
 *     preview:true   → returns { url, filename }
 *     base64:true    → returns { base64, filename } (for emailing via Resend)
 */

const PAGE_W = 794
const PAGE_H = 1123
const INK = '#2A2035'
const NAVY = '#062E63'
const ACCENT = '#325099'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const band = (p) => {
  if (p == null) return { color: '#9CA3AF', bg: '#F3F4F6', label: '—' }
  if (p >= 80) return { color: '#059669', bg: '#D1FAE5', label: 'Strong' }
  if (p >= 60) return { color: '#D97706', bg: '#FEF3C7', label: 'Solid' }
  return { color: '#DC2626', bg: '#FEE2E2', label: 'Needs focus' }
}
const fmtDate = (s) => { if (!s) return ''; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) }

// Section header in the end-of-term report style: a short accent bar + tracked, uppercase label.
const sectionHead = (label) =>
  `<div style="display:flex;align-items:center;gap:9px;margin:0 0 14px">
     <span style="width:4px;height:17px;border-radius:3px;background:${ACCENT}"></span>
     <span style="font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${ACCENT}">${esc(label)}</span>
   </div>`

// StatBox in the end-of-term report style.
const statBox = (label, value, sub, valueColor = INK) =>
  `<div style="flex:1;border:1px solid #DEE7FF;background:#F8FAFF;border-radius:12px;padding:13px 16px">
     <div style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:${ACCENT};font-weight:600;margin-bottom:5px">${esc(label)}</div>
     <div style="font-size:23px;font-weight:700;color:${valueColor};line-height:1">${value}</div>
     <div style="font-size:10px;color:rgba(42,32,53,0.55);margin-top:5px">${esc(sub)}</div>
   </div>`

// One test's block: title, headline stats, topic bars, and a summary.
function testBlock(test) {
  const { title, rows = [], overall = {}, sections = [], strengths = [], weaknesses = [] } = test
  const ov = band(overall.pct)

  const topicRows = rows.map((r) => {
    const b = band(r.studentPct)
    const w = Math.max(0, Math.min(100, r.studentPct ?? 0))
    return `<div style="margin:0 0 15px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <span style="font-size:14px;font-weight:600;color:${INK}">${esc(r.topic)}</span>
        <span style="white-space:nowrap">
          ${r.studentMax ? `<span style="font-size:12px;color:rgba(42,32,53,0.45);margin-right:8px">${r.studentAwarded}/${r.studentMax}</span>` : ''}
          <span style="font-size:14px;font-weight:700;color:${b.color}">${r.studentPct == null ? '–' : r.studentPct + '%'}</span>
          <span style="font-size:11px;font-weight:600;padding:1px 8px;border-radius:9px;margin-left:8px;background:${b.bg};color:${b.color}">${b.label}</span>
        </span>
      </div>
      <div style="height:12px;border-radius:6px;background:#EEF2F7;overflow:hidden">
        <div style="height:12px;border-radius:6px;width:${w}%;background:${b.color}"></div>
      </div>
    </div>`
  }).join('')

  return `<section style="margin-bottom:30px;break-inside:avoid">
    ${sectionHead(title || 'Level test')}
    <div style="display:flex;gap:12px;margin-bottom:20px">
      ${statBox('Overall result', overall.pct == null ? '—' : `${overall.pct}%`, `${overall.awarded ?? 0} of ${overall.max ?? 0} marks`, ov.color)}
      ${statBox('Performance', ov.label, 'across all topics', ov.color)}
      ${statBox('Topics assessed', String(rows.length), rows.length === 1 ? 'topic' : 'topics')}
    </div>
    <div style="margin-bottom:18px">
      ${topicRows || '<p style="font-size:13px;color:rgba(42,32,53,0.4);font-style:italic">No marks recorded yet.</p>'}
    </div>
    <div style="display:flex;gap:16px">
      <div style="flex:1;border:1px solid #D1FAE5;background:#ECFDF5;border-radius:12px;padding:13px 16px">
        <div style="font-size:11px;font-weight:700;color:#047857;margin-bottom:3px">Doing well in</div>
        <div style="font-size:13px;color:#065F46;line-height:1.5">${strengths.length ? esc(strengths.join(', ')) : 'Solid effort across the test.'}</div>
      </div>
      <div style="flex:1;border:1px solid #FECACA;background:#FEF2F2;border-radius:12px;padding:13px 16px">
        <div style="font-size:11px;font-weight:700;color:#B91C1C;margin-bottom:3px">Areas to focus on</div>
        <div style="font-size:13px;color:#991B1B;line-height:1.5">${weaknesses.length ? esc(weaknesses.join(', ')) : 'No major gaps — keep it up.'}</div>
      </div>
    </div>
  </section>`
}

function reportHtml(args) {
  const { student, lesson, teacherName } = args
  // Accept either a tests[] array (multi) or a single-test shape (back-compat).
  const tests = Array.isArray(args.tests) && args.tests.length
    ? args.tests
    : [{ title: args.build?.title || 'Level Test', rows: args.rows, overall: args.overall, sections: args.sections, strengths: args.strengths, weaknesses: args.weaknesses }]
  const dateStr = fmtDate(lesson?.lesson_date)
  const headLabel = tests.length === 1 ? (tests[0].title || 'Level Test') : `${tests.length} level tests`

  return `<div style="position:relative;width:${PAGE_W}px;min-height:${PAGE_H}px;box-sizing:border-box;padding:52px 58px 70px;background:#fff;font-family:'Avenir Next','Avenir','Segoe UI',system-ui,Helvetica,Arial,sans-serif;color:${INK}">
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:1px solid #DEE7FF;padding-bottom:18px;margin-bottom:26px">
      <div style="min-width:0">
        <div style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;font-weight:600;color:${ACCENT}">Level test report${dateStr ? ` · ${esc(dateStr)}` : ''}</div>
        <div style="font-size:28px;font-weight:700;color:${INK};line-height:1.1;margin-top:7px">${esc(student?.full_name || 'Student')}</div>
        <div style="font-size:12px;color:rgba(42,32,53,0.6);margin-top:3px">${student?.year ? `Year ${esc(student.year)}` : ''}</div>
      </div>
      <div style="text-align:right;flex:0 0 auto">
        <div style="font-size:14px;font-weight:600;color:${INK}">${esc(headLabel)}</div>
        <div style="font-size:11px;color:rgba(42,32,53,0.5);margin-top:2px">CUBE Tuition · Chatswood</div>
      </div>
    </div>

    ${tests.map(testBlock).join('')}

    <!-- Footer -->
    <div style="position:absolute;left:58px;right:58px;bottom:34px;padding-top:14px;border-top:1px solid #DEE7FF;font-size:10px;color:rgba(42,32,53,0.5);display:flex;justify-content:space-between">
      <span>CUBE Tuition · Chatswood${teacherName ? ` · Prepared by ${esc(teacherName)}` : ''}</span>
      <span>Level test report${dateStr ? ` · ${esc(dateStr)}` : ''}</span>
    </div>
  </div>`
}

export async function exportLevelTestReport(args, { preview = false, base64 = false } = {}) {
  const htmlToImage = await import('html-to-image')
  const { jsPDF } = await import('jspdf')

  const stage = document.createElement('div')
  stage.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1'
  stage.innerHTML = reportHtml(args)
  document.body.appendChild(stage)
  const node = stage.firstElementChild

  const safeName = (args.student?.full_name || 'student').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '')
  const filename = `level-test-report-${safeName || 'student'}.pdf`

  try {
    const capH = Math.max(PAGE_H, node.scrollHeight)
    const dataUrl = await htmlToImage.toJpeg(node, { quality: 0.95, width: PAGE_W, height: capH, backgroundColor: '#ffffff', pixelRatio: 2 })
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
    const pdfW = pdf.internal.pageSize.getWidth()
    const pdfH = pdf.internal.pageSize.getHeight()
    const fullH = pdfW * (capH / PAGE_W)
    if (fullH <= pdfH + 0.5) {
      pdf.addImage(dataUrl, 'JPEG', 0, 0, pdfW, fullH)
    } else {
      let y = 0, first = true
      while (y < fullH - 0.5) { if (!first) pdf.addPage(); pdf.addImage(dataUrl, 'JPEG', 0, -y, pdfW, fullH); y += pdfH; first = false }
    }
    if (base64) return { base64: pdf.output('datauristring').split(',')[1], filename }
    if (preview) return { url: URL.createObjectURL(pdf.output('blob')), filename }
    pdf.save(filename)
    return { filename }
  } finally {
    document.body.removeChild(stage)
  }
}
