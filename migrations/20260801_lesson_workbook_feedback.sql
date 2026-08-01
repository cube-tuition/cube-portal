-- SUPERSEDED IN PART by 20260801b (checklists replace the notes transfer) and
-- 20260801c (which drops notes_wb_errors / notes_wb_suggestions / notes_wb_sync
-- once feedback became per-item checklist entries). Kept for history.

-- Workbook feedback captured on the individual lesson page, directly under the
-- assigned booklet. Replaces the old "Workbook changes / fixes" box in the
-- "Notes to CUBE" group (lessons.notes_workbook), which is left in place so no
-- existing entry is lost.
--
-- notes_wb_sync records what this lesson last pushed into booklets.notes:
--   { "booklet_id": <int>, "block": "<the exact text block written>" }
-- so a re-save can find that block and replace it in place rather than
-- appending a second copy. If staff have since hand-edited the note and the
-- block no longer matches, the app appends a fresh one instead of guessing.

alter table public.lessons
  add column if not exists notes_wb_errors      text,
  add column if not exists notes_wb_suggestions text,
  add column if not exists notes_wb_sync        jsonb;

comment on column public.lessons.notes_wb_errors is
  'Tutor-reported errors in the assigned booklet (typos, wrong answers).';
comment on column public.lessons.notes_wb_suggestions is
  'Tutor suggestions for improving the assigned booklet.';
comment on column public.lessons.notes_wb_sync is
  'Last transfer into booklets.notes: {booklet_id, block}. Used to update in place.';
