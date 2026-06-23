import { newBlock } from './blocks'

// A template = a suggested, fully-editable block structure. mk() builds a block
// of `type` with overridden props (and a fresh id from newBlock).
const mk = (type, props = {}) => ({ ...newBlock(type), ...props })

export const TEMPLATES = [
  {
    id: 'blank', name: 'Blank page', icon: '📄', desc: 'Start from scratch.',
    title: 'Untitled page',
    blocks: () => [mk('heading', { level: 2, text: 'Section title' }), mk('paragraph', { text: '' })],
  },
  {
    id: 'general', name: 'General information', icon: '📋', desc: 'Overview + key points.',
    title: 'General information',
    blocks: () => [
      mk('heading', { level: 2, text: 'Overview' }),
      mk('paragraph', { text: 'A short introduction to this page.' }),
      mk('callout', { variant: 'info', title: 'Key point', body: 'Highlight the most important thing here.' }),
      mk('heading', { level: 3, text: 'Details' }),
      mk('bulleted', { items: ['First point', 'Second point', 'Third point'] }),
    ],
  },
  {
    id: 'expectations', name: 'Staff expectations', icon: '🧭', desc: 'Standards + do/don’t.',
    title: 'Staff expectations',
    blocks: () => [
      mk('heading', { level: 2, text: 'Our expectations' }),
      mk('paragraph', { text: 'What we expect from every staff member.' }),
      mk('checklist', { items: [{ text: 'Arrive 10 minutes before class', done: false }, { text: 'Save attendance every session', done: false }, { text: 'Communicate absences early', done: false }] }),
      mk('callout', { variant: 'warning', title: 'Please note', body: 'Repeated breaches are followed up by the director.' }),
    ],
  },
  {
    id: 'lesson', name: 'Lesson procedure', icon: '📐', desc: 'Step-by-step run sheet.',
    title: 'Lesson procedure',
    blocks: () => [
      mk('heading', { level: 2, text: 'Before the lesson' }),
      mk('steps', { items: ['Open the class on the portal', 'Print or open the workbook', 'Set up the room'] }),
      mk('heading', { level: 2, text: 'During the lesson' }),
      mk('steps', { items: ['Mark attendance', 'Run the revision quiz', 'Teach the content', 'Set homework'] }),
      mk('heading', { level: 2, text: 'After the lesson' }),
      mk('steps', { items: ['Save the session', 'Note anything to follow up'] }),
    ],
  },
  {
    id: 'assessment', name: 'Assessment procedure', icon: '📝', desc: 'Marking + reporting.',
    title: 'Assessment procedure',
    blocks: () => [
      mk('heading', { level: 2, text: 'Marking' }),
      mk('numbered', { items: ['Collect scripts', 'Mark against the rubric', 'Enter marks in the portal'] }),
      mk('callout', { variant: 'tip', title: 'Tip', body: 'Use the per-question marking grid for consistency.' }),
      mk('heading', { level: 2, text: 'Reporting' }),
      mk('paragraph', { text: 'How results feed into the end-of-term report.' }),
    ],
  },
  {
    id: 'emergency', name: 'Emergency procedure', icon: '🚨', desc: 'What to do in an emergency.',
    title: 'Emergency procedure',
    blocks: () => [
      mk('callout', { variant: 'urgent', title: 'In an emergency', body: 'Stay calm. Ensure student safety first, then follow the steps below.' }),
      mk('heading', { level: 2, text: 'Steps' }),
      mk('steps', { items: ['Ensure everyone is safe', 'Call the relevant service', 'Notify the director', 'Record what happened'] }),
      mk('heading', { level: 2, text: 'Key contacts' }),
      mk('contact', { name: 'Director', role: 'On call', phone: '' }),
    ],
  },
  {
    id: 'portalguide', name: 'Portal guide', icon: '🧩', desc: 'How to use a feature.',
    title: 'Portal guide',
    blocks: () => [
      mk('heading', { level: 2, text: 'What this is for' }),
      mk('paragraph', { text: 'A short description of the feature.' }),
      mk('heading', { level: 2, text: 'How to use it' }),
      mk('steps', { items: ['Open the page', 'Do the thing', 'Save'] }),
      mk('portallink', { label: 'Open the feature', href: '/tutor', desc: 'Jump straight there' }),
    ],
  },
  {
    id: 'faq', name: 'Frequently asked questions', icon: '❓', desc: 'Q&A list.',
    title: 'Frequently asked questions',
    blocks: () => [
      mk('heading', { level: 2, text: 'FAQ' }),
      mk('faq', { items: [{ q: 'First question?', a: 'The answer.' }, { q: 'Second question?', a: 'The answer.' }] }),
    ],
  },
  {
    id: 'announcement', name: 'Weekly announcement', icon: '📣', desc: 'Short timely notice.',
    title: 'Weekly announcement',
    blocks: () => [
      mk('callout', { variant: 'info', title: 'This week', body: 'The headline for the week.' }),
      mk('bulleted', { items: ['Reminder one', 'Reminder two'] }),
      mk('deadline', { title: 'Due', date: '', note: 'Anything with a deadline.' }),
    ],
  },
  {
    id: 'policy', name: 'Policy page', icon: '🛡️', desc: 'Formal policy.',
    title: 'Policy',
    blocks: () => [
      mk('heading', { level: 2, text: 'Purpose' }),
      mk('paragraph', { text: 'Why this policy exists.' }),
      mk('heading', { level: 2, text: 'Scope' }),
      mk('paragraph', { text: 'Who and what this applies to.' }),
      mk('heading', { level: 2, text: 'Policy' }),
      mk('numbered', { items: ['First clause', 'Second clause'] }),
    ],
  },
]

export const templateById = (id) => TEMPLATES.find(t => t.id === id) || TEMPLATES[0]
