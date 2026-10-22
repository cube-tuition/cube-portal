-- Changing a trial's date or class is acting on the case.
--
-- The trial pipeline's "no update" clock is trial_submissions.last_activity_at
-- (migrations/20261014_trial_activity.sql), stamped when the enquiry row
-- changes. But the first trial lesson date (enrolments.trial_start_date) and
-- the trial class live on the ENROLMENT, so rescheduling a trial left the clock
-- untouched — Aaron Wang's case, rescheduled on 22 Oct, still read
-- "no update in 12 weeks". Now a change to either on an enrolment stamps the
-- enquiry it belongs to (and clears its morning-nudge mark, so it is reported
-- again only if it goes quiet again).

create or replace function public.trial_enrolment_touches_submission()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update trial_submissions ts
     set last_activity_at = now(), stale_notified_at = null
   where ts.converted_student_id = new.student_id
     and ts.status in ('new', 'contacted', 'trial_scheduled', 'trial_1_completed', 'trial_completed')
     and (ts.enrolment_id = new.id
          or (ts.enrolment_id is null and ts.trial_class_id is not distinct from coalesce(old.class_id, new.class_id)));
  return null;
end;
$function$;

drop trigger if exists enrolments_trial_activity on public.enrolments;
create trigger enrolments_trial_activity
  after update of trial_start_date, class_id on public.enrolments
  for each row
  when (old.trial_start_date is distinct from new.trial_start_date or old.class_id is distinct from new.class_id)
  execute function public.trial_enrolment_touches_submission();

insert into public.test_snapshot_objects (kind, name, ord)
select v.kind, v.name, coalesce((select max(ord) from public.test_snapshot_objects o where o.kind = v.kind), 0) + 1
  from (values ('function', 'trial_enrolment_touches_submission'), ('trigger', 'enrolments_trial_activity')) v(kind, name)
 where not exists (select 1 from public.test_snapshot_objects o where o.kind = v.kind and o.name = v.name);
