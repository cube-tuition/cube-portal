-- Device push tokens for the CUBE Tuition mobile app (Capacitor wrapper).
-- Each row is one device's APNs/FCM registration token, pointed at the user
-- currently signed in on that device (NativePushRegistrar upserts on token, so
-- switching accounts on a device re-points its token rather than duplicating).
--
-- Sending is done server-side (edge function → FCM HTTP v1, which delivers to
-- both Android and iOS once the APNs key is uploaded to Firebase); clients only
-- ever write their own token.

create table if not exists public.device_push_tokens (
  token       text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  platform    text not null check (platform in ('ios', 'android')),
  updated_at  timestamptz not null default now()
);

create index if not exists device_push_tokens_user_idx on public.device_push_tokens (user_id);

alter table public.device_push_tokens enable row level security;

-- A signed-in user manages only their own device tokens.
create policy own_tokens on public.device_push_tokens
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Admins can read every token (needed to target sends from admin tooling).
create policy admin_read_tokens on public.device_push_tokens
  for select
  using (public.is_admin(auth.uid()));

-- Keep updated_at fresh on re-registration upserts.
create or replace function public.touch_device_push_token()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists device_push_tokens_touch on public.device_push_tokens;
create trigger device_push_tokens_touch
  before update on public.device_push_tokens
  for each row execute function public.touch_device_push_token();
