/*
 * One colour per teacher, shared by the timetable planner and the classes
 * page's "View by time" day view, so a teacher is the same colour in both.
 *
 * A teacher's colour comes from their position in the palette list: active
 * tutors by name, then directors by name — the order the planner loads staff.
 */

// Ordered for maximum hue separation among the first ~10 entries so adjacent
// teachers never look alike (e.g. Amber=blue vs Ryan=lime).
export const CHIP_COLORS = [
  { bg: '#E8F0FE', text: '#1D4ED8', border: '#BCD3FB' },  // blue
  { bg: '#FFF1E8', text: '#C2410C', border: '#FED0B4' },  // orange
  { bg: '#E7FBEF', text: '#047857', border: '#A7F3D0' },  // green
  { bg: '#F6EEFF', text: '#7C3AED', border: '#DDD0FB' },  // purple
  { bg: '#FEECEC', text: '#DC2626', border: '#FBC4C4' },  // red
  { bg: '#E6FAFC', text: '#0E7490', border: '#A8ECF5' },  // teal
  { bg: '#FDEBF4', text: '#BE185D', border: '#FAC4DE' },  // pink
  { bg: '#FCF6E3', text: '#A16207', border: '#F4E2A6' },  // amber/gold
  { bg: '#F1FADF', text: '#4D7C0F', border: '#D6EFA0' },  // lime
  { bg: '#EAEBFD', text: '#4338CA', border: '#C9CAF8' },  // indigo
  { bg: '#FFEEF0', text: '#9F1239', border: '#FCC4CD' },  // rose
  { bg: '#E6F5FE', text: '#0369A1', border: '#B6E1FB' },  // sky
]
export const GREY_CHIP = { bg: '#F1F3F7', text: '#5B6477', border: '#D4D9E3' }
// Fixed colour overrides for specific staff (by lower-cased full name).
export const COLOR_OVERRIDES = {
  'ryan park': { bg: '#CBD9F7', text: '#1E40AF', border: '#A9C0EF' },  // pastel cornflower blue
  'kevin park': { bg: '#BCE5CB', text: '#066B45', border: '#92D3AC' },  // slightly darker pastel green
}

// The palette list: active tutors, then directors — each as fetched with
// .order('full_name'), so the order (and every colour) matches the planner's.
export function paletteStaff(tutors = [], directors = []) {
  return [...tutors.filter(t => t.active !== false), ...directors]
}

export function teacherColour(id, palette = []) {
  if (!id) return GREY_CHIP
  const idx = palette.findIndex(t => t.id === id)
  if (idx < 0) return GREY_CHIP
  const override = COLOR_OVERRIDES[(palette[idx].full_name || '').trim().toLowerCase()]
  return override || CHIP_COLORS[idx % CHIP_COLORS.length]
}
