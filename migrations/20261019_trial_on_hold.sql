-- Trial pipeline: "On hold".
--
-- A family that wants to pause ("we'll hold off for now and maybe contact you
-- later") is neither declined nor an open case. On hold parks the enquiry:
-- it leaves the active list and the stale-trial nudges (lib/trialPipeline
-- only reads open stages), its trial enrolment is ended so the student is off
-- the class roll, and the card can be reopened at any time.
--
--   held_at           when it was put on hold
--   hold_until        optional check-back date: that morning the directors get
--                     a push (app/api/reminders/daily), once
--   hold_notified_at  when that push went out (cleared by a new hold date)

alter table public.trial_submissions drop constraint if exists trial_submissions_status_check;
alter table public.trial_submissions add constraint trial_submissions_status_check
  check (status = any (array['new', 'contacted', 'trial_scheduled', 'trial_completed', 'on_hold', 'enrolled', 'declined']));

alter table public.trial_submissions
  add column if not exists held_at timestamptz,
  add column if not exists hold_until date,
  add column if not exists hold_notified_at timestamptz;
