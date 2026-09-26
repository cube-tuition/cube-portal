-- Planning notes on a timetable draft's enrolments. Keyed "<class_id>|<student_id>"
-- (class_id is the draft card's id — a real class id, or new_… for a class
-- the draft has not created yet):
--   { "<class_id>|<student_id>": { "parent": true, "teacher": false, "note": "…" } }
-- Draft-only: nothing here is copied onto real enrolments by "Apply to live".
alter table public.timetable_drafts
  add column if not exists enrolment_meta jsonb not null default '{}'::jsonb;
