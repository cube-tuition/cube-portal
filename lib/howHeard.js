/*
 * "How heard" — acquisition channel tracking.
 *
 * One canonical channel list, used by:
 *   • the public free-trial form on cubetuition.com.au (kept in sync manually —
 *     see cube-website/app/free-trial-form/page.tsx)
 *   • the portal trial-submission API
 *   • the Trials page (badge, per-card editor, channel insights report)
 *   • lib/tableMeta.js (explorer dropdown + data-quality off-list check)
 */

export const HOW_HEARD_CHANNELS = [
  'Referral (friend / family)',
  'Google Search',
  'Google Maps',
  'Social media',
  'School word of mouth',
  'Flyer / local advertising',
  'Walked past',
  'Returning family',
  'Other',
]

// Badge colours per channel (portal UI)
export const HOW_HEARD_COLORS = {
  'Referral (friend / family)': 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Google Search':              'bg-blue-100 text-blue-800 border-blue-200',
  'Google Maps':                'bg-sky-100 text-sky-800 border-sky-200',
  'Social media':               'bg-purple-100 text-purple-800 border-purple-200',
  'School word of mouth':       'bg-amber-100 text-amber-800 border-amber-200',
  'Flyer / local advertising':  'bg-pink-100 text-pink-800 border-pink-200',
  'Walked past':                'bg-teal-100 text-teal-800 border-teal-200',
  'Returning family':           'bg-indigo-100 text-indigo-800 border-indigo-200',
  'Other':                      'bg-gray-100 text-gray-600 border-gray-200',
}
export const HOW_HEARD_UNKNOWN_COLOR = 'bg-gray-50 text-gray-400 border-gray-200'

/**
 * Aggregate trial submissions into per-channel stats.
 * Returns rows sorted by enquiry count:
 *   [{ channel, enquiries, converted, rate }]
 * Unset/legacy values group under 'Not recorded'.
 */
export function channelStats(submissions) {
  const map = {}
  for (const s of submissions || []) {
    const channel = s.how_heard && HOW_HEARD_CHANNELS.includes(s.how_heard)
      ? s.how_heard
      : (s.how_heard ? 'Other' : 'Not recorded')
    if (!map[channel]) map[channel] = { channel, enquiries: 0, converted: 0 }
    map[channel].enquiries++
    if (s.status === 'enrolled' || s.converted_student_id) map[channel].converted++
  }
  return Object.values(map)
    .map(r => ({ ...r, rate: r.enquiries ? Math.round((r.converted / r.enquiries) * 100) : 0 }))
    .sort((a, b) => b.enquiries - a.enquiries)
}
