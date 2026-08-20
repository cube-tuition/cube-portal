-- Client-side crash log.
--
-- The Aug 14 workbook bug crashed every student for five days without a trace:
-- there was no error boundary and nothing recording client failures, so the
-- only signal was students reporting "a timeout" in their own words. The error
-- boundaries added alongside this migration report every crash here, so a
-- broken page shows up as rows the same afternoon — not as word of mouth.
--
-- Writes go through /api/client-error with the service role (a crash can
-- happen before sign-in, and anon INSERT would be an open spam target), so
-- RLS grants no insert to anyone. Staff read them on the monitoring page.

create table public.client_errors (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  route       text not null,            -- pathname where it crashed
  message     text not null,
  stack       text,                     -- first lines only, capped by the API
  digest      text,                     -- Next.js server-error digest, if any
  user_id     uuid,                     -- auth.uid() if signed in; null before login
  user_agent  text,
  global      boolean not null default false   -- true = root-layout (global-error) crash
);

create index client_errors_at_idx on public.client_errors (at desc);

alter table public.client_errors enable row level security;

create policy staff_read on public.client_errors
  for select to authenticated using (is_staff());
