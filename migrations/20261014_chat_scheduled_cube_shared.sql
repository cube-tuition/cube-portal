-- CUBE is a shared voice: a message scheduled as CUBE belongs to every director,
-- so any director can see, change or cancel it (and must still be able to post there).
-- Messages scheduled under someone's own name stay private to them.
create or replace function public.chat_is_director() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.directors d where d.id = auth.uid())
$$;
drop policy if exists chat_scheduled_read on public.chat_scheduled_messages;
create policy chat_scheduled_read on public.chat_scheduled_messages for select to authenticated
  using (sender_id = auth.uid() or (as_cube and public.chat_is_director() and public.chat_is_member(channel_id)));
drop policy if exists chat_scheduled_update on public.chat_scheduled_messages;
create policy chat_scheduled_update on public.chat_scheduled_messages for update to authenticated
  using ((sender_id = auth.uid() or (as_cube and public.chat_is_director())) and sent_at is null)
  with check ((sender_id = auth.uid() or (as_cube and public.chat_is_director())) and sent_at is null and public.chat_can_post(channel_id)
              and (not as_cube or public.chat_is_director()));
drop policy if exists chat_scheduled_delete on public.chat_scheduled_messages;
create policy chat_scheduled_delete on public.chat_scheduled_messages for delete to authenticated
  using ((sender_id = auth.uid() or (as_cube and public.chat_is_director())) and sent_message_id is null);
