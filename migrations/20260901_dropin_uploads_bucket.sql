-- Files on a drop-in session's page (tutor side): worksheets used, photos of
-- working, anything worth keeping with the session. Private bucket, staff-only
-- both ways, served through short-lived signed URLs — same shape as
-- journal-uploads. Paths are <session_id>/<timestamp>-<filename>, so the page
-- lists a session's files straight from storage with no metadata table.

insert into storage.buckets (id, name, public, file_size_limit)
values ('dropin-uploads', 'dropin-uploads', false, 20971520)  -- 20 MB
on conflict (id) do nothing;

drop policy if exists "dropin_uploads_staff_select" on storage.objects;
create policy "dropin_uploads_staff_select" on storage.objects
  for select using (bucket_id = 'dropin-uploads' and public.is_staff());

drop policy if exists "dropin_uploads_staff_insert" on storage.objects;
create policy "dropin_uploads_staff_insert" on storage.objects
  for insert with check (bucket_id = 'dropin-uploads' and public.is_staff());

drop policy if exists "dropin_uploads_staff_update" on storage.objects;
create policy "dropin_uploads_staff_update" on storage.objects
  for update using (bucket_id = 'dropin-uploads' and public.is_staff());

drop policy if exists "dropin_uploads_staff_delete" on storage.objects;
create policy "dropin_uploads_staff_delete" on storage.objects
  for delete using (bucket_id = 'dropin-uploads' and public.is_staff());
