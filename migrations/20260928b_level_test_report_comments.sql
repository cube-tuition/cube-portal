-- Level-test feedback: one comment per test, not one for the whole visit.
--
-- A child who sits Maths and English gets a comment for each, shown in the
-- email as subheadings under their name. Keyed by the level test's build id
-- ({ "<build id>": "comment" }) because a lesson links its tests by build id.
-- report_comment stays as the optional overall comment.
alter table public.lessons
  add column if not exists report_comments jsonb not null default '{}'::jsonb;

comment on column public.lessons.report_comments is
  'Level-test feedback comment per linked test, keyed by booklet_builds id. report_comment is the overall comment.';
