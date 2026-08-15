-- Per-page usage: one row per user per (Sydney) day per page. Sits alongside
-- portal_activity, which answers "was this person here?"; this answers "what
-- did they actually open?".
--
-- `path` stores a normalised ROUTE, not a URL: ids are collapsed to :id, so
-- /workbook/8f3c…-uuid and /classes/599 become /workbook/:id and /classes/:id.
-- Without that, one row per booklet per student per day would bury the table
-- and the page-level totals would be meaningless.
create table if not exists public.portal_page_views (
  user_id   uuid not null,
  day       date not null,
  path      text not null,
  views     int  not null default 0,
  last_seen timestamptz not null default now(),
  primary key (user_id, day, path)
);
create index if not exists portal_page_views_day_idx  on public.portal_page_views (day desc);
create index if not exists portal_page_views_path_idx on public.portal_page_views (path);

alter table public.portal_page_views enable row level security;

-- Staff read; nobody writes directly (the RPC below is security definer).
drop policy if exists staff_read on public.portal_page_views;
create policy staff_read on public.portal_page_views
  for select to authenticated using (is_staff());

-- Normalise a raw pathname into a route pattern. Done in SQL rather than
-- trusting the client, so a tampered-with call cannot fill the table with
-- thousands of distinct strings.
create or replace function public.normalise_portal_path(p_path text)
returns text
language plpgsql immutable
as $$
declare v text;
begin
  v := split_part(coalesce(p_path, ''), '?', 1);   -- drop any query string
  v := split_part(v, '#', 1);                      -- and any fragment
  if v = '' then return '/'; end if;
  if left(v, 1) <> '/' then v := '/' || v; end if;
  -- uuids first, then bare numeric segments, then long opaque slugs
  v := regexp_replace(v, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', ':id', 'g');
  v := regexp_replace(v, '/[0-9]+(?=/|$)', '/:id', 'g');
  v := regexp_replace(v, '/[A-Za-z0-9_-]{24,}(?=/|$)', '/:id', 'g');
  v := rtrim(v, '/');
  if v = '' then v := '/'; end if;
  return left(v, 120);
end $$;

-- All writes go through this: the user is auth.uid() server-side, so a client
-- can only ever record its own page views. Failures are the caller's to ignore.
create or replace function public.record_page_view(p_path text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_day  date := (now() at time zone 'Australia/Sydney')::date;
  v_path text := public.normalise_portal_path(p_path);
begin
  if v_uid is null then return; end if;
  insert into public.portal_page_views (user_id, day, path, views, last_seen)
  values (v_uid, v_day, v_path, 1, now())
  on conflict (user_id, day, path) do update set
    views     = portal_page_views.views + 1,
    last_seen = now();
end $$;

revoke all on function public.record_page_view(text) from public;
grant execute on function public.record_page_view(text) to authenticated;
