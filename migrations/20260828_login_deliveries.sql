-- "Have they been given their login yet?" had no answer: resets and new
-- accounts were sent and left no trace, so staff re-sent to be safe or assumed
-- wrongly that someone had it. Applied via MCP as: login_deliveries.
--
-- One row per delivery. It records who it went to and how — never the link and
-- never a password: the link is single-use and short-lived, and passwords are
-- only ever hashes.
create table if not exists public.login_deliveries (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null,
  kind         text not null default 'student' check (kind in ('student','tutor')),
  channel      text not null check (channel in ('account','guardian','link')),
  sent_to      text,                       -- null for a link handed over in person
  sent_by      uuid,
  sent_by_name text,
  purpose      text not null default 'reset' check (purpose in ('reset','login_details')),
  created_at   timestamptz not null default now()
);
create index if not exists login_deliveries_person_idx
  on public.login_deliveries(person_id, created_at desc);

alter table public.login_deliveries enable row level security;

drop policy if exists login_deliveries_read on public.login_deliveries;
create policy login_deliveries_read on public.login_deliveries
  for select using (
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin','director','tutor')
  );
