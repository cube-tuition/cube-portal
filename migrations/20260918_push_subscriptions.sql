-- Web push subscriptions for the standalone Messages app (directors' phones).
-- One row per browser/device; the endpoint is the identity. Written through
-- the /api/push/subscribe route (service role) after the user allows
-- notifications; the inbound SMS and voice webhooks read every row to notify.
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_used   timestamptz
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
