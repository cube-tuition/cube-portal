'use client'
import { useState } from 'react'
import { supabase } from '../../lib/supabase'

/*
 * "Open ↗" for a workbook row on the Materials pages.
 *
 * A booklet only gains a booklet_builds row once someone starts building it, so
 * rows that had never been opened used to show a dead "no build" label — the one
 * place you could not get into the builder was the page you were already looking
 * at the workbook on. Every workbook is editable at any time, so this creates the
 * empty linked draft on first open instead, exactly as the Master Database does
 * (see openInBuilder in app/tutor/booklets/master/page.js).
 *
 * The new draft takes the booklet's name verbatim — including any "9.M." style
 * code — so the builder title matches the name in the database rather than a
 * shortened version of it.
 */
export default function OpenInBuilderButton({ booklet, buildId, year, subject, accent, onCreated }) {
  const [busy, setBusy] = useState(false)
  const cls = 'text-[11px] font-semibold shrink-0 hover:underline disabled:opacity-40'

  if (buildId) {
    return (
      <a href={`/tutor/booklets/builder/${buildId}`} target="_blank" rel="noopener noreferrer"
        className={cls} style={{ color: accent }}>Open ↗</a>
    )
  }

  const start = async () => {
    setBusy(true)
    const { data, error } = await supabase.from('booklet_builds').insert({
      title:      booklet.booklet_name,          // keep the name exactly as stored
      year:       booklet.year ?? year,
      subject:    booklet.subject ?? subject,
      topic:      booklet.topic || null,
      blocks:     [],
      status:     'draft',
      booklet_id: booklet.id,
    }).select('id').single()
    setBusy(false)
    if (error) { alert('Could not open this workbook in the builder: ' + error.message); return }
    onCreated?.(booklet.id, data.id)
    // New tab, like every other open-in-builder action — the insert is quick
    // enough that the click's user activation still covers window.open.
    window.open(`/tutor/booklets/builder/${data.id}`, '_blank', 'noopener')
  }

  return (
    <button onClick={start} disabled={busy} className={cls} style={{ color: accent }}
      title="No one has started building this workbook yet — this creates the draft and opens it">
      {busy ? 'Opening…' : 'Start ↗'}
    </button>
  )
}
