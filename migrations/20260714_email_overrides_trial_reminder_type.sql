-- New email type for the Trials page (per-family personalised trial reminders).
alter table public.email_template_overrides
  drop constraint if exists email_template_overrides_email_type_check;
alter table public.email_template_overrides
  add constraint email_template_overrides_email_type_check
  check (email_type = any (array['end_of_term'::text, 'term_start'::text, 'trial_reminder'::text]));
