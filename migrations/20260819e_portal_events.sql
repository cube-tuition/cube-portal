-- Event stream under the analytics page. portal_page_views keeps one row per
-- user per day per route — enough for "what gets used", useless for sessions,
-- durations, time-of-day or an activity feed, which all need real timestamps.
--
-- One row per event. page_view events are written by the SAME RPC the client
-- already calls on every route change, so the stream starts filling the moment
-- this deploys, with no client change. Domain events (homework_view,
-- quiz_complete, …) go through record_portal_event when the student portal
-- starts emitting them — the allowlist below is the taxonomy.

create table if not exists public.portal_events (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  ts      timestamptz not null default now(),
  event   text not null,
  path    text,
  meta    jsonb
);
create index if not exists portal_events_ts_idx   on public.portal_events (ts desc);
create index if not exists portal_events_user_idx on public.portal_events (user_id, ts desc);

alter table public.portal_events enable row level security;
drop policy if exists staff_read on public.portal_events;
create policy staff_read on public.portal_events
  for select to authenticated using (is_staff());
-- no insert/update policies: writes go through the definer functions only

-- page_view events ride on the existing per-page RPC.
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
  insert into public.portal_events (user_id, event, path)
  values (v_uid, 'page_view', v_path);
end $$;

-- Domain events, for when portal features start reporting themselves. The
-- allowlist stops a tampered client filling the table with arbitrary strings.
create or replace function public.record_portal_event(p_event text, p_path text default null, p_meta jsonb default null)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if p_event not in ('login','logout','homework_view','homework_start','homework_complete',
                     'quiz_start','quiz_complete','resource_view','resource_download',
                     'report_view','schedule_view') then
    return;
  end if;
  insert into public.portal_events (user_id, event, path, meta)
  values (v_uid, p_event, public.normalise_portal_path(p_path), p_meta);
end $$;

revoke all on function public.record_portal_event(text, text, jsonb) from public;
grant execute on function public.record_portal_event(text, text, jsonb) to authenticated;
