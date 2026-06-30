-- Record which staff member marked/saved a session. Stamped on each attendance
-- row when the session is saved (SessionMarker), and shown as "Last saved … by …".
alter table public.attendance
  add column if not exists saved_by text,
  add column if not exists saved_at timestamptz;
