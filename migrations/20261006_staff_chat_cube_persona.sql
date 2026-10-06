-- Directors can post as "CUBE" rather than as themselves, and a teacher can
-- have a direct message with CUBE: a shared thread every director sees.
-- Applied to production on 2026-10-06 via the Supabase MCP.
alter table public.chat_messages add column if not exists as_cube boolean not null default false;

-- Only a director may post as CUBE.
drop policy if exists chat_messages_send on public.chat_messages;
create policy chat_messages_send on public.chat_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.chat_can_post(channel_id)
    and (not as_cube or exists (select 1 from public.directors d where d.id = auth.uid())));

-- A CUBE thread with one teacher: kind 'cube_dm', dm_key 'cube:<teacher id>',
-- members = the teacher plus every director (re-synced each time a director
-- opens it, so a new director joins the existing threads).
create or replace function public.chat_open_cube_dm(p_other uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_key text; v_id uuid;
begin
  if not exists (select 1 from public.directors d where d.id = auth.uid()) then raise exception 'directors only'; end if;
  if not exists (select 1 from public.chat_staff_ids() s where s = p_other) then raise exception 'not a staff member'; end if;
  if exists (select 1 from public.directors d where d.id = p_other) then raise exception 'directors are CUBE'; end if;
  v_key := 'cube:' || p_other::text;
  select id into v_id from public.chat_channels where dm_key = v_key;
  if v_id is null then
    insert into public.chat_channels (kind, name, dm_key, created_by) values ('cube_dm', '', v_key, auth.uid()) returning id into v_id;
    insert into public.chat_members (channel_id, user_id) values (v_id, p_other);
  end if;
  insert into public.chat_members (channel_id, user_id)
    select v_id, d.id from public.directors d on conflict do nothing;
  return v_id;
end $function$;
