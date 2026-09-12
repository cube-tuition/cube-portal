-- SMS conversations with families, via the office Twilio number.
-- One row per message either way. Threads are grouped by `phone` at read time
-- (the other party, E.164), and a contact name is resolved on the page from
-- students.phone / guardians.phone — nothing here references those tables, so
-- a number that isn't on file still keeps its thread.
--
-- Inbound rows are written by the Twilio webhook (service role); outbound rows
-- by the send route after Twilio accepts the message. Staff can read every row
-- and update read_at (marking a thread read); they never insert directly.

create table if not exists public.sms_messages (
  id          uuid primary key default gen_random_uuid(),
  direction   text not null check (direction in ('in', 'out')),
  phone       text not null,                 -- the family's number, E.164
  body        text not null default '',
  twilio_sid  text unique,
  status      text not null default 'received',   -- received | queued | sent | delivered | undelivered | failed
  error       text,
  sent_by     text,                          -- staff name on outbound
  read_at     timestamptz,                   -- inbound only: when staff opened the thread
  created_at  timestamptz not null default now()
);
create index if not exists sms_messages_phone_idx on public.sms_messages (phone, created_at);
create index if not exists sms_messages_unread_idx on public.sms_messages (created_at) where direction = 'in' and read_at is null;

alter table public.sms_messages enable row level security;
drop policy if exists sms_messages_staff_select on public.sms_messages;
create policy sms_messages_staff_select on public.sms_messages
  for select to authenticated using (public.is_staff());
drop policy if exists sms_messages_staff_update on public.sms_messages;
create policy sms_messages_staff_update on public.sms_messages
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

alter publication supabase_realtime add table public.sms_messages;
