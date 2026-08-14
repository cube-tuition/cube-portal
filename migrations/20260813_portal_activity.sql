-- Portal usage tracking: one row per user per (Sydney) day. `visits` counts
-- portal opens (heartbeat, throttled client-side); `logins` counts fresh
-- password sign-ins. Written only through the RPC below, read by staff.
create table public.portal_activity (
  user_id   uuid not null,
  day       date not null,
  role      text not null default 'student',
  visits    int  not null default 0,
  logins    int  not null default 0,
  last_seen timestamptz not null default now(),
  primary key (user_id, day)
);
create index portal_activity_day_idx on public.portal_activity (day desc);

alter table public.portal_activity enable row level security;

create policy staff_read on public.portal_activity
  for select to authenticated using (is_staff());

-- All writes go through this: keyed on auth.uid() so a client can only ever
-- record its own activity, and increments are atomic.
create or replace function public.record_portal_activity(p_login boolean default false)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_day  date := (now() at time zone 'Australia/Sydney')::date;
begin
  if v_uid is null then return; end if;
  select coalesce(raw_app_meta_data->>'role', 'student') into v_role
  from auth.users where id = v_uid;
  insert into public.portal_activity (user_id, day, role, visits, logins, last_seen)
  values (v_uid, v_day, coalesce(v_role, 'student'), 1, case when p_login then 1 else 0 end, now())
  on conflict (user_id, day) do update set
    visits    = portal_activity.visits + 1,
    logins    = portal_activity.logins + (case when p_login then 1 else 0 end),
    last_seen = now();
end $$;

-- Seed: auth.users only remembers each user's LAST sign-in, so plant that one
-- day per user so the page isn't empty before live tracking accumulates.
insert into public.portal_activity (user_id, day, role, visits, logins, last_seen)
select id,
       (last_sign_in_at at time zone 'Australia/Sydney')::date,
       coalesce(raw_app_meta_data->>'role', 'student'),
       1, 1, last_sign_in_at
from auth.users
where last_sign_in_at is not null
on conflict (user_id, day) do nothing;
