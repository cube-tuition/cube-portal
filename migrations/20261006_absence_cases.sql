-- Absence cases — one row per student × missed session, from the moment the
-- tutor marks them absent until the absence is settled (makeup attended,
-- credited, written off or carried to next term).
--
-- Before this, an absence was just an attendance status: whether anyone had
-- contacted the family, whether a makeup was booked, or whether a credit was
-- still owed lived in people's heads. The Absences tab on
-- /tutor/admin/monitoring/attendance works through these rows.
--
-- stage   new → contacted (awaiting reply) → booked (makeup booked) → closed
-- outcome set when closed: makeup | credited | no_makeup | carried
--
-- The triggers below keep cases in step with what already happens elsewhere,
-- so no screen has to remember to update them:
--   attendance 'absent'            → opens a case
--   attendance absent → present    → drops an untouched case (roll corrected)
--   attendance 'makeup' / a makeup lesson row inserted → stage 'booked'
--   attendance present at the makeup session → closed, outcome 'makeup'
--   attendance absent at the makeup session  → reopened (missed the makeup)
--   makeup lesson deleted          → back to 'new'
--   lesson_cancellations insert    → closed, 'credited' or 'no_makeup'
--   lesson_cancellations undone    → reopened
-- reconcile_absence_cases() re-runs the makeup checks for cases whose makeup
-- was marked before its date (the guest flow pre-marks the target present).

create table if not exists public.absence_cases (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null,
  class_id         integer not null,
  session_date     date not null,
  lesson_id        integer,               -- the missed session's lessons row
  stage            text not null default 'new'
                   check (stage in ('new','contacted','booked','closed')),
  outcome          text check (outcome in ('makeup','credited','no_makeup','carried')),
  makeup_lesson_id integer,               -- lessons row of the booked makeup
  cancellation_id  integer,               -- lesson_cancellations row (credit / no credit)
  source           text not null default 'attendance'
                   check (source in ('attendance','manual','backfill')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  closed_at        timestamptz,
  unique (student_id, class_id, session_date)
);
create index if not exists absence_cases_stage_idx on public.absence_cases (stage, session_date desc);
create index if not exists absence_cases_makeup_idx on public.absence_cases (makeup_lesson_id) where makeup_lesson_id is not null;

create table if not exists public.absence_case_notes (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.absence_cases(id) on delete cascade,
  kind        text not null default 'note' check (kind in ('note','contact','stage','system')),
  body        text not null,
  author_id   uuid,
  author_name text,
  created_at  timestamptz not null default now()
);
create index if not exists absence_case_notes_case_idx on public.absence_case_notes (case_id, created_at);

alter table public.absence_cases enable row level security;
alter table public.absence_case_notes enable row level security;
drop policy if exists staff_all on public.absence_cases;
create policy staff_all on public.absence_cases for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists staff_all on public.absence_case_notes;
create policy staff_all on public.absence_case_notes for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

comment on table public.absence_cases is
  'One per student × missed session; tracks follow-up (stage) and how it was settled (outcome).';
comment on table public.absence_case_notes is
  'Timeline of an absence case: notes, contact log, stage changes and automatic events.';

-- ── helpers ──────────────────────────────────────────────────────────────────
create or replace function public.absence_today() returns date
language sql stable as $$ select (now() at time zone 'Australia/Sydney')::date $$;

create or replace function public.absence_source_lesson(p_class integer, p_date date) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.lessons
  where class_id = p_class and lesson_date = p_date and coalesce(is_makeup, false) = false
  order by id limit 1
$$;

create or replace function public.absence_note(p_case uuid, p_body text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.absence_case_notes (case_id, kind, body) values (p_case, 'system', p_body)
$$;

-- ── attendance → cases ───────────────────────────────────────────────────────
create or replace function public.absence_sync_attendance() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ml   record;
  cid  uuid;
  src  integer;
  mlid integer;
  changed boolean := tg_op = 'INSERT' or new.status is distinct from old.status;
begin
  -- Is this row the student's MAKEUP session? Then it settles (or reopens)
  -- the original absence, and never opens a case of its own.
  select l.id, l.lesson_date, l.makeup_source_lesson_id into ml
  from public.lessons l
  where l.is_makeup and l.makeup_student_id = new.student_id
    and l.class_id = new.class_id and l.lesson_date = new.session_date
  order by l.id desc limit 1;
  if found then
    if new.status in ('present','late') and new.session_date <= public.absence_today() then
      for cid in
        update public.absence_cases c
           set stage = 'closed', outcome = 'makeup', makeup_lesson_id = ml.id,
               closed_at = now(), updated_at = now()
         where c.stage <> 'closed' and c.student_id = new.student_id
           and (c.makeup_lesson_id = ml.id or c.lesson_id = ml.makeup_source_lesson_id)
        returning c.id
      loop
        perform public.absence_note(cid, 'Makeup attended on ' || to_char(new.session_date, 'Dy DD Mon') || '.');
      end loop;
    elsif new.status = 'absent' and changed then
      for cid in
        update public.absence_cases c
           set stage = 'new', outcome = null, makeup_lesson_id = null,
               closed_at = null, updated_at = now()
         where c.student_id = new.student_id
           and (c.makeup_lesson_id = ml.id or c.lesson_id = ml.makeup_source_lesson_id)
           and coalesce(c.outcome, 'makeup') = 'makeup'
        returning c.id
      loop
        perform public.absence_note(cid, 'Missed the makeup on ' || to_char(new.session_date, 'Dy DD Mon') || ' — reopened.');
      end loop;
    end if;
    return new;
  end if;

  if not changed then return new; end if;

  if new.status = 'absent' then
    insert into public.absence_cases (student_id, class_id, session_date, lesson_id)
    values (new.student_id, new.class_id, new.session_date,
            public.absence_source_lesson(new.class_id, new.session_date))
    on conflict (student_id, class_id, session_date) do nothing;

  elsif tg_op = 'UPDATE' and old.status = 'absent' and new.status in ('present','late') then
    -- The roll was corrected. A case nobody has touched goes; one with
    -- history stays, with a note saying what changed.
    delete from public.absence_cases c
     where c.student_id = new.student_id and c.class_id = new.class_id
       and c.session_date = new.session_date
       and c.stage = 'new' and c.makeup_lesson_id is null and c.cancellation_id is null
       and not exists (select 1 from public.absence_case_notes n where n.case_id = c.id);
    if not found then
      select id into cid from public.absence_cases
       where student_id = new.student_id and class_id = new.class_id and session_date = new.session_date;
      if cid is not null then
        perform public.absence_note(cid, 'Attendance changed from absent to ' || new.status || '.');
      end if;
    end if;

  elsif new.status = 'makeup' then
    src := public.absence_source_lesson(new.class_id, new.session_date);
    select id into mlid from public.lessons
     where is_makeup and makeup_student_id = new.student_id and makeup_source_lesson_id = src
     order by id desc limit 1;
    insert into public.absence_cases (student_id, class_id, session_date, lesson_id, stage, makeup_lesson_id)
    values (new.student_id, new.class_id, new.session_date, src, 'booked', mlid)
    on conflict (student_id, class_id, session_date) do update
      set stage = case when absence_cases.stage = 'closed' then 'closed' else 'booked' end,
          makeup_lesson_id = coalesce(excluded.makeup_lesson_id, absence_cases.makeup_lesson_id),
          updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists absence_sync_attendance on public.attendance;
create trigger absence_sync_attendance
  after insert or update of status on public.attendance
  for each row execute function public.absence_sync_attendance();

-- ── makeup lessons → cases ───────────────────────────────────────────────────
create or replace function public.absence_sync_makeup_lesson() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s   record;
  cid uuid;
begin
  if tg_op = 'DELETE' then
    for cid in
      update public.absence_cases c
         set stage = case when c.stage = 'booked' then 'new' else c.stage end,
             makeup_lesson_id = null, updated_at = now()
       where c.makeup_lesson_id = old.id and c.stage <> 'closed'
      returning c.id
    loop
      perform public.absence_note(cid, 'The booked makeup (' || to_char(old.lesson_date, 'Dy DD Mon') || ') was removed.');
    end loop;
    return old;
  end if;

  if not coalesce(new.is_makeup, false) or new.makeup_student_id is null or new.makeup_source_lesson_id is null then
    return new;
  end if;
  select class_id, lesson_date into s from public.lessons where id = new.makeup_source_lesson_id;
  if not found then return new; end if;
  insert into public.absence_cases (student_id, class_id, session_date, lesson_id, stage, makeup_lesson_id)
  values (new.makeup_student_id, s.class_id, s.lesson_date, new.makeup_source_lesson_id, 'booked', new.id)
  on conflict (student_id, class_id, session_date) do update
    set stage = case when absence_cases.stage = 'closed' then 'closed' else 'booked' end,
        makeup_lesson_id = new.id, updated_at = now()
  returning id into cid;
  perform public.absence_note(cid, 'Makeup booked for ' || to_char(new.lesson_date, 'Dy DD Mon') || '.');
  return new;
end $$;

drop trigger if exists absence_sync_makeup_lesson on public.lessons;
create trigger absence_sync_makeup_lesson
  after insert or delete on public.lessons
  for each row execute function public.absence_sync_makeup_lesson();

-- ── cancellations (credit / no credit) → cases ───────────────────────────────
create or replace function public.absence_sync_cancellation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s   record;
  cid uuid;
begin
  if tg_op = 'UPDATE' then
    if old.undone_at is null and new.undone_at is not null then
      for cid in
        update public.absence_cases c
           set stage = 'new', outcome = null, cancellation_id = null,
               closed_at = null, updated_at = now()
         where c.cancellation_id = new.id
        returning c.id
      loop
        perform public.absence_note(cid, case when new.type = 'credit' then 'Credit undone' else 'Cancellation undone' end || ' — reopened.');
      end loop;
    end if;
    return new;
  end if;

  select class_id, lesson_date into s from public.lessons where id = new.lesson_id;
  if not found then return new; end if;
  insert into public.absence_cases (student_id, class_id, session_date, lesson_id, stage, outcome, cancellation_id, closed_at)
  values (new.student_id, s.class_id, s.lesson_date, new.lesson_id, 'closed',
          case when new.type = 'credit' then 'credited' else 'no_makeup' end, new.id, now())
  on conflict (student_id, class_id, session_date) do update
    set stage = 'closed', outcome = excluded.outcome, cancellation_id = new.id,
        closed_at = now(), updated_at = now()
  returning id into cid;
  perform public.absence_note(cid,
    case when new.type = 'credit'
      then 'Credited' || coalesce(' $' || to_char(new.credit_amount, 'FM999990.00'), '')
           || case when new.held_for_next_term then ' (held for next term)' else ' (taken off the open invoice)' end
      else 'Closed without credit' end
    || coalesce(' — ' || nullif(new.reason, ''), '') || '.');
  return new;
end $$;

drop trigger if exists absence_sync_cancellation on public.lesson_cancellations;
create trigger absence_sync_cancellation
  after insert or update of undone_at on public.lesson_cancellations
  for each row execute function public.absence_sync_cancellation();

-- ── reconcile ────────────────────────────────────────────────────────────────
-- Booked makeups whose date has passed: attended → closed, absent → reopened.
-- The Absences tab calls this on load.
create or replace function public.reconcile_absence_cases() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  n integer := 0;
begin
  if not public.is_staff() and auth.role() <> 'service_role' then return 0; end if;
  for r in
    select c.id, l.lesson_date, a.status
      from public.absence_cases c
      join public.lessons l on l.id = c.makeup_lesson_id
      join public.attendance a on a.student_id = c.student_id
                              and a.class_id = l.class_id and a.session_date = l.lesson_date
     where c.stage = 'booked' and l.lesson_date <= public.absence_today()
       and a.status in ('present','late','absent')
  loop
    if r.status = 'absent' then
      update public.absence_cases set stage = 'new', makeup_lesson_id = null, updated_at = now() where id = r.id;
      perform public.absence_note(r.id, 'Missed the makeup on ' || to_char(r.lesson_date, 'Dy DD Mon') || ' — reopened.');
    else
      update public.absence_cases set stage = 'closed', outcome = 'makeup', closed_at = now(), updated_at = now() where id = r.id;
      perform public.absence_note(r.id, 'Makeup attended on ' || to_char(r.lesson_date, 'Dy DD Mon') || '.');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.reconcile_absence_cases() to authenticated;

-- The helpers are internal: only the triggers (running as owner) call them.
revoke execute on function public.absence_note(uuid, text) from public, anon, authenticated;
revoke execute on function public.absence_source_lesson(integer, date) from public, anon, authenticated;
revoke execute on function public.reconcile_absence_cases() from public, anon;
grant execute on function public.reconcile_absence_cases() to authenticated;

-- ── backfill: Term 3 2026 onwards (applied once, 2026-10-06) ────────────────
-- Absences on regular sessions open as 'new'; 'makeup' statuses as 'booked'
-- with their makeup lesson; credits/cancellations closed. reconcile then
-- closed the makeups already attended.
insert into public.absence_cases (student_id, class_id, session_date, lesson_id, source)
select a.student_id, a.class_id, a.session_date, public.absence_source_lesson(a.class_id, a.session_date), 'backfill'
from public.attendance a
where a.session_date >= '2026-07-20' and a.status = 'absent'
  and not exists (select 1 from public.lessons l where l.is_makeup and l.makeup_student_id = a.student_id
                  and l.class_id = a.class_id and l.lesson_date = a.session_date)
on conflict do nothing;

insert into public.absence_cases (student_id, class_id, session_date, lesson_id, stage, makeup_lesson_id, source)
select a.student_id, a.class_id, a.session_date, src.id, 'booked',
       (select l.id from public.lessons l where l.is_makeup and l.makeup_student_id = a.student_id
         and l.makeup_source_lesson_id = src.id order by l.id desc limit 1), 'backfill'
from public.attendance a
left join lateral (select public.absence_source_lesson(a.class_id, a.session_date) id) src on true
where a.session_date >= '2026-07-20' and a.status = 'makeup'
on conflict do nothing;

insert into public.absence_cases (student_id, class_id, session_date, lesson_id, stage, outcome, cancellation_id, closed_at, source)
select lc.student_id, l.class_id, l.lesson_date, lc.lesson_id, 'closed',
       case when lc.type = 'credit' then 'credited' else 'no_makeup' end, lc.id, lc.cancelled_at, 'backfill'
from public.lesson_cancellations lc join public.lessons l on l.id = lc.lesson_id
where lc.undone_at is null and l.lesson_date >= '2026-07-20'
on conflict (student_id, class_id, session_date) do update
  set stage = 'closed', outcome = excluded.outcome, cancellation_id = excluded.cancellation_id, closed_at = excluded.closed_at;

insert into public.absence_case_notes (case_id, kind, body)
select id, 'system', 'Imported from Term 3 attendance when absence cases started.'
from public.absence_cases where source = 'backfill';

select public.reconcile_absence_cases();
