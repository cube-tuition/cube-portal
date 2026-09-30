-- Staff chat: Slack-style channels and direct messages between teachers,
-- keyed on portal accounts (tutors and directors are auth users). Channels
-- are open to every staff member; a DM is a private two-person channel.
-- Messages are visible only to a channel's members, which is what keeps DMs
-- private — directors are members of every open channel, not of every DM.

create table if not exists public.chat_channels (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('channel', 'dm')),
  name        text not null default '',
  dm_key      text unique,                     -- dm: the two user ids, sorted, joined with ':'
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create table if not exists public.chat_members (
  channel_id  uuid not null references public.chat_channels(id) on delete cascade,
  user_id     uuid not null,
  joined_at   timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create table if not exists public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references public.chat_channels(id) on delete cascade,
  sender_id    uuid not null,
  sender_name  text not null default '',
  body         text not null,
  created_at   timestamptz not null default now(),
  edited_at    timestamptz,
  deleted_at   timestamptz
);
create index if not exists chat_messages_channel_idx on public.chat_messages(channel_id, created_at);
create table if not exists public.chat_reads (
  channel_id    uuid not null references public.chat_channels(id) on delete cascade,
  user_id       uuid not null,
  last_read_at  timestamptz not null default now(),
  primary key (channel_id, user_id)
);

alter table public.chat_channels enable row level security;
alter table public.chat_members  enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads    enable row level security;

-- Open channels are listed to every staff member; a DM only to its two people.
drop policy if exists chat_channels_read on public.chat_channels;
create policy chat_channels_read on public.chat_channels for select to authenticated
  using (public.is_staff() and (kind = 'channel' or exists (select 1 from public.chat_members m where m.channel_id = id and m.user_id = auth.uid())));
drop policy if exists chat_members_read on public.chat_members;
create policy chat_members_read on public.chat_members for select to authenticated
  using (public.is_staff() and exists (select 1 from public.chat_channels c where c.id = channel_id
    and (c.kind = 'channel' or exists (select 1 from public.chat_members me where me.channel_id = c.id and me.user_id = auth.uid()))));
-- Joining an open channel is a member row for yourself; leaving is deleting it.
drop policy if exists chat_members_join on public.chat_members;
create policy chat_members_join on public.chat_members for insert to authenticated
  with check (public.is_staff() and user_id = auth.uid() and exists (select 1 from public.chat_channels c where c.id = channel_id and c.kind = 'channel'));
drop policy if exists chat_members_leave on public.chat_members;
create policy chat_members_leave on public.chat_members for delete to authenticated
  using (user_id = auth.uid());
-- Messages: members only. Senders may edit / soft-delete their own.
drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (exists (select 1 from public.chat_members m where m.channel_id = channel_id and m.user_id = auth.uid()));
drop policy if exists chat_messages_send on public.chat_messages;
create policy chat_messages_send on public.chat_messages for insert to authenticated
  with check (sender_id = auth.uid() and exists (select 1 from public.chat_members m where m.channel_id = channel_id and m.user_id = auth.uid()));
drop policy if exists chat_messages_own on public.chat_messages;
create policy chat_messages_own on public.chat_messages for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());
drop policy if exists chat_reads_own on public.chat_reads;
create policy chat_reads_own on public.chat_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Live delivery: new messages stream to open pages.
do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null; end $$;

-- Every staff user id: tutors and directors both store their auth uid as id.
create or replace function public.chat_staff_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.tutors where coalesce(active, true) union select id from public.directors
$$;

-- Create an open channel: the creator and every director are members.
create or replace function public.chat_create_channel(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  insert into public.chat_channels (kind, name, created_by) values ('channel', trim(p_name), auth.uid()) returning id into v_id;
  insert into public.chat_members (channel_id, user_id)
    select v_id, x.id from (select auth.uid() as id union select id from public.directors) x on conflict do nothing;
  return v_id;
end $$;

-- Open (or find) the DM between the caller and another staff member.
create or replace function public.chat_open_dm(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_key text; v_id uuid;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if p_other = auth.uid() then raise exception 'that is you'; end if;
  if not exists (select 1 from public.chat_staff_ids() s where s = p_other) then raise exception 'not a staff member'; end if;
  v_key := least(auth.uid()::text, p_other::text) || ':' || greatest(auth.uid()::text, p_other::text);
  select id into v_id from public.chat_channels where dm_key = v_key;
  if v_id is null then
    insert into public.chat_channels (kind, name, dm_key, created_by) values ('dm', '', v_key, auth.uid()) returning id into v_id;
    insert into public.chat_members (channel_id, user_id) values (v_id, auth.uid()), (v_id, p_other);
  end if;
  return v_id;
end $$;

-- Unread messages per channel for the caller (others' messages after last_read_at).
create or replace function public.chat_unread_counts() returns table(channel_id uuid, n bigint)
language sql stable security definer set search_path = public as $$
  select m.channel_id, count(msg.id)
  from public.chat_members m
  left join public.chat_reads r on r.channel_id = m.channel_id and r.user_id = auth.uid()
  left join public.chat_messages msg on msg.channel_id = m.channel_id and msg.deleted_at is null
    and msg.sender_id <> auth.uid() and msg.created_at > coalesce(r.last_read_at, 'epoch'::timestamptz)
  where m.user_id = auth.uid()
  group by m.channel_id
$$;

-- The #staff channel, with everyone in it.
do $$
declare v_id uuid;
begin
  select id into v_id from public.chat_channels where kind = 'channel' and name = 'staff';
  if v_id is null then
    insert into public.chat_channels (kind, name) values ('channel', 'staff') returning id into v_id;
  end if;
  insert into public.chat_members (channel_id, user_id) select v_id, s from public.chat_staff_ids() s on conflict do nothing;
end $$;

-- ── Fix (same day): the read policies referenced each other — members checked
-- channels, channels checked members — and Postgres refused with "infinite
-- recursion detected in policy". Membership and channel kind are now read
-- through SECURITY DEFINER helpers, which bypass RLS, so no policy ever
-- evaluates another.
create or replace function public.chat_is_member(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_members m where m.channel_id = p_channel and m.user_id = auth.uid())
$$;
create or replace function public.chat_channel_open(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_channels c where c.id = p_channel and c.kind = 'channel')
$$;
drop policy if exists chat_channels_read on public.chat_channels;
create policy chat_channels_read on public.chat_channels for select to authenticated
  using (public.is_staff() and (kind = 'channel' or public.chat_is_member(id)));
drop policy if exists chat_members_read on public.chat_members;
create policy chat_members_read on public.chat_members for select to authenticated
  using (public.is_staff() and (public.chat_channel_open(channel_id) or public.chat_is_member(channel_id)));
drop policy if exists chat_members_join on public.chat_members;
create policy chat_members_join on public.chat_members for insert to authenticated
  with check (public.is_staff() and user_id = auth.uid() and public.chat_channel_open(channel_id));
drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (public.chat_is_member(channel_id));
drop policy if exists chat_messages_send on public.chat_messages;
create policy chat_messages_send on public.chat_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.chat_is_member(channel_id));

-- ── Rename / delete an open channel: its creator or any director; never #staff.
create or replace function public.chat_can_manage(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_channels c
    where c.id = p_channel and c.kind = 'channel' and c.name <> 'staff'
      and (c.created_by = auth.uid() or exists (select 1 from public.directors d where d.id = auth.uid())))
$$;
create or replace function public.chat_rename_channel(p_channel uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_can_manage(p_channel) then raise exception 'Only the channel''s creator or a director can rename it'; end if;
  if length(trim(p_name)) = 0 then raise exception 'A channel needs a name'; end if;
  update public.chat_channels set name = trim(p_name) where id = p_channel;
end $$;
create or replace function public.chat_delete_channel(p_channel uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_can_manage(p_channel) then raise exception 'Only the channel''s creator or a director can delete it'; end if;
  delete from public.chat_channels where id = p_channel;   -- members, messages and reads cascade
end $$;

-- ── The everyone-channel is flagged, not named ("staff"): it can be renamed,
-- never deleted or left. Managers can add and remove members of a channel.
alter table public.chat_channels add column if not exists is_default boolean not null default false;
update public.chat_channels set is_default = true where kind = 'channel' and name = 'staff' and not exists (select 1 from public.chat_channels where is_default);
create or replace function public.chat_can_manage(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_channels c
    where c.id = p_channel and c.kind = 'channel'
      and (c.created_by = auth.uid() or exists (select 1 from public.directors d where d.id = auth.uid())))
$$;
create or replace function public.chat_delete_channel(p_channel uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_can_manage(p_channel) then raise exception 'Only the channel''s creator or a director can delete it'; end if;
  if exists (select 1 from public.chat_channels where id = p_channel and is_default) then raise exception 'The everyone channel cannot be deleted'; end if;
  delete from public.chat_channels where id = p_channel;
end $$;
create or replace function public.chat_add_member(p_channel uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_can_manage(p_channel) then raise exception 'Only the channel''s creator or a director can add members'; end if;
  if not exists (select 1 from public.chat_staff_ids() s where s = p_user) then raise exception 'Not a staff member'; end if;
  insert into public.chat_members (channel_id, user_id) values (p_channel, p_user) on conflict do nothing;
end $$;
create or replace function public.chat_remove_member(p_channel uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_can_manage(p_channel) then raise exception 'Only the channel''s creator or a director can remove members'; end if;
  if exists (select 1 from public.chat_channels where id = p_channel and is_default) then raise exception 'Everyone stays in the everyone channel'; end if;
  delete from public.chat_members where channel_id = p_channel and user_id = p_user;
end $$;
drop policy if exists chat_members_leave on public.chat_members;
create policy chat_members_leave on public.chat_members for delete to authenticated
  using (user_id = auth.uid() and not exists (select 1 from public.chat_channels c where c.id = channel_id and c.is_default));
