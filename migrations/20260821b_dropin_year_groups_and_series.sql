-- Drop-ins become year-targeted and repeatable.
--
-- year_groups: which years may see and book this session. NULL or empty means
-- open to every year, so the sessions that already exist keep behaving exactly
-- as they do now — the filter is opt-in, never a silent narrowing.
alter table public.dropin_sessions
  add column if not exists year_groups text[];

-- A recurring drop-in is expanded into one real row per date at save time,
-- because dropin_signins.session_id points at a concrete session: a stored
-- recurrence rule would leave bookings and per-date capacity with nothing to
-- attach to. series_id groups those rows so the director can edit or cancel
-- "this one" or "this and all later ones"; a one-off session has no series.
alter table public.dropin_sessions
  add column if not exists series_id uuid;

create index if not exists dropin_sessions_series_idx
  on public.dropin_sessions (series_id, session_date)
  where series_id is not null;

-- The student portal filters on year, so it reads by date + year_groups.
create index if not exists dropin_sessions_date_idx
  on public.dropin_sessions (session_date);
