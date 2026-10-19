-- Enrolment status → trial pipeline sync, scoped to the subject it belongs to.
--
-- sync_enrolment_to_trial_submission (trigger enrolment_status_sync) used to
-- copy every enrolment status change onto EVERY trial_submissions row of the
-- student. A student trialling Maths and English has one submission per
-- subject, so converting Maths marked English "enrolled" too, and ending one
-- trial declined both.
--
-- Now it moves only the submission linked to this enrolment (enrolment_id),
-- or — for a submission with no link — the one on this class; a student with
-- a single submission is matched as before. A trial ended because the family
-- put it on hold (end_reason 'Trial on hold') is not a decline: the pipeline
-- sets On hold itself.

create or replace function public.sync_enrolment_to_trial_submission()
returns trigger
language plpgsql
as $$
declare
  mapped_status text;
begin
  mapped_status := case new.status
    when 'active'         then 'enrolled'
    when 'disenrol'       then 'declined'
    when 'trial complete' then 'trial_completed'
    when 'trial'          then 'trial_scheduled'
    else null
  end;

  if mapped_status is null then return new; end if;
  if mapped_status = 'declined' and new.end_reason = 'Trial on hold' then return new; end if;

  update trial_submissions ts
     set status = mapped_status
   where ts.converted_student_id = new.student_id
     and (
       ts.enrolment_id = new.id
       or (ts.enrolment_id is null and ts.trial_class_id is not distinct from new.class_id)
       or (select count(*) from trial_submissions x where x.converted_student_id = new.student_id) = 1
     );

  return new;
end;
$$;
