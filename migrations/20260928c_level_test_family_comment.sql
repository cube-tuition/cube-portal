-- Level-test family email: one comment for the whole family, shown ONCE at the
-- end of the email, after every child's section.
--
-- A remark that covers every child (e.g. "we'd suggest both enrol next term")
-- written into each child's Overall box appeared once per child. There is no
-- family row to hold it, so the same text is written to every lesson in the
-- send; either child's marking page then shows and edits it.
alter table public.lessons
  add column if not exists report_family_comment text;

comment on column public.lessons.report_family_comment is
  'Level-test family email comment, shown once after all children. Same text on every lesson sent together.';
