-- Trial reminders now go out from the pipeline (the Emails → Trials page is
-- retired), and each send is recorded on the submission — dated from the
-- first send, like invitation_sent_at — so the card shows what the family
-- has actually received.
alter table public.trial_submissions add column if not exists reminder_sent_at timestamptz;
