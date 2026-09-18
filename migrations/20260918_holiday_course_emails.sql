-- Saved "Holiday Courses" email templates for the admin emails area. Each
-- template is a promotional email for a holiday intensive: an intro, one block
-- per subject (optionally linked to the holiday CLASS it advertises, so dates
-- and times can be pulled from that class's sessions), fee lines, and an
-- "Enrol now" button that opens the sign-up form. Recipients are chosen on the
-- page from an audience rule (year levels, subjects, student status) plus a
-- per-family checklist; only the rule is stored.
create table if not exists public.holiday_course_emails (
  id                uuid primary key default gen_random_uuid(),
  name              text not null default 'Untitled template',
  email_subject     text not null default '',
  intro             text not null default '',
  dates_line        text not null default '',
  courses           jsonb not null default '[]'::jsonb,  -- [{class_id, title, time, blurb}]
  fees              text not null default '',            -- one fee line per row
  closing           text not null default '',
  enrol_url         text not null default '',
  enrol_label       text not null default 'Enrol now',
  signoff           text not null default '',
  term_id           uuid references public.terms(id) on delete set null,  -- the holiday period
  year_levels       jsonb not null default '[]'::jsonb,  -- [5,6]; empty = all years
  requires_subjects jsonb not null default '[]'::jsonb,
  excludes_subjects jsonb not null default '[]'::jsonb,
  statuses          jsonb not null default '["active","trial"]'::jsonb,  -- student statuses to include
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.holiday_course_emails enable row level security;
drop policy if exists staff_all on public.holiday_course_emails;
create policy staff_all on public.holiday_course_emails
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
