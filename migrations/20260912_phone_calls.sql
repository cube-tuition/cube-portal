-- Calls to the office Twilio number. Each call is forwarded to a mobile
-- (VOICE_FORWARD_TO); if nobody answers, Twilio takes a voicemail and, later,
-- a transcript. One row per call, updated as Twilio reports each stage.
create table if not exists public.phone_calls (
  id              uuid primary key default gen_random_uuid(),
  twilio_sid      text unique not null,
  direction       text not null default 'in' check (direction in ('in', 'out')),
  phone           text not null,                -- the family's number, E.164
  forwarded_to    text,                         -- the mobile we rang
  status          text not null default 'ringing',   -- ringing | answered | missed | voicemail
  duration_s      integer,                      -- talk time once answered
  recording_sid   text,
  recording_url   text,
  recording_s     integer,
  transcript      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists phone_calls_phone_idx on public.phone_calls (phone, created_at);

alter table public.phone_calls enable row level security;
drop policy if exists phone_calls_staff_select on public.phone_calls;
create policy phone_calls_staff_select on public.phone_calls
  for select to authenticated using (public.is_staff());

alter publication supabase_realtime add table public.phone_calls;
