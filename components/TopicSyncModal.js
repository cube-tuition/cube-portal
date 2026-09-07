'use client'
/*
 * The confirmation shown before a topic is added, renamed or deleted.
 *
 * The Master Database and the Question Bank share one topic list held in two
 * tables (see lib/topicSync.js), so an edit made on either screen lands on the
 * other. That is easy to forget while you are looking at only one of them —
 * hence this: it names the other side, and counts what is attached, before
 * anything is written.
 *
 * Deleting a topic KEEPS everything filed under it — questions and workbooks are
 * untagged, not removed — so the modal says what will be left needing a new
 * topic and lets the delete through. Nothing is refused.
 */
const LABEL = { master: 'Master Database', qbank: 'Question Bank' }

export default function TopicSyncModal({ action, from, year, subject, name, newName, impact, busy, error, onConfirm, onCancel }) {
  if (!action || !impact) return null
  const other = from === 'master' ? 'qbank' : 'master'
  const otherHas = other === 'master' ? !!impact.master : !!impact.qbank
  const where = `Year ${year} ${subject}`

  // Removed with the topic: the taxonomy under it. Questions are kept, so they
  // are reported separately rather than listed among the casualties.
  const bits = []
  if (impact.subtopics) bits.push(`${impact.subtopics} subtopic${impact.subtopics === 1 ? '' : 's'}`)
  if (impact.skills)    bits.push(`${impact.skills} skill${impact.skills === 1 ? '' : 's'}`)
  const nQ = impact.questions || 0
  const nB = impact.booklets || 0
  // What a delete leaves behind, needing a new topic.
  const kept = []
  if (nQ) kept.push(`${nQ} question${nQ === 1 ? '' : 's'}`)
  if (nB) kept.push(`${nB} workbook${nB === 1 ? '' : 's'}`)
  const carried = []
  if (impact.subtopics) carried.push(`${impact.subtopics} subtopic${impact.subtopics === 1 ? '' : 's'}`)
  if (impact.skills)    carried.push(`${impact.skills} skill${impact.skills === 1 ? '' : 's'}`)
  if (impact.questions) carried.push(`${nQ} question${nQ === 1 ? '' : 's'}`)
  if (impact.booklets)  carried.push(`${impact.booklets} workbook${impact.booklets === 1 ? '' : 's'}`)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1020]/60 backdrop-blur-sm p-4" onClick={busy ? undefined : onCancel}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-[#062E63]">
          {action === 'delete' ? `Delete “${name}”?`
            : action === 'rename' ? `Rename “${name}” to “${newName}”?`
            : `Add “${name}”?`}
        </h2>
        <p className="text-xs text-[#2A2035]/55 mt-0.5">{where}</p>

        {(
          <>
            <p className="text-sm text-[#2A2035]/80 mt-3">
              The Master Database and the Question Bank share one topic list, so this
              changes <strong>{LABEL[other]}</strong> too.
            </p>
            {action === 'rename' && carried.length > 0 && (
              <p className="text-sm text-[#2A2035]/80 mt-2">
                Carried across with it: {carried.join(', ')}.
              </p>
            )}
            {action === 'delete' && (
              <>
                {bits.length > 0 && (
                  <p className="text-sm text-[#2A2035]/80 mt-2">
                    This also removes {bits.join(' and ')}.
                  </p>
                )}
                <p className="text-sm text-[#2A2035]/80 mt-2">
                  {kept.length === 0
                    ? 'Nothing is filed under it.'
                    : <>The {kept.join(' and ')} filed under it {kept.length === 1 && nQ === 1 ? 'is' : 'are'}{' '}
                        <strong>kept</strong>. They stay where they are with no topic allocated —
                        {nQ > 0 && ' questions under the Question Bank’s Untagged tab'}
                        {nQ > 0 && nB > 0 && ','}
                        {nB > 0 && ' workbooks under “No topic assigned” here'} — ready to be retagged.</>}
                </p>
              </>
            )}
            {action !== 'add' && !otherHas && (
              <p className="text-xs text-[#B45309] mt-2">
                {LABEL[other]} has no topic by this name for {where}, so only this side changes.
              </p>
            )}
          </>
        )}

        {error && <p className="text-[11px] text-[#B91C1C] font-semibold mt-3">{error}</p>}

        <div className="flex items-center gap-2 mt-5">
          <button onClick={onConfirm} disabled={busy}
            className={`px-4 py-2 rounded-xl text-white text-sm font-semibold transition disabled:opacity-40 ${
              action === 'delete' ? 'bg-[#B91C1C] hover:bg-[#991B1B]' : 'bg-[#325099] hover:bg-[#062E63]'}`}>
            {busy ? 'Saving…' : action === 'delete' ? 'Delete from both' : 'Save to both'}
          </button>
          <button onClick={onCancel} disabled={busy}
            className="px-4 py-2 rounded-xl bg-[#F1F4FB] text-[#2A2035]/70 text-sm font-semibold hover:bg-[#E6EBF7] transition disabled:opacity-40">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
