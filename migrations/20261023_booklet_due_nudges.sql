-- A lesson's booklet-not-published nudge is claimed in auto_reminders like the
-- family reminders (key 'booklet:<lesson id>'), so it goes to the materials
-- owner exactly once, on the first 15-minute run after the lesson comes within
-- 24 hours (lib/classPrep bookletDueNudges, /api/reminders/upcoming).
alter table public.auto_reminders drop constraint if exists auto_reminders_kind_check;
alter table public.auto_reminders add constraint auto_reminders_kind_check check (kind in ('trial', 'level_test', 'booklet'));
