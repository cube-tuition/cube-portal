-- Classes and 1:1s are separate revenue accounts in Xero, so the tuition
-- fallback splits in two. enrolment_account_code keeps its meaning (group
-- classes); enrolment_1on1_account_code is used when the line's class is a 1:1,
-- falling back to the class code when it hasn't been set — so nothing changes
-- for anyone who leaves it blank.
alter table public.xero_settings
  add column if not exists enrolment_1on1_account_code text;

comment on column public.xero_settings.enrolment_account_code is
  'Xero account code for GROUP class tuition lines with no item mapping.';
comment on column public.xero_settings.enrolment_1on1_account_code is
  'Xero account code for 1:1 tuition lines with no item mapping. Blank = use enrolment_account_code.';
