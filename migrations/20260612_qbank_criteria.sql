-- ─────────────────────────────────────────────────────────────────────────────
-- CUBE Portal — Marking-criteria bands for the solutions PDF
-- Run once in Supabase SQL Editor.
--
-- For a question/part worth >1 mark, the solutions document shows a NESA-style
-- banded marking guideline (a row per mark, full down to 1). The top band is
-- always "Provides correct answer"; the lower bands auto-generate generic
-- defaults that a tutor can override. Overrides are stored here as a JSON object
-- keyed by mark value → descriptor, e.g. {"2":"…","1":"…"} (top band not stored).
-- ─────────────────────────────────────────────────────────────────────────────
alter table qbank_questions      add column if not exists criteria jsonb not null default '{}'::jsonb;
alter table qbank_question_parts add column if not exists criteria jsonb not null default '{}'::jsonb;
