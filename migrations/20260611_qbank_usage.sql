-- ─────────────────────────────────────────────────────────────────────────────
-- CUBE Portal — Question usage tracking
-- Run once in Supabase SQL Editor.
--
-- A question is considered "used" when it's placed in a saved exam (derived
-- live from qbank_exam_slots) or exported in a worksheet. Worksheets aren't
-- otherwise persisted, so each worksheet export is logged here.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists qbank_worksheet_usage (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references qbank_questions(id) on delete cascade,
  title       text,
  used_by     text,
  used_at     timestamptz not null default now()
);
create index if not exists qbank_worksheet_usage_question_idx on qbank_worksheet_usage(question_id);
