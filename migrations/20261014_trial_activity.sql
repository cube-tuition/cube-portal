-- Trial pipeline: when was each case last acted on?
--
-- To nudge the directors when a trial case sits untouched for two days
-- (lib/trialPipeline, pushed by the morning job), a case needs a clock. Until
-- now only some actions left a time (contacted_at, invitation_sent_at, …);
-- moving the stage, adding notes or assigning the trial class left none.
--
--   last_activity_at   stamped by the trigger below whenever someone acts on
--                      the case: stage, notes, trial class or date, the
--                      student / enrolment link, contact, invitation, reminder.
--   stale_notified_at  when the directors were last told the case had gone
--                      quiet. Any new activity clears it, so a case that goes
--                      quiet again is reported again — never twice in a row.

alter table public.trial_submissions add column if not exists last_activity_at timestamptz;
alter table public.trial_submissions add column if not exists stale_notified_at timestamptz;

update public.trial_submissions
   set last_activity_at = greatest(submitted_at, contacted_at, invitation_sent_at, reminder_sent_at, converted_at)
 where last_activity_at is null;

create or replace function public.trial_submission_activity()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    new.last_activity_at := coalesce(new.last_activity_at, new.submitted_at, now());
    return new;
  end if;
  if new.status               is distinct from old.status
     or new.admin_notes        is distinct from old.admin_notes
     or new.notes              is distinct from old.notes
     or new.trial_date         is distinct from old.trial_date
     or new.trial_class_id     is distinct from old.trial_class_id
     or new.converted_student_id is distinct from old.converted_student_id
     or new.enrolment_id       is distinct from old.enrolment_id
     or new.contacted_at       is distinct from old.contacted_at
     or new.invitation_sent_at is distinct from old.invitation_sent_at
     or new.reminder_sent_at   is distinct from old.reminder_sent_at then
    new.last_activity_at := now();
    new.stale_notified_at := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists trial_submissions_activity on public.trial_submissions;
create trigger trial_submissions_activity
  before insert or update on public.trial_submissions
  for each row execute function public.trial_submission_activity();

-- Covered by the test snapshot (tests/trialPipeline.db.test.mjs).
insert into public.test_snapshot_objects (kind, name, ord) values
  ('table', 'trial_submissions', 29),
  ('function', 'trial_submission_activity', 34),
  ('trigger', 'trial_submissions_activity', 8)
on conflict (kind, name) do nothing;
