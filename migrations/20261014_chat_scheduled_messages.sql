-- Scheduled chat messages. The sender writes one with a send_at time; a
-- once-a-minute pg_cron job calls /api/chat/scheduled/deliver, which posts every
-- due message into chat_messages (as the sender) and pushes it like any other.
-- Until then only the sender can see, edit or cancel it.
create table if not exists public.chat_scheduled_messages (
  id              uuid primary key default gen_random_uuid(),
  channel_id      uuid not null references public.chat_channels(id) on delete cascade,
  sender_id       uuid not null default auth.uid(),
  sender_name     text not null default '',
  body            text not null check (length(btrim(body)) > 0),
  as_cube         boolean not null default false,
  send_at         timestamptz not null,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,           -- set when delivery claims it
  sent_message_id uuid references public.chat_messages(id) on delete set null,
  error           text                   -- why it could not be delivered
);
create index if not exists chat_scheduled_due on public.chat_scheduled_messages (send_at) where sent_at is null;

alter table public.chat_scheduled_messages enable row level security;

-- Same rule as posting now (chat_messages_send), plus a time in the future.
drop policy if exists chat_scheduled_read on public.chat_scheduled_messages;
create policy chat_scheduled_read on public.chat_scheduled_messages for select to authenticated
  using (sender_id = auth.uid());
drop policy if exists chat_scheduled_insert on public.chat_scheduled_messages;
create policy chat_scheduled_insert on public.chat_scheduled_messages for insert to authenticated
  with check (sender_id = auth.uid() and send_at > now() and sent_at is null
              and public.chat_can_post(channel_id)
              and (not as_cube or exists (select 1 from public.directors d where d.id = auth.uid())));
drop policy if exists chat_scheduled_update on public.chat_scheduled_messages;
create policy chat_scheduled_update on public.chat_scheduled_messages for update to authenticated
  using (sender_id = auth.uid() and sent_at is null)
  with check (sender_id = auth.uid() and sent_at is null and public.chat_can_post(channel_id)
              and (not as_cube or exists (select 1 from public.directors d where d.id = auth.uid())));
drop policy if exists chat_scheduled_delete on public.chat_scheduled_messages;
-- Cancel a pending one, or dismiss one that failed to deliver.
create policy chat_scheduled_delete on public.chat_scheduled_messages for delete to authenticated
  using (sender_id = auth.uid() and sent_message_id is null);
