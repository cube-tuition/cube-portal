create sequence classes_id_seq;
create sequence lessons_id_seq;

create table public.terms (
  id uuid default gen_random_uuid() not null,
  name text not null,
  year integer not null,
  term_number integer not null,
  start_date date not null,
  end_date date not null,
  created_at timestamp with time zone default now(),
  published_on_website boolean default false not null,
  constraint terms_pkey PRIMARY KEY (id)
);

create table public.tutors (
  id uuid default gen_random_uuid() not null,
  full_name text,
  email text,
  university text,
  gender text,
  phone text,
  pay_method text default 'bank'::text,
  cash_pay_weekday smallint,
  active boolean default true not null,
  tutor_code text,
  availability_updated_at timestamp with time zone,
  availability_updated_by text,
  system boolean default false not null,
  started_on date,
  constraint tutors_tutor_code_key UNIQUE (tutor_code),
  constraint tutors_pkey PRIMARY KEY (id),
  constraint tutors_cash_pay_weekday_check CHECK (((cash_pay_weekday IS NULL) OR ((cash_pay_weekday >= 1) AND (cash_pay_weekday <= 7)))),
  constraint tutors_pay_method_check CHECK ((pay_method = ANY (ARRAY['cash'::text, 'bank'::text])))
);

create table public.directors (
  id uuid default gen_random_uuid() not null,
  full_name text,
  email text,
  school text,
  gender text,
  phone text,
  pay_method text default 'bank'::text,
  cash_pay_weekday smallint,
  started_on date,
  constraint admins_pkey PRIMARY KEY (id)
);

create table public.classes (
  id integer default nextval('classes_id_seq'::regclass) not null,
  class_name text,
  day_of_week text,
  start_time text,
  end_time text,
  teacher text,
  room text,
  term_id uuid,
  course_id integer,
  source_class_id integer,
  status text default 'active'::text not null,
  constraint classes_pkey PRIMARY KEY (id),
  constraint classes_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

create table public.lessons (
  id integer default nextval('lessons_id_seq'::regclass) not null,
  class_id integer,
  lesson_date date not null,
  start_time text,
  end_time text,
  room text,
  status text default 'scheduled'::text not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  week integer,
  main_teacher text,
  scheduled_teacher_id uuid,
  is_makeup boolean default false not null,
  makeup_student_id uuid,
  makeup_source_lesson_id integer,
  notes_general text,
  notes_workbook text,
  notes_homework text,
  has_rq boolean,
  lesson_type text,
  level_test_build_id uuid,
  student_name text,
  level_test_build_ids uuid[],
  report_comment text,
  report_emailed_at timestamp with time zone,
  report_emailed_to text,
  report_emailed_with integer[],
  report_comments jsonb default '{}'::jsonb not null,
  report_family_comment text,
  constraint lessons_pkey PRIMARY KEY (id),
  constraint lessons_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'cancelled'::text, 'rescheduled'::text])))
);

create table public.attendance (
  id uuid default gen_random_uuid() not null,
  student_id uuid not null,
  class_id integer not null,
  session_date date not null,
  status text default 'present'::text not null,
  notes text,
  created_at timestamp with time zone default now(),
  makeup_class_id integer,
  trial_feedback text,
  saved_by text,
  saved_at timestamp with time zone,
  constraint attendance_pkey PRIMARY KEY (id),
  constraint attendance_status_check CHECK ((status = ANY (ARRAY['present'::text, 'late'::text, 'absent'::text, 'makeup'::text, 'cancelled'::text])))
);

create table public.dropin_sessions (
  id uuid default gen_random_uuid() not null,
  session_date date not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  location text default 'Chatswood centre'::text,
  subjects text[] default '{}'::text[],
  tutors text[] default '{}'::text[],
  notes text,
  created_at timestamp with time zone default now(),
  max_capacity integer default 5 not null,
  year_groups text[],
  series_id uuid,
  constraint dropin_sessions_pkey PRIMARY KEY (id)
);

create table public.tutor_rate_matrix (
  id uuid default gen_random_uuid() not null,
  tutor_id uuid not null,
  year_band text not null,
  mode text not null,
  hourly_rate numeric(10,2) not null,
  effective_from date default '1970-01-01'::date not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  created_by uuid,
  constraint tutor_rate_matrix_tutor_id_year_band_mode_effective_from_key UNIQUE (tutor_id, year_band, mode, effective_from),
  constraint tutor_rate_matrix_pkey PRIMARY KEY (id),
  constraint tutor_rate_matrix_hourly_rate_check CHECK ((hourly_rate >= (0)::numeric)),
  constraint tutor_rate_matrix_mode_check CHECK ((mode = ANY (ARRAY['class'::text, 'tutor'::text]))),
  constraint tutor_rate_matrix_year_band_check CHECK ((year_band = ANY (ARRAY['1-6'::text, '7-8'::text, '9-10'::text, '11-12'::text, 'other'::text])))
);

create table public.pay_runs (
  id uuid default gen_random_uuid() not null,
  period_start date not null,
  period_end date not null,
  status text default 'open'::text not null,
  total_hours numeric(10,2) default 0 not null,
  total_amount numeric(12,2) default 0 not null,
  created_at timestamp with time zone default now() not null,
  approved_at timestamp with time zone,
  approved_by uuid,
  exported_at timestamp with time zone,
  paid_at timestamp with time zone,
  notes text,
  constraint pay_runs_period_start_period_end_key UNIQUE (period_start, period_end),
  constraint pay_runs_pkey PRIMARY KEY (id),
  constraint pay_runs_check CHECK ((period_end > period_start)),
  constraint pay_runs_status_check CHECK ((status = ANY (ARRAY['open'::text, 'approved'::text, 'exported'::text, 'paid'::text, 'void'::text])))
);

create table public.shifts (
  id uuid default gen_random_uuid() not null,
  tutor_id uuid not null,
  work_date date not null,
  start_time time without time zone,
  end_time time without time zone,
  hours numeric(5,2) not null,
  kind text not null,
  source_table text,
  source_id text,
  rate_snapshot numeric(10,2),
  notes text,
  status text default 'draft'::text not null,
  submitted_at timestamp with time zone,
  approved_at timestamp with time zone,
  approved_by uuid,
  pay_run_id uuid,
  created_at timestamp with time zone default now() not null,
  created_by uuid,
  updated_at timestamp with time zone default now() not null,
  xero_pay_run_id text,
  constraint shifts_pkey PRIMARY KEY (id),
  constraint shifts_hours_check CHECK (((hours > (0)::numeric) AND (hours <= (24)::numeric))),
  constraint shifts_kind_check CHECK ((kind = ANY (ARRAY['class'::text, 'dropin'::text, 'admin'::text, 'other'::text]))),
  constraint shifts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'approved'::text, 'paid'::text, 'void'::text])))
);

alter table public.attendance add constraint attendance_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
alter table public.attendance add constraint attendance_makeup_class_id_fkey FOREIGN KEY (makeup_class_id) REFERENCES classes(id) ON DELETE SET NULL;
alter table public.classes add constraint classes_source_class_id_fkey FOREIGN KEY (source_class_id) REFERENCES classes(id) ON DELETE SET NULL;
alter table public.classes add constraint classes_term_id_fkey FOREIGN KEY (term_id) REFERENCES terms(id);
alter table public.lessons add constraint lessons_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
alter table public.lessons add constraint lessons_makeup_source_lesson_id_fkey FOREIGN KEY (makeup_source_lesson_id) REFERENCES lessons(id) ON DELETE SET NULL;
alter table public.shifts add constraint shifts_pay_run_id_fkey FOREIGN KEY (pay_run_id) REFERENCES pay_runs(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX attendance_student_class_date_idx ON public.attendance USING btree (student_id, class_id, session_date);
CREATE UNIQUE INDEX lessons_class_date_regular_idx ON public.lessons USING btree (class_id, lesson_date) WHERE (is_makeup = false);
CREATE UNIQUE INDEX shifts_source_uniq ON public.shifts USING btree (source_table, source_id) WHERE ((source_table IS NOT NULL) AND (source_id IS NOT NULL));
CREATE UNIQUE INDEX terms_year_number_idx ON public.terms USING btree (year, term_number);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.parse_class_time(t text)
 RETURNS time without time zone
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  parts text[];
  h     int;
  m     int;
begin
  if t is null or btrim(t) = '' then return null; end if;
  parts := string_to_array(btrim(t), ':');
  begin
    h := parts[1]::int;
    m := coalesce(parts[2]::int, 0);
  exception when others then
    return null;
  end;
  if h between 1 and 7 then h := h + 12; end if;
  if h < 0 or h > 23 or m < 0 or m > 59 then return null; end if;
  return make_time(h, m, 0);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.parse_class_year(p_name text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(substring(coalesce(p_name,'') from '^[Yy](\d{1,2})'), '')::int;
$function$
;

CREATE OR REPLACE FUNCTION public.parse_class_mode(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when coalesce(p_name,'') ~* '1\s*[:/]?\s*on\s*1|1\s*:\s*1' then 'tutor' else 'class' end;
$function$
;

CREATE OR REPLACE FUNCTION public.year_band_for(p_year integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_year between 1 and 6   then '1-6'
    when p_year between 7 and 8   then '7-8'
    when p_year between 9 and 10  then '9-10'
    when p_year between 11 and 12 then '11-12'
    else null
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  )
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  )
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_tutor_by_first_name(p_name text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT id FROM (
    SELECT id, full_name FROM public.tutors
    UNION ALL
    SELECT id, full_name FROM public.directors
  ) staff
  WHERE lower(btrim(coalesce(full_name, ''))) = lower(btrim(coalesce(p_name, '')))
     OR lower(split_part(coalesce(full_name, ''), ' ', 1)) = lower(btrim(coalesce(p_name, '')))
  ORDER BY (lower(btrim(coalesce(full_name, ''))) = lower(btrim(coalesce(p_name, '')))) DESC, id
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_matrix_rate(p_tutor uuid, p_class_name text, p_on date)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  -- Year-less class names fall back to the 'other' band.
  v_band text := coalesce(public.year_band_for(public.parse_class_year(p_class_name)), 'other');
  v_mode text := public.parse_class_mode(p_class_name);
  v_rate numeric;
begin
  select hourly_rate into v_rate
  from public.tutor_rate_matrix
  where tutor_id = p_tutor
    and year_band = v_band
    and mode = v_mode
    and effective_from <= p_on
  order by effective_from desc
  limit 1;
  return v_rate;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.dropin_rate_band(p_year_groups text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(
    (select case when count(distinct b) = 1 then min(b) else 'other' end
       from (
         select public.year_band_for(nullif(regexp_replace(y, '\D', '', 'g'), '')::int) as b
         from unnest(coalesce(p_year_groups, '{}'::text[])) as y
       ) t
      where b is not null),
    'other');
$function$
;

CREATE OR REPLACE FUNCTION public.dropin_matrix_rate(p_tutor uuid, p_year_groups text[], p_on date)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  select hourly_rate
  from public.tutor_rate_matrix
  where tutor_id = p_tutor
    and year_band = public.dropin_rate_band(p_year_groups)
    and mode = 'class'
    and effective_from <= p_on
  order by effective_from desc
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.current_tutor_rate(p_tutor uuid, p_on date)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  select public.dropin_matrix_rate(p_tutor, null::text[], p_on);
$function$
;

CREATE OR REPLACE FUNCTION public.pay_period_for(p_date date)
 RETURNS TABLE(period_start date, period_end date, fortnight_index integer, term_id uuid)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_term       public.terms%rowtype;
  v_start      date;
  v_next_start date;
  v_diff       int;
  v_idx        int;
begin
  -- Terms start on the Monday of their first week (date_trunc 'week'), the
  -- same rule the portal applies (lib/termDates), so a Tuesday-start term's
  -- Monday is fortnight 1 of the term, not the tail of the holidays.
  select * into v_term from public.terms
   where p_date between date_trunc('week', start_date)::date and end_date
     and coalesce(term_number, 0) <= 10
   order by start_date desc limit 1;
  if found then
    v_start := date_trunc('week', v_term.start_date)::date;
    v_diff := p_date - v_start;
    v_idx  := least(5, greatest(1, (v_diff / 14)::int + 1));
    period_start    := v_start + (v_idx - 1) * 14;
    period_end      := period_start + 13;
    fortnight_index := v_idx;
    term_id         := v_term.id;
    return next; return;
  end if;

  select * into v_term from public.terms
   where end_date < p_date and coalesce(term_number, 0) <= 10
   order by end_date desc limit 1;
  if found then
    select min(date_trunc('week', start_date)::date) into v_next_start from public.terms
     where start_date > v_term.end_date and coalesce(term_number, 0) <= 10;
    period_start    := v_term.end_date + 1;
    period_end      := coalesce(v_next_start - 1, v_term.end_date + 42);
    fortnight_index := 0;
    term_id         := v_term.id;
    return next; return;
  end if;

  select * into v_term from public.terms
   where coalesce(term_number, 0) <= 10 order by start_date asc limit 1;
  if not found then return; end if;
  period_start    := date_trunc('week', v_term.start_date)::date;
  period_end      := period_start + 13;
  fortnight_index := 1;
  term_id         := v_term.id;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_lesson_main_teacher()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.class_id is not null then
    select teacher into new.main_teacher from public.classes where id = new.class_id;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.create_shift_from_class_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_class        public.classes%rowtype;
  v_lesson       public.lessons%rowtype;
  v_tutor_id     uuid;
  v_start        time;
  v_end          time;
  v_hours        numeric(5,2);
  v_rate         numeric(10,2);
  v_source_key   text;
begin
  -- The student was moved to a make-up, or the lesson was cancelled for them:
  -- this session didn't run on their account, so it creates no shift.
  if new.status in ('makeup', 'cancelled') then return new; end if;

  select * into v_class from public.classes where id = new.class_id;
  if not found then return new; end if;

  select * into v_lesson
  from public.lessons
  where class_id = new.class_id and lesson_date = new.session_date
  order by coalesce(is_makeup, false), id
  limit 1;

  v_tutor_id := v_lesson.scheduled_teacher_id;
  if v_tutor_id is null then
    v_tutor_id := public.resolve_tutor_by_first_name(v_class.teacher);
  end if;
  if v_tutor_id is null then return new; end if;

  if not exists (select 1 from public.tutors where id = v_tutor_id)
     and not exists (select 1 from public.directors where id = v_tutor_id) then
    return new;
  end if;

  v_start := coalesce(public.parse_class_time(v_lesson.start_time), public.parse_class_time(v_class.start_time));
  v_end   := coalesce(public.parse_class_time(v_lesson.end_time),   public.parse_class_time(v_class.end_time));
  if v_start is null or v_end is null then return new; end if;

  if v_end < v_start then v_end := v_end + interval '12 hours'; end if;

  v_hours := extract(epoch from (v_end - v_start)) / 3600.0;
  if v_hours <= 0 or v_hours > 12 then return new; end if;

  v_rate := public.resolve_matrix_rate(v_tutor_id, v_class.class_name, new.session_date);

  v_source_key := v_class.id::text || '_' || new.session_date::text;

  insert into public.shifts (
    tutor_id, work_date, start_time, end_time, hours, kind,
    source_table, source_id, rate_snapshot, notes, status, created_by
  )
  values (
    v_tutor_id, new.session_date, v_start, v_end, v_hours, 'class',
    'class_session', v_source_key, v_rate,
    'Auto: ' || coalesce(v_class.class_name, 'class #' || v_class.id::text),
    'draft', v_tutor_id
  )
  on conflict (source_table, source_id)
    where source_table is not null and source_id is not null
  do update set
    tutor_id      = excluded.tutor_id,
    start_time    = excluded.start_time,
    end_time      = excluded.end_time,
    hours         = excluded.hours,
    rate_snapshot = excluded.rate_snapshot,
    notes         = excluded.notes
  where shifts.status = 'draft';

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_shifts_from_dropin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_name        text;
  v_tutor_id    uuid;
  v_hours       numeric(5,2);
  v_rate        numeric(10,2);
  v_source_key  text;
begin
  if new.tutors is null or array_length(new.tutors,1) is null then
    return new;
  end if;
  if new.start_time is null or new.end_time is null then return new; end if;

  v_hours := extract(epoch from (new.end_time - new.start_time)) / 3600.0;
  if v_hours <= 0 or v_hours > 12 then return new; end if;

  foreach v_name in array new.tutors loop
    if v_name is null or btrim(v_name) = '' then continue; end if;

    v_tutor_id := public.resolve_tutor_by_first_name(v_name);
    if v_tutor_id is null then continue; end if;

    v_rate := public.dropin_matrix_rate(v_tutor_id, new.year_groups, new.session_date);
    v_source_key := new.id::text || '_' || v_tutor_id::text;

    insert into public.shifts (
      tutor_id, work_date, start_time, end_time, hours, kind,
      source_table, source_id, rate_snapshot, notes, status, created_by
    )
    values (
      v_tutor_id, new.session_date, new.start_time, new.end_time, v_hours, 'dropin',
      'dropin_sessions', v_source_key, v_rate,
      'Auto: drop-in' || case when new.location is not null and new.location <> ''
                              then ' @ ' || new.location else '' end,
      'draft', v_tutor_id
    )
    on conflict (source_table, source_id)
      where source_table is not null and source_id is not null
    do nothing;
  end loop;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_dropin_shift(p_session_id uuid, p_start time without time zone DEFAULT NULL::time without time zone, p_end time without time zone DEFAULT NULL::time without time zone)
 RETURNS shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_sess   public.dropin_sessions%rowtype;
  v_name   text;
  v_listed boolean := false;
  v_hours  numeric(5,2);
  v_rate   numeric(10,2);
  v_key    text;
  v_row    public.shifts%rowtype;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_sess from public.dropin_sessions where id = p_session_id;
  if not found then
    raise exception 'That drop-in session no longer exists';
  end if;

  -- Only a tutor rostered on this drop-in may raise a shift for it. Names are
  -- stored as free text, so resolve each the same way the trigger does.
  foreach v_name in array coalesce(v_sess.tutors, '{}'::text[]) loop
    if public.resolve_tutor_by_first_name(v_name) = v_uid then
      v_listed := true;
    end if;
  end loop;
  if not v_listed then
    raise exception 'Only a tutor rostered on this drop-in can save its shift';
  end if;

  p_start := coalesce(p_start, v_sess.start_time);
  p_end   := coalesce(p_end,   v_sess.end_time);
  if p_start is null or p_end is null then
    raise exception 'This drop-in has no start or finish time';
  end if;

  -- The shift must sit inside the rostered session: start no earlier, finish no
  -- later. Shorter is fine — that is the whole point of letting them edit it.
  if p_start < v_sess.start_time then
    raise exception 'A drop-in shift cannot start before the session does (%)',
      to_char(v_sess.start_time, 'HH12:MIam');
  end if;
  if p_end > v_sess.end_time then
    raise exception 'A drop-in shift cannot run past the end of the session (%)',
      to_char(v_sess.end_time, 'HH12:MIam');
  end if;

  v_hours := extract(epoch from (p_end - p_start)) / 3600.0;
  if v_hours <= 0 then
    raise exception 'The finish time must be after the start time';
  end if;

  v_rate := public.dropin_matrix_rate(v_uid, v_sess.year_groups, v_sess.session_date);
  v_key  := v_sess.id::text || '_' || v_uid::text;

  insert into public.shifts (
    tutor_id, work_date, start_time, end_time, hours, kind,
    source_table, source_id, rate_snapshot, notes, status, created_by
  )
  values (
    v_uid, v_sess.session_date, p_start, p_end, v_hours, 'dropin',
    'dropin_sessions', v_key, v_rate,
    'Drop-in' || case when coalesce(v_sess.location, '') <> ''
                      then ' @ ' || v_sess.location else '' end,
    'draft', v_uid
  )
  on conflict (source_table, source_id)
    where source_table is not null and source_id is not null
  do update set
    start_time    = excluded.start_time,
    end_time      = excluded.end_time,
    hours         = excluded.hours,
    -- Keep whatever rate the shift was raised at; only fill a missing one.
    rate_snapshot = coalesce(public.shifts.rate_snapshot, excluded.rate_snapshot),
    notes         = excluded.notes
  -- An approved / paid / void shift is settled: never rewrite it from here.
  where public.shifts.status = 'draft'
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.shifts
    where source_table = 'dropin_sessions' and source_id = v_key;
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_pay_run(p_date date DEFAULT CURRENT_DATE)
 RETURNS pay_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pp record;
  v_pr public.pay_runs%rowtype;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_pp from public.pay_period_for(p_date);

  insert into public.pay_runs (period_start, period_end, status)
  values (v_pp.period_start, v_pp.period_end, 'open')
  on conflict (period_start, period_end) do nothing;

  select * into v_pr from public.pay_runs
   where period_start = v_pp.period_start and period_end = v_pp.period_end;

  return v_pr;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pay_run_recompute_totals(p_pay_run uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;
  update public.pay_runs pr
     set total_hours  = coalesce(t.h, 0),
         total_amount = coalesce(t.a, 0)
    from (select coalesce(sum(hours),0)::numeric(10,2) as h,
                 coalesce(sum(hours * coalesce(rate_snapshot,0)),0)::numeric(12,2) as a
            from public.shifts where pay_run_id = p_pay_run) t
   where pr.id = p_pay_run;
end $function$
;

CREATE OR REPLACE FUNCTION public.approve_shift(p_shift uuid, p_pay_run uuid)
 RETURNS shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pr public.pay_runs%rowtype;
  v_s  public.shifts%rowtype;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_pr from public.pay_runs where id = p_pay_run;
  if not found then raise exception 'pay run not found'; end if;
  if v_pr.status in ('exported','paid') then
    raise exception 'pay run already %', v_pr.status;
  end if;

  select * into v_s from public.shifts where id = p_shift for update;
  if not found then raise exception 'shift not found'; end if;
  if v_s.status = 'approved' then raise exception 'shift already approved'; end if;
  if v_s.status = 'paid' then raise exception 'shift already paid'; end if;
  if v_s.rate_snapshot is null then
    raise exception 'shift has no rate — set a rate before approving';
  end if;
  if not exists (
    select 1 from public.pay_run_shifts v
     where v.id = p_shift
       and v.period_start = v_pr.period_start
       and v.period_end   = v_pr.period_end
  ) then
    raise exception 'shift is not in this pay period';
  end if;

  update public.shifts
     set status = 'approved', pay_run_id = v_pr.id,
         approved_at = now(), approved_by = auth.uid()
   where id = p_shift
  returning * into v_s;

  perform public.pay_run_recompute_totals(v_pr.id);
  return v_s;
end $function$
;

CREATE OR REPLACE FUNCTION public.unapprove_shift(p_shift uuid)
 RETURNS shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_s   public.shifts%rowtype;
  v_run uuid;
  v_status text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_s from public.shifts where id = p_shift for update;
  if not found then raise exception 'shift not found'; end if;
  if v_s.status <> 'approved' then
    raise exception 'shift is % — only approved shifts can be unapproved', v_s.status;
  end if;

  v_run := v_s.pay_run_id;
  if v_run is not null then
    select status into v_status from public.pay_runs where id = v_run;
    if v_status in ('exported','paid') then
      raise exception 'pay run already % — the shift cannot be pulled back', v_status;
    end if;
  end if;

  update public.shifts
     set status = 'submitted', pay_run_id = null,
         approved_at = null, approved_by = null
   where id = p_shift
  returning * into v_s;

  if v_run is not null then
    perform public.pay_run_recompute_totals(v_run);
  end if;
  return v_s;
end $function$
;

CREATE OR REPLACE FUNCTION public.approve_pay_run(p_pay_run uuid, p_sweep boolean DEFAULT true)
 RETURNS pay_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pr public.pay_runs%rowtype;
  v_hours numeric(10,2);
  v_amount numeric(12,2);
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_pr from public.pay_runs where id = p_pay_run;
  if not found then raise exception 'pay run not found'; end if;
  if v_pr.status in ('exported','paid') then
    raise exception 'pay run already %', v_pr.status;
  end if;

  if p_sweep then
    update public.shifts s
       set status      = 'approved',
           pay_run_id  = v_pr.id,
           approved_at = now(),
           approved_by = auth.uid()
     where s.work_date between v_pr.period_start and v_pr.period_end
       and s.status in ('draft','submitted')
       and s.rate_snapshot is not null;
  elsif not exists (select 1 from public.shifts where pay_run_id = v_pr.id) then
    raise exception 'no approved shifts attached — approve at least one shift first';
  end if;

  select coalesce(sum(hours),0)::numeric(10,2),
         coalesce(sum(hours * coalesce(rate_snapshot,0)),0)::numeric(12,2)
    into v_hours, v_amount
    from public.shifts
   where pay_run_id = v_pr.id;

  update public.pay_runs
     set status       = 'approved',
         approved_at  = now(),
         approved_by  = auth.uid(),
         total_hours  = v_hours,
         total_amount = v_amount
   where id = v_pr.id
  returning * into v_pr;

  return v_pr;
end $function$
;

CREATE OR REPLACE FUNCTION public.mark_pay_run_exported(p_pay_run uuid)
 RETURNS pay_runs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pr public.pay_runs%rowtype;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_pr from public.pay_runs where id = p_pay_run;
  if not found then raise exception 'pay run not found'; end if;
  if v_pr.status != 'approved' then
    raise exception 'pay run must be approved before export (current: %)', v_pr.status;
  end if;

  update public.pay_runs
     set status = 'exported',
         exported_at = now()
   where id = p_pay_run
  returning * into v_pr;

  return v_pr;
end;
$function$
;

create view public.pay_run_shifts as
 SELECT s.id,
    s.tutor_id,
    t.full_name AS tutor_name,
    s.work_date,
    s.start_time,
    s.end_time,
    s.hours,
    s.rate_snapshot,
    (s.hours * COALESCE(s.rate_snapshot, 0::numeric))::numeric(10,2) AS amount,
    s.kind,
    s.notes,
    s.status,
    s.pay_run_id,
    s.source_table,
    s.source_id,
    pp.period_start,
    pp.period_end
   FROM shifts s
     JOIN ( SELECT tutors.id,
            tutors.full_name
           FROM tutors
        UNION ALL
         SELECT directors.id,
            directors.full_name
           FROM directors) t ON t.id = s.tutor_id
     CROSS JOIN LATERAL pay_period_for(s.work_date) pp(period_start, period_end, fortnight_index, term_id);

CREATE TRIGGER lessons_sync_main_teacher BEFORE INSERT OR UPDATE OF class_id, main_teacher ON public.lessons FOR EACH ROW EXECUTE FUNCTION sync_lesson_main_teacher();
CREATE TRIGGER attendance_to_shift AFTER INSERT OR UPDATE OF status ON public.attendance FOR EACH ROW EXECUTE FUNCTION create_shift_from_class_attendance();
CREATE TRIGGER dropin_to_shift AFTER INSERT OR UPDATE ON public.dropin_sessions FOR EACH ROW EXECUTE FUNCTION create_shifts_from_dropin();
CREATE TRIGGER shifts_touch BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
