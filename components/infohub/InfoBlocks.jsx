'use client'
/*
 * InfoBlocks — read-only renderer for an Info Centre page (block array).
 * Used by the public viewer AND the editor's live preview, so they can never
 * drift. Lightweight: imports no editor code, so viewers don't load the editor.
 * Styling is fixed and on-brand; responsive (columns/table stack on mobile).
 */
import { qbankImageUrl } from '../../lib/qbank'
import { inlineHtml, inlineMultiline, videoEmbedUrl } from '../../lib/infohub/inline'
import { calloutVariant } from '../../lib/infohub/blocks'

const html = (s) => ({ dangerouslySetInnerHTML: { __html: s } })

function Para({ text }) {
  if (!text?.trim()) return null
  return <p className="ih-p" {...html(inlineMultiline(text))} />
}

function Heading({ level, text }) {
  const Tag = level === 3 ? 'h3' : 'h2'
  return <Tag className={level === 3 ? 'ih-h3' : 'ih-h2'} {...html(inlineHtml(text || ''))} />
}

function List({ items, ordered }) {
  const clean = (items || []).filter(i => (i ?? '').toString().trim() !== '')
  if (!clean.length) return null
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={ordered ? 'ih-ol' : 'ih-ul'}>
      {clean.map((it, i) => <li key={i} {...html(inlineHtml(it))} />)}
    </Tag>
  )
}

function Checklist({ items }) {
  const clean = (items || []).filter(i => (i?.text ?? '').trim() !== '')
  if (!clean.length) return null
  return (
    <ul className="ih-check" role="list">
      {clean.map((it, i) => (
        <li key={i} className="ih-check-item">
          <span className={`ih-check-box ${it.done ? 'is-done' : ''}`} aria-hidden="true">{it.done ? '✓' : ''}</span>
          <span className={it.done ? 'ih-check-done' : ''} {...html(inlineHtml(it.text))} />
        </li>
      ))}
    </ul>
  )
}

function Steps({ items }) {
  const clean = (items || []).filter(i => (i ?? '').trim() !== '')
  if (!clean.length) return null
  return (
    <ol className="ih-steps" role="list">
      {clean.map((it, i) => (
        <li key={i} className="ih-step">
          <span className="ih-step-num" aria-hidden="true">{i + 1}</span>
          <span className="ih-step-body" {...html(inlineHtml(it))} />
        </li>
      ))}
    </ol>
  )
}

function Callout({ variant, title, body }) {
  const v = calloutVariant(variant)
  return (
    <div className="ih-callout" style={{ background: v.bg, borderColor: v.border }} role="note">
      <div className="ih-callout-bar" style={{ background: v.accent }} />
      <div className="ih-callout-body">
        <div className="ih-callout-head" style={{ color: v.fg }}>
          <span aria-hidden="true" className="ih-callout-icon">{v.icon}</span>
          {title?.trim() ? <span className="ih-callout-title">{title}</span> : <span className="ih-callout-title">{v.label}</span>}
        </div>
        {body?.trim() && <div className="ih-callout-text" style={{ color: v.fg }} {...html(inlineMultiline(body))} />}
      </div>
    </div>
  )
}

function Deadline({ title, date, note }) {
  let label = date
  try { if (date) label = new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) } catch { /* keep raw */ }
  return (
    <div className="ih-deadline" role="note">
      <div className="ih-deadline-cal" aria-hidden="true">⏰</div>
      <div>
        {title?.trim() && <div className="ih-deadline-title">{title}</div>}
        {date && <div className="ih-deadline-date">{label}</div>}
        {note?.trim() && <div className="ih-deadline-note" {...html(inlineHtml(note))} />}
      </div>
    </div>
  )
}

function Quote({ text, cite }) {
  if (!text?.trim()) return null
  return (
    <blockquote className="ih-quote">
      <div {...html(inlineMultiline(text))} />
      {cite?.trim() && <cite className="ih-quote-cite">— {cite}</cite>}
    </blockquote>
  )
}

function ImageBlock({ path, alt, caption, align, width }) {
  if (!path) return null
  const url = qbankImageUrl(path)
  if (!url) return null
  const w = width === 'small' ? '260px' : width === 'medium' ? '440px' : '100%'
  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'
  return (
    <figure className="ih-figure" style={{ alignItems: justify }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt || ''} className="ih-img" style={{ maxWidth: w }} />
      {caption?.trim() && <figcaption className="ih-caption">{caption}</figcaption>}
    </figure>
  )
}

function VideoBlock({ url, caption }) {
  const embed = videoEmbedUrl(url)
  if (!embed) return null
  return (
    <figure className="ih-figure" style={{ alignItems: 'stretch' }}>
      <div className="ih-video"><iframe src={embed} title={caption || 'Video'} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div>
      {caption?.trim() && <figcaption className="ih-caption">{caption}</figcaption>}
    </figure>
  )
}

function ButtonBlock({ label, href, variant, external }) {
  if (!href) return null
  const ext = external || /^https?:/i.test(href)
  return (
    <div className="ih-btn-wrap">
      <a href={href} {...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className={`ih-btn ${variant === 'secondary' ? 'ih-btn-secondary' : 'ih-btn-primary'}`}>
        {label || 'Open'}{ext && <span aria-hidden="true" className="ih-btn-ext">↗</span>}
      </a>
    </div>
  )
}

function PortalLink({ label, href, desc }) {
  if (!href) return null
  const ext = /^https?:/i.test(href)
  return (
    <a href={href} {...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="ih-portal">
      <div className="ih-portal-icon" aria-hidden="true">↗</div>
      <div className="ih-portal-body">
        <div className="ih-portal-label">{label || href}</div>
        {desc?.trim() && <div className="ih-portal-desc">{desc}</div>}
      </div>
    </a>
  )
}

function Contact({ name, role, email, phone }) {
  if (!name && !email && !phone) return null
  return (
    <div className="ih-contact">
      <div className="ih-contact-avatar" aria-hidden="true">{(name || '?').slice(0, 1).toUpperCase()}</div>
      <div className="ih-contact-body">
        {name && <div className="ih-contact-name">{name}{role ? <span className="ih-contact-role"> · {role}</span> : null}</div>}
        <div className="ih-contact-rows">
          {email && <a className="ih-link" href={`mailto:${email}`}>{email}</a>}
          {phone && <a className="ih-link" href={`tel:${phone.replace(/\s+/g, '')}`}>{phone}</a>}
        </div>
      </div>
    </div>
  )
}

function Columns({ count, cols }) {
  const n = count === 3 ? 3 : 2
  const list = (cols || []).slice(0, n)
  return (
    <div className={`ih-cols ih-cols-${n}`}>
      {list.map((c, i) => <div key={i} className="ih-col" {...html(inlineMultiline(c || ''))} />)}
    </div>
  )
}

function Table({ headerRow, rows }) {
  const data = Array.isArray(rows) ? rows : []
  if (!data.length) return null
  const head = headerRow ? data[0] : null
  const body = headerRow ? data.slice(1) : data
  return (
    <div className="ih-tbl-wrap">
      <table className="ih-tbl">
        {head && <thead><tr>{head.map((c, i) => <th key={i} {...html(inlineHtml(c || ''))} />)}</tr></thead>}
        <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} {...html(inlineHtml(c || ''))} />)}</tr>)}</tbody>
      </table>
    </div>
  )
}

function Accordion({ items }) {
  const clean = (items || []).filter(i => (i.title || '').trim() || (i.body || '').trim())
  if (!clean.length) return null
  return (
    <div className="ih-acc">
      {clean.map((it, i) => (
        <details key={i} className="ih-acc-item">
          <summary className="ih-acc-summary">{it.title || 'Item'}</summary>
          <div className="ih-acc-body" {...html(inlineMultiline(it.body || ''))} />
        </details>
      ))}
    </div>
  )
}

function Faq({ items }) {
  const clean = (items || []).filter(i => (i.q || '').trim())
  if (!clean.length) return null
  return (
    <div className="ih-acc ih-faq">
      {clean.map((it, i) => (
        <details key={i} className="ih-acc-item">
          <summary className="ih-acc-summary"><span className="ih-faq-q" aria-hidden="true">Q</span>{it.q}</summary>
          <div className="ih-acc-body" {...html(inlineMultiline(it.a || ''))} />
        </details>
      ))}
    </div>
  )
}

function OneBlock({ b }) {
  switch (b.type) {
    case 'heading':    return <Heading level={b.level} text={b.text} />
    case 'paragraph':  return <Para text={b.text} />
    case 'quote':      return <Quote text={b.text} cite={b.cite} />
    case 'divider':    return <hr className="ih-hr" />
    case 'bulleted':   return <List items={b.items} />
    case 'numbered':   return <List items={b.items} ordered />
    case 'checklist':  return <Checklist items={b.items} />
    case 'steps':      return <Steps items={b.items} />
    case 'callout':    return <Callout variant={b.variant} title={b.title} body={b.body} />
    case 'deadline':   return <Deadline title={b.title} date={b.date} note={b.note} />
    case 'columns':    return <Columns count={b.count} cols={b.cols} />
    case 'table':      return <Table headerRow={b.headerRow} rows={b.rows} />
    case 'accordion':  return <Accordion items={b.items} />
    case 'image':      return <ImageBlock {...b} />
    case 'video':      return <VideoBlock url={b.url} caption={b.caption} />
    case 'button':     return <ButtonBlock {...b} />
    case 'portallink': return <PortalLink {...b} />
    case 'contact':    return <Contact {...b} />
    case 'faq':        return <Faq items={b.items} />
    default:           return null
  }
}

export default function InfoBlocks({ blocks }) {
  return (
    <div className="ih-root">
      <InfoBlocksStyle />
      {(blocks || []).map(b => <div key={b.id} className="ih-block"><OneBlock b={b} /></div>)}
    </div>
  )
}

// Scoped stylesheet (rendered once at the top of the root). Kept here so the
// renderer is self-contained and the viewer doesn't depend on globals.
function InfoBlocksStyle() {
  return <style>{IH_CSS}</style>
}

export const IH_CSS = `
.ih-root{ color:#2A2035; font-size:15.5px; line-height:1.7; }
.ih-block{ margin:0 0 18px; }
.ih-block:last-child{ margin-bottom:0; }
.ih-h2{ font-size:1.35rem; font-weight:700; color:#062E63; margin:26px 0 8px; line-height:1.3; }
.ih-h3{ font-size:1.08rem; font-weight:700; color:#325099; margin:20px 0 6px; }
.ih-block:first-child .ih-h2, .ih-block:first-child .ih-h3{ margin-top:0; }
.ih-p{ margin:0; }
.ih-ul, .ih-ol{ margin:0; padding-left:1.4em; }
.ih-ul{ list-style:disc; } .ih-ol{ list-style:decimal; }
.ih-ul li, .ih-ol li{ margin:5px 0; }
.ih-ul li::marker, .ih-ol li::marker{ color:#5b7bc4; }
.ih-link{ color:#325099; text-decoration:underline; text-underline-offset:2px; }
.ih-link:hover{ color:#062E63; }
.ih-code{ background:#EEF4FF; color:#325099; padding:.08em .35em; border-radius:5px; font-size:.9em; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
.ih-mark{ background:#FEF3C7; padding:.05em .2em; border-radius:3px; }
.ih-hr{ border:0; border-top:1px solid #E3E9F5; margin:8px 0; }
/* Checklist */
.ih-check{ list-style:none; margin:0; padding:0; }
.ih-check-item{ display:flex; gap:10px; align-items:flex-start; margin:7px 0; }
.ih-check-box{ flex:0 0 auto; width:18px; height:18px; margin-top:1px; border:1.5px solid #C7D5F8; border-radius:5px; display:inline-flex; align-items:center; justify-content:center; font-size:12px; color:#fff; }
.ih-check-box.is-done{ background:#15803D; border-color:#15803D; }
.ih-check-done{ color:#2A2035; opacity:.55; text-decoration:line-through; }
/* Steps */
.ih-steps{ list-style:none; margin:0; padding:0; }
.ih-step{ display:flex; gap:12px; align-items:flex-start; margin:0 0 12px; }
.ih-step-num{ flex:0 0 auto; width:26px; height:26px; border-radius:50%; background:#062E63; color:#fff; font-size:13px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; }
.ih-step-body{ padding-top:2px; }
/* Callout */
.ih-callout{ display:flex; border:1px solid; border-radius:12px; overflow:hidden; }
.ih-callout-bar{ flex:0 0 4px; }
.ih-callout-body{ padding:13px 16px; }
.ih-callout-head{ display:flex; align-items:center; gap:8px; font-weight:700; }
.ih-callout-icon{ font-size:15px; }
.ih-callout-text{ margin-top:5px; opacity:.92; }
/* Deadline */
.ih-deadline{ display:flex; gap:14px; align-items:center; background:#FFF7ED; border:1px solid #FDE2B8; border-radius:12px; padding:14px 16px; }
.ih-deadline-cal{ font-size:22px; }
.ih-deadline-title{ font-weight:700; color:#92400E; }
.ih-deadline-date{ font-weight:700; color:#062E63; font-size:1.05rem; }
.ih-deadline-note{ color:#92400E; opacity:.85; font-size:.92em; margin-top:2px; }
/* Quote */
.ih-quote{ border-left:3px solid #C7D5F8; padding:4px 0 4px 16px; margin:0; color:#3A3550; font-style:italic; }
.ih-quote-cite{ display:block; margin-top:6px; font-size:.85em; color:#325099; font-style:normal; font-weight:600; }
/* Figure / image / video */
.ih-figure{ display:flex; flex-direction:column; margin:0; }
.ih-img{ border-radius:12px; border:1px solid #E3E9F5; }
.ih-caption{ font-size:.85em; color:#6B7280; margin-top:6px; text-align:center; }
.ih-video{ position:relative; width:100%; padding-top:56.25%; border-radius:12px; overflow:hidden; border:1px solid #E3E9F5; }
.ih-video iframe{ position:absolute; inset:0; width:100%; height:100%; border:0; }
/* Button */
.ih-btn-wrap{ }
.ih-btn{ display:inline-flex; align-items:center; gap:7px; font-weight:600; font-size:14px; padding:9px 18px; border-radius:999px; text-decoration:none; transition:background .15s,border-color .15s; }
.ih-btn-primary{ background:#325099; color:#fff; } .ih-btn-primary:hover{ background:#062E63; }
.ih-btn-secondary{ background:#EEF4FF; color:#325099; border:1px solid #C7D5F8; } .ih-btn-secondary:hover{ background:#DEE7FF; }
.ih-btn-ext{ font-size:12px; opacity:.8; }
/* Portal link */
.ih-portal{ display:flex; align-items:center; gap:12px; border:1px solid #DEE7FF; background:#F8FAFF; border-radius:12px; padding:12px 14px; text-decoration:none; transition:border-color .15s,background .15s; }
.ih-portal:hover{ border-color:#BACBFF; background:#fff; }
.ih-portal-icon{ flex:0 0 auto; width:34px; height:34px; border-radius:9px; background:#DEE7FF; color:#325099; font-weight:700; display:inline-flex; align-items:center; justify-content:center; }
.ih-portal-label{ font-weight:700; color:#062E63; }
.ih-portal-desc{ font-size:.88em; color:#6B7280; }
/* Contact */
.ih-contact{ display:flex; gap:12px; align-items:center; border:1px solid #DEE7FF; border-radius:12px; padding:12px 14px; background:#fff; }
.ih-contact-avatar{ flex:0 0 auto; width:40px; height:40px; border-radius:50%; background:#062E63; color:#fff; font-weight:700; display:inline-flex; align-items:center; justify-content:center; }
.ih-contact-name{ font-weight:700; color:#062E63; }
.ih-contact-role{ font-weight:500; color:#6B7280; }
.ih-contact-rows{ display:flex; flex-wrap:wrap; gap:4px 16px; font-size:.9em; margin-top:2px; }
/* Columns */
.ih-cols{ display:grid; gap:18px; }
@media(min-width:768px){ .ih-cols-2{ grid-template-columns:1fr 1fr; } .ih-cols-3{ grid-template-columns:1fr 1fr 1fr; } }
.ih-col{ min-width:0; }
/* Table */
.ih-tbl-wrap{ overflow-x:auto; border:1px solid #E3E9F5; border-radius:12px; }
.ih-tbl{ width:100%; border-collapse:collapse; font-size:14px; }
.ih-tbl th, .ih-tbl td{ border:1px solid #E8EDF8; padding:9px 12px; text-align:left; vertical-align:top; }
.ih-tbl th{ background:#F8FAFF; color:#062E63; font-weight:700; }
.ih-tbl tr:nth-child(even) td{ background:#FCFDFF; }
/* Accordion / FAQ */
.ih-acc{ border:1px solid #E3E9F5; border-radius:12px; overflow:hidden; }
.ih-acc-item{ border-bottom:1px solid #E3E9F5; }
.ih-acc-item:last-child{ border-bottom:0; }
.ih-acc-summary{ cursor:pointer; padding:12px 16px; font-weight:600; color:#062E63; list-style:none; display:flex; align-items:center; gap:10px; }
.ih-acc-summary::-webkit-details-marker{ display:none; }
.ih-acc-summary::after{ content:'＋'; margin-left:auto; color:#5b7bc4; font-weight:700; }
.ih-acc-item[open] .ih-acc-summary::after{ content:'−'; }
.ih-acc-summary:hover{ background:#F8FAFF; }
.ih-acc-body{ padding:0 16px 14px; color:#2A2035; }
.ih-faq-q{ flex:0 0 auto; width:20px; height:20px; border-radius:6px; background:#DEE7FF; color:#325099; font-size:12px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; }
`
