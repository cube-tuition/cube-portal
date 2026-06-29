-- Per-family email body overrides for the end-of-term report and term-start
-- email pages. When a row exists for a family, that family's email uses this
-- exact body instead of the shared template (the body is pre-resolved plain
-- text — placeholders already filled in). Keyed by term + email type + the
-- page's family grouping key.
create table if not exists public.email_template_overrides (
  id          bigint generated always as identity primary key,
  term_id     uuid not null,
  email_type  text not null check (email_type in ('end_of_term', 'term_start')),
  family_key  text not null,
  body        text not null,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  unique (term_id, email_type, family_key)
);

-- Staff-only, matching the rest of the portal (server routes use the service
-- role and bypass RLS).
alter table public.email_template_overrides enable row level security;
drop policy if exists staff_all on public.email_template_overrides;
create policy staff_all on public.email_template_overrides
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
