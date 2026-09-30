-- Read receipts: everyone in a channel can see when its other members last
-- read it (chat_reads already stores that per person; it was private until now)
-- and changes stream live so "Seen" updates without a refresh.
drop policy if exists chat_reads_read on public.chat_reads;
create policy chat_reads_read on public.chat_reads for select to authenticated
  using (public.chat_is_member(channel_id));
do $$ begin
  alter publication supabase_realtime add table public.chat_reads;
exception when duplicate_object then null; end $$;

-- Announcement channels: flagged directors_only, so only directors may post.
-- Everyone still reads and reacts. Directors can flip the flag on any open channel.
alter table public.chat_channels add column if not exists directors_only boolean not null default false;
update public.chat_channels set directors_only = true where kind = 'channel' and (is_default or lower(name) like 'announce%');

create or replace function public.chat_can_post(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.chat_is_member(p_channel) and not exists (
    select 1 from public.chat_channels c
    where c.id = p_channel and c.directors_only
      and not exists (select 1 from public.directors d where d.id = auth.uid()))
$$;
drop policy if exists chat_messages_send on public.chat_messages;
create policy chat_messages_send on public.chat_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.chat_can_post(channel_id));

create or replace function public.chat_set_directors_only(p_channel uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.directors d where d.id = auth.uid()) then raise exception 'Only a director can change who may post'; end if;
  update public.chat_channels set directors_only = p_on where id = p_channel and kind = 'channel';
end $$;
