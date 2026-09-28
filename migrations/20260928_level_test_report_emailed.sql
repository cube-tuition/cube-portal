-- Level-test feedback emails: remember when a report went out, to whom, and
-- which lessons went in the same email.
--
-- Siblings who sit level tests together now get ONE family email carrying
-- every child's report. Without a record, the second child's marking page had
-- no way to know its report had already gone with the first, and a second
-- email was one click away. Each lesson in a send is stamped with the same
-- time, address and list of lesson ids, so either page can say "sent with
-- Aaron's report".
alter table public.lessons
  add column if not exists report_emailed_at   timestamptz,
  add column if not exists report_emailed_to   text,
  add column if not exists report_emailed_with integer[];

comment on column public.lessons.report_emailed_at is
  'When the level-test feedback email carrying this lesson''s report was last sent.';
comment on column public.lessons.report_emailed_to is
  'Address that email went to.';
comment on column public.lessons.report_emailed_with is
  'Every lesson id whose report was attached to that same email (includes this one).';
