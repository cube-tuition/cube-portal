-- Two trial feedback emails instead of one.
--
-- A trial is two lessons. The family now hears after each: the lesson 1
-- feedback email (the tutor's notes plus a reminder of the next trial lesson)
-- and the trial outcome email (lesson 2's notes plus how to continue). Each is
-- dated from its first real send, like invitation_sent_at, so the card can show
-- it and the morning nudge knows which one is still owed.
--
-- Sending either counts as acting on the case, so it restarts the pipeline's
-- activity clock (migrations/20261014_trial_activity.sql).

alter table public.trial_submissions
  add column if not exists lesson1_feedback_sent_at timestamptz,
  add column if not exists outcome_sent_at timestamptz;

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
     or new.reminder_sent_at   is distinct from old.reminder_sent_at
     or new.lesson1_feedback_sent_at is distinct from old.lesson1_feedback_sent_at
     or new.outcome_sent_at    is distinct from old.outcome_sent_at then
    new.last_activity_at := now();
    new.stale_notified_at := null;
  end if;
  return new;
end;
$function$;
