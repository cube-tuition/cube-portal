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
 * A delete that would take questions or workbooks with it is refused outright
 * rather than confirmed. Renaming a topic is always safe; deleting one is not,
 * and a modal that offers "delete anyway" invites exactly the accident it is
 * supposed to prevent.
 */
const LABEL = { master: 'Master Database', qbank: 'Question Bank' }

export default function TopicSyncModal({ action, from, year, subject, name, newName, impact, busy, error, onConfirm, onCancel }) {
  if (!action || !impact) return null
  const other = from === 'master' ? 'qbank' : 'master'
  const otherHas = other === 'master' ? !!impact.master : !!impact.qbank
  const blocked = action === 'delete' && (impact.questions > 0 || impact.booklets > 0)
  const where = `Year ${year} ${subject}`

  const bits = []
  if (impact.questions) bits.push(`${impact.questions} question${impact.questions === 1 ? '' : 's'}`)
  if (impact.subtopics) bits.push(`${impact.subtopics} subtopic${impact.subtopics === 1 ? '' : 's'}`)
  if (impact.skills)    bits.push(`${impact.skills} skill${impact.skills === 1 ? '' : 's'}`)
  if (impact.booklets)  bits.push(`${impact.booklets} workbook${impact.booklets === 1 ? '' : 's'}`)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1020]/60 backdrop-blur-sm p-4" onClick={busy ? undefined : onCancel}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-[#062E63]">
          {blocked ? `“${name}” is still in use`
            : action === 'delete' ? `Delete “${name}”?`
            : action === 'rename' ? `Rename “${name}” to “${newName}”?`
            : `Add “${name}”?`}
        </h2>
        <p className="text-xs text-[#2A2035]/55 mt-0.5">{where}</p>

        {blocked ? (
          <>
            <p className="text-sm text-[#2A2035]/80 mt-3">
              Deleting it would take {bits.join(' and ')} with it, so it has been left alone.
            </p>
            <p className="text-xs text-[#2A2035]/55 mt-2">
              {impact.questions > 0 && <>Move those questions to another topic in the Question Bank first. </>}
              {impact.booklets > 0 && <>Retag the workbooks that use it in the Master Database first.</>}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-[#2A2035]/80 mt-3">
              The Master Database and the Question Bank share one topic list, so this
              changes <strong>{LABEL[other]}</strong> too.
            </p>
            {action !== 'add' && bits.length > 0 && (
              <p className="text-sm text-[#2A2035]/80 mt-2">
                {action === 'rename' ? 'Carried across with it: ' : 'This also removes: '}{bits.join(', ')}.
              </p>
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
          {!blocked && (
            <button onClick={onConfirm} disabled={busy}
              className={`px-4 py-2 rounded-xl text-white text-sm font-semibold transition disabled:opacity-40 ${
                action === 'delete' ? 'bg-[#B91C1C] hover:bg-[#991B1B]' : 'bg-[#325099] hover:bg-[#062E63]'}`}>
              {busy ? 'Saving…' : action === 'delete' ? 'Delete from both' : 'Save to both'}
            </button>
          )}
          <button onClick={onCancel} disabled={busy}
            className="px-4 py-2 rounded-xl bg-[#F1F4FB] text-[#2A2035]/70 text-sm font-semibold hover:bg-[#E6EBF7] transition disabled:opacity-40">
            {blocked ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
