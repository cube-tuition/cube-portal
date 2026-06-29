-- Saved "Course Offers" campaigns for the admin emails area. Each offer is a
-- promotional email (subject + body) plus an audience filter: which year levels,
-- which subjects a student must currently do, and which they must NOT (typically
-- the offered subject, so you never pitch it to someone already enrolled).
-- Recipients are computed live from current enrolments; only the rule is stored.
create table if not exists public.course_offers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null default 'Untitled offer',
  email_subject     text not null default '',
  body              text not null default '',
  year_levels       jsonb not null default '[]'::jsonb,  -- [7,8,9]; empty = all years
  requires_subjects jsonb not null default '[]'::jsonb,  -- must currently do ALL of these
  excludes_subjects jsonb not null default '[]'::jsonb,  -- must NOT currently do any of these
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.course_offers enable row level security;
drop policy if exists staff_all on public.course_offers;
create policy staff_all on public.course_offers
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
