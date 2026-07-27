-- Trial pipeline: structured referrer on a submission.
--
-- referrer_student_id — the existing CUBE student whose family referred this
--   trial (picked from a dropdown on the Trials page). On conversion to full
--   enrolment the $50 referral credit is applied to BOTH families via the same
--   logic as the invoices page (referrals + student_credits + invoice lines).
-- referrer_outside — the referrer isn't a CUBE family ("Outside of CUBE");
--   recorded for reporting, no credits apply.
alter table public.trial_submissions add column if not exists referrer_student_id uuid references public.students(id);
alter table public.trial_submissions add column if not exists referrer_outside boolean not null default false;
