-- Starred chats: each person stars the conversations they want at the top —
-- channels, class channels, direct messages and CUBE threads alike, in staff
-- chat and in student messaging. A star is private to the person who set it.
--
-- Replaces the staff-only channel pins, which lived in portal_settings
-- ('chat_pins:<user>', unreadable to students); those carry over as stars.
--
-- Also closes a hole in chat_members: a member could update their own
-- membership row's channel_id (or user_id) — the policy only checked the row
-- stayed theirs — and so move themselves into any channel, staff or private
-- ones included, and read it. Members may now change only their own `muted`;
-- joining and leaving go through the insert/delete policies as before.

create table if not exists public.chat_stars (
  user_id    uuid not null default auth.uid(),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  starred_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);
alter table public.chat_stars enable row level security;
create policy chat_stars_own_read on public.chat_stars for select to authenticated using (user_id = auth.uid());
create policy chat_stars_own_add on public.chat_stars for insert to authenticated with check (user_id = auth.uid());
create policy chat_stars_own_remove on public.chat_stars for delete to authenticated using (user_id = auth.uid());

-- Old pins → stars, in the order they were pinned.
insert into public.chat_stars (user_id, channel_id, starred_at)
select substring(s.key from 11)::uuid, p.id::uuid, now() - interval '1 second' * (100 - p.ord)
  from public.portal_settings s
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(s.value::jsonb) = 'array' then s.value::jsonb else '[]'::jsonb end
  ) with ordinality as p(id, ord)
 where s.key like 'chat_pins:%'
   and exists (select 1 from public.chat_channels c where c.id = p.id::uuid)
on conflict do nothing;
delete from public.portal_settings where key like 'chat_pins:%';

-- Membership: only the member's own mute setting is editable — the column
-- grant, and a trigger so the rule holds whatever the grants say.
revoke update on public.chat_members from anon, authenticated;
grant update (muted) on public.chat_members to authenticated;

create or replace function public.chat_members_fixed_keys()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.channel_id is distinct from old.channel_id or new.user_id is distinct from old.user_id then
    raise exception 'A membership cannot be moved to another channel or person — leave and join instead';
  end if;
  return new;
end;
$function$;
drop trigger if exists chat_members_fixed_keys on public.chat_members;
create trigger chat_members_fixed_keys before update on public.chat_members
  for each row execute function public.chat_members_fixed_keys();

insert into public.test_snapshot_objects (kind, name, ord)
select v.kind, v.name, coalesce((select max(ord) from public.test_snapshot_objects o where o.kind = v.kind), 0) + v.n
  from (values ('table', 'chat_stars', 1), ('function', 'chat_members_fixed_keys', 1), ('trigger', 'chat_members_fixed_keys', 1)) v(kind, name, n)
 where not exists (select 1 from public.test_snapshot_objects o where o.kind = v.kind and o.name = v.name);
