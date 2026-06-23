/*
 * Info Centre — block model. A page is a JSON array of blocks { id, type, ...props }.
 * This registry defines the available block types, their default props, and the
 * palette grouping. The renderer (InfoBlocks) and editor (PageEditor) both read
 * from here so they can never drift. Styling is constrained (predefined callout
 * variants, button styles, column counts) — admins choose a variant, not raw CSS.
 */

let _seq = 0
const uid = () => `b_${Date.now().toString(36)}_${(_seq++).toString(36)}`

// Callout variants — the single source of styling for callout / warning / tip /
// important boxes. Colours come from the CUBE palette + standard semantic hues.
export const CALLOUT_VARIANTS = [
  { id: 'info',    label: 'Information', icon: 'ℹ️', accent: '#325099', bg: '#EEF4FF', border: '#C7D5F8', fg: '#062E63' },
  { id: 'tip',     label: 'Tip',         icon: '💡', accent: '#0E7490', bg: '#ECFEFF', border: '#A5E5EE', fg: '#155E69' },
  { id: 'success', label: 'Success',     icon: '✅', accent: '#15803D', bg: '#F0FDF4', border: '#A7F3D0', fg: '#166534' },
  { id: 'warning', label: 'Warning',     icon: '⚠️', accent: '#B45309', bg: '#FFF7ED', border: '#FDE2B8', fg: '#92400E' },
  { id: 'urgent',  label: 'Urgent',      icon: '🚨', accent: '#B91C1C', bg: '#FEF2F2', border: '#FCA5A5', fg: '#991B1B' },
]
export const calloutVariant = (id) => CALLOUT_VARIANTS.find(v => v.id === id) || CALLOUT_VARIANTS[0]

export const BUTTON_VARIANTS = [
  { id: 'primary',   label: 'Primary' },
  { id: 'secondary', label: 'Secondary' },
]

export const IMAGE_WIDTHS = [
  { id: 'small',  label: 'Small'  },
  { id: 'medium', label: 'Medium' },
  { id: 'full',   label: 'Full width' },
]
export const ALIGNMENTS = [
  { id: 'left',   label: 'Left'   },
  { id: 'center', label: 'Centre' },
  { id: 'right',  label: 'Right'  },
]

// Palette — grouped for the add-block menu.
export const BLOCK_GROUPS = ['Text', 'Lists', 'Callouts', 'Layout', 'Media & embeds', 'Info']

export const BLOCK_TYPES = [
  { type: 'heading',    label: 'Heading',        icon: 'H',  group: 'Text' },
  { type: 'paragraph',  label: 'Paragraph',      icon: '¶',  group: 'Text' },
  { type: 'quote',      label: 'Quote',          icon: '❝',  group: 'Text' },
  { type: 'divider',    label: 'Divider',        icon: '―',  group: 'Text' },

  { type: 'bulleted',   label: 'Bulleted list',  icon: '•',  group: 'Lists' },
  { type: 'numbered',   label: 'Numbered list',  icon: '1.', group: 'Lists' },
  { type: 'checklist',  label: 'Checklist',      icon: '☑',  group: 'Lists' },
  { type: 'steps',      label: 'Step-by-step',   icon: '⟶',  group: 'Lists' },

  { type: 'callout',    label: 'Callout box',    icon: '◈',  group: 'Callouts' },
  { type: 'deadline',   label: 'Date / deadline', icon: '⏰', group: 'Callouts' },

  { type: 'columns',    label: 'Columns',        icon: '▥',  group: 'Layout' },
  { type: 'table',      label: 'Table',          icon: '▦',  group: 'Layout' },
  { type: 'accordion',  label: 'Accordion',      icon: '⊟',  group: 'Layout' },

  { type: 'image',      label: 'Image',          icon: '🖼', group: 'Media & embeds' },
  { type: 'video',      label: 'Video embed',    icon: '▶',  group: 'Media & embeds' },
  { type: 'button',     label: 'Button / link',  icon: '⬚',  group: 'Media & embeds' },

  { type: 'portallink', label: 'Portal link',    icon: '↗',  group: 'Info' },
  { type: 'contact',    label: 'Contact info',   icon: '👤', group: 'Info' },
  { type: 'faq',        label: 'FAQ',            icon: '❓', group: 'Info' },
]

export const blockLabel = (type) => BLOCK_TYPES.find(b => b.type === type)?.label || type
export const blockIcon  = (type) => BLOCK_TYPES.find(b => b.type === type)?.icon || '▢'

export function newBlock(type) {
  const base = { id: uid(), type }
  switch (type) {
    case 'heading':    return { ...base, level: 2, text: '' }
    case 'paragraph':  return { ...base, text: '' }
    case 'quote':      return { ...base, text: '', cite: '' }
    case 'divider':    return { ...base }
    case 'bulleted':   return { ...base, items: [''] }
    case 'numbered':   return { ...base, items: [''] }
    case 'checklist':  return { ...base, items: [{ text: '', done: false }] }
    case 'steps':      return { ...base, items: [''] }
    case 'callout':    return { ...base, variant: 'info', title: '', body: '' }
    case 'deadline':   return { ...base, title: '', date: '', note: '' }
    case 'columns':    return { ...base, count: 2, cols: ['', ''] }
    case 'table':      return { ...base, headerRow: true, rows: [['Column 1', 'Column 2'], ['', '']] }
    case 'accordion':  return { ...base, items: [{ title: '', body: '' }] }
    case 'image':      return { ...base, path: '', alt: '', caption: '', align: 'center', width: 'full' }
    case 'video':      return { ...base, url: '', caption: '' }
    case 'button':     return { ...base, label: 'Open', href: '', variant: 'primary', external: false }
    case 'portallink': return { ...base, label: '', href: '/tutor', desc: '' }
    case 'contact':    return { ...base, name: '', role: '', email: '', phone: '' }
    case 'faq':        return { ...base, items: [{ q: '', a: '' }] }
    default:           return base
  }
}

// Deep-ish clone with a fresh id (used by "Duplicate block").
export function duplicateBlock(b) {
  return { ...JSON.parse(JSON.stringify(b)), id: uid() }
}

// Plain-text content of a block (for search indexing + word counts).
export function blockText(b) {
  switch (b.type) {
    case 'heading': case 'paragraph': return b.text || ''
    case 'quote':   return `${b.text || ''} ${b.cite || ''}`
    case 'bulleted': case 'numbered': case 'steps': return (b.items || []).join(' ')
    case 'checklist': return (b.items || []).map(i => i.text).join(' ')
    case 'callout': return `${b.title || ''} ${b.body || ''}`
    case 'deadline': return `${b.title || ''} ${b.note || ''}`
    case 'columns': return (b.cols || []).join(' ')
    case 'table':   return (b.rows || []).flat().join(' ')
    case 'accordion': case 'faq': return (b.items || []).map(i => `${i.title || i.q || ''} ${i.body || i.a || ''}`).join(' ')
    case 'image': case 'video': return b.caption || ''
    case 'button': case 'portallink': return `${b.label || ''} ${b.desc || ''}`
    case 'contact': return `${b.name || ''} ${b.role || ''} ${b.email || ''}`
    default: return ''
  }
}

export function pageWordCount(blocks) {
  const text = (blocks || []).map(blockText).join(' ').trim()
  return text ? text.split(/\s+/).length : 0
}
