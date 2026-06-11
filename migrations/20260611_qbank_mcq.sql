-- ─────────────────────────────────────────────────────────────────────────────
-- CUBE Portal — Question Bank: multiple-choice support
-- Run once in Supabase SQL Editor.
--
-- Adds a question type to qbank_questions so a question can be either an
-- 'extended' response (default, as before) or 'mcq' (multiple choice). MCQ
-- questions store their options as JSON (e.g. [{"label":"A","latex":"$x=2$"}…])
-- and the correct option label; the existing solution_latex holds the
-- explanation. Used by the exam generator's Section I.
-- ─────────────────────────────────────────────────────────────────────────────

alter table qbank_questions
  add column if not exists qtype          text  not null default 'extended',
  add column if not exists options        jsonb not null default '[]'::jsonb,
  add column if not exists correct_option text;

alter table qbank_questions drop constraint if exists qbank_questions_qtype_check;
alter table qbank_questions add constraint qbank_questions_qtype_check
  check (qtype in ('extended','mcq'));

create index if not exists qbank_questions_qtype_idx on qbank_questions(qtype);
