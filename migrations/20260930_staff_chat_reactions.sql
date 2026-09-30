-- Emoji reactions on chat messages: one row per (message, person, emoji).
-- Visible wherever the message is (its channel's members); people add and
-- remove only their own. Also a full-text index for the chat search box.
create table if not exists public.chat_reactions (
  message_id  uuid not null references public.chat_messages(id) on delete cascade,
  user_id     uuid not null,
  emoji       text not null check (length(emoji) between 1 and 16),
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.chat_reactions enable row level security;
drop policy if exists chat_reactions_read on public.chat_reactions;
create policy chat_reactions_read on public.chat_reactions for select to authenticated
  using (exists (select 1 from public.chat_messages m where m.id = message_id and public.chat_is_member(m.channel_id)));
drop policy if exists chat_reactions_own on public.chat_reactions;
create policy chat_reactions_own on public.chat_reactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and exists (select 1 from public.chat_messages m where m.id = message_id and public.chat_is_member(m.channel_id)));
do $$ begin
  alter publication supabase_realtime add table public.chat_reactions;
exception when duplicate_object then null; end $$;

create index if not exists chat_messages_fts_idx on public.chat_messages using gin (to_tsvector('english', body));
