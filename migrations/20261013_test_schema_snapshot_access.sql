-- test_schema_snapshot(): the object list moves into a table.
--
-- Each new table or function the tests cover used to mean a new copy of the
-- whole function. Now test_snapshot_objects holds the list and the function
-- reads it; covering something new is one insert. This migration also adds
-- the tables whose access rules 20261013_tighten_staff_and_student_access.sql
-- sets (students, guardians, invoices, credits, costs, cash-pay, settings,
-- question bank, staff resources) for tests/access.db.test.mjs.

create table if not exists public.test_snapshot_objects (
  kind text not null check (kind in ('table', 'function', 'view', 'trigger')),
  name text not null,
  ord  integer not null,
  primary key (kind, name)
);
-- No policies: only the service role (and this function's owner) read it.
alter table public.test_snapshot_objects enable row level security;

insert into public.test_snapshot_objects (kind, name, ord) values
  ('table', 'terms', 1),
  ('table', 'tutors', 2),
  ('table', 'directors', 3),
  ('table', 'courses', 4),
  ('table', 'classes', 5),
  ('table', 'enrolments', 6),
  ('table', 'lessons', 7),
  ('table', 'attendance', 8),
  ('table', 'dropin_sessions', 9),
  ('table', 'tutor_rate_matrix', 10),
  ('table', 'pay_runs', 11),
  ('table', 'shifts', 12),
  ('table', 'invoice_sync_queue', 13),
  ('table', 'cash_log', 14),
  ('table', 'director_balances', 15),
  ('table', 'students', 16),
  ('table', 'guardians', 17),
  ('table', 'invoices', 18),
  ('table', 'student_credits', 19),
  ('table', 'fixed_costs', 20),
  ('table', 'cash_pay_status', 21),
  ('table', 'portal_settings', 22),
  ('table', 'qbank_questions', 23),
  ('table', 'qbank_question_parts', 24),
  ('table', 'qbank_question_images', 25),
  ('table', 'online_resources', 26),
  ('table', 'stimulus_texts', 27),
  ('function', 'touch_updated_at', 1),
  ('function', 'parse_class_time', 2),
  ('function', 'parse_class_year', 3),
  ('function', 'parse_class_mode', 4),
  ('function', 'year_band_for', 5),
  ('function', 'is_admin', 6),
  ('function', 'is_staff', 7),
  ('function', 'resolve_tutor_by_first_name', 8),
  ('function', 'resolve_matrix_rate', 9),
  ('function', 'dropin_rate_band', 10),
  ('function', 'dropin_matrix_rate', 11),
  ('function', 'current_tutor_rate', 12),
  ('function', 'pay_period_for', 13),
  ('function', 'sync_lesson_main_teacher', 14),
  ('function', 'create_shift_from_class_attendance', 15),
  ('function', 'create_shifts_from_dropin', 16),
  ('function', 'save_dropin_shift', 17),
  ('function', 'ensure_pay_run', 18),
  ('function', 'pay_run_recompute_totals', 19),
  ('function', 'approve_shift', 20),
  ('function', 'unapprove_shift', 21),
  ('function', 'approve_pay_run', 22),
  ('function', 'mark_pay_run_exported', 23),
  ('function', 'add_lessons_for_class', 24),
  ('function', 'update_lessons_for_class', 25),
  ('function', 'sync_lessons_for_class', 26),
  ('function', 'course_year', 27),
  ('function', 'class_year_matches_course', 28),
  ('function', 'course_year_consistent', 29),
  ('function', 'queue_invoice_sync', 30),
  ('function', 'payroll_match', 31),
  ('function', 'auto_approve_matched_shifts', 32),
  ('function', 'auto_approve_due_shifts', 33),
  ('view', 'pay_run_shifts', 1),
  ('trigger', 'lessons_sync_main_teacher', 1),
  ('trigger', 'attendance_to_shift', 2),
  ('trigger', 'dropin_to_shift', 3),
  ('trigger', 'shifts_touch', 4),
  ('trigger', 'classes_year_matches_course', 5),
  ('trigger', 'courses_year_consistent', 6),
  ('trigger', 'enrolments_queue_invoice_sync', 7)
on conflict (kind, name) do update set ord = excluded.ord;

create or replace function public.test_schema_snapshot()
returns text
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  -- What to snapshot lives in test_snapshot_objects (kind, name, ord), so
  -- covering a new table or function is one insert, not a new copy of this.
  v_tables   text[] := array(select name from public.test_snapshot_objects where kind = 'table'    order by ord);
  v_funcs    text[] := array(select name from public.test_snapshot_objects where kind = 'function' order by ord);
  v_views    text[] := array(select name from public.test_snapshot_objects where kind = 'view'     order by ord);
  v_triggers text[] := array(select name from public.test_snapshot_objects where kind = 'trigger'  order by ord);
  v_out text := '';
  r record;
begin
  -- Sequences behind serial-style defaults.
  for r in
    select distinct (regexp_match(pg_get_expr(d.adbin, d.adrelid), 'nextval\(''([^'']+)''::regclass\)'))[1] as seq
    from pg_attrdef d join pg_class c on c.oid = d.adrelid
    where c.relnamespace = 'public'::regnamespace and c.relname = any (v_tables)
      and pg_get_expr(d.adbin, d.adrelid) like 'nextval(%'
    order by 1
  loop
    v_out := v_out || format(E'create sequence %s;\n', r.seq);
  end loop;
  v_out := v_out || E'\n';

  -- Tables: columns, defaults, not-null, primary/unique/check constraints.
  for r in
    select c.oid, c.relname
    from unnest(v_tables) with ordinality u(name, ord)
    join pg_class c on c.relname = u.name and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    order by u.ord
  loop
    v_out := v_out || format(E'create table public.%I (\n', r.relname) ||
      (select string_agg(format('  %I %s%s%s%s', a.attname, format_type(a.atttypid, a.atttypmod),
                                case a.attidentity when 'a' then ' generated always as identity'
                                                   when 'd' then ' generated by default as identity' else '' end,
                                coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''),
                                case when a.attnotnull then ' not null' else '' end), E',\n' order by a.attnum)
         from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped) ||
      coalesce((select E',\n' || string_agg(format('  constraint %I %s', con.conname, pg_get_constraintdef(con.oid)), E',\n'
                                            order by con.contype desc, con.conname)
                  from pg_constraint con where con.conrelid = r.oid and con.contype in ('p', 'u', 'c')), '') ||
      E'\n);\n\n';
  end loop;

  -- Foreign keys between the tables above (keys to tables outside the set are left out).
  for r in
    select c.relname, con.conname, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_class f on f.oid = con.confrelid
    where con.contype = 'f' and c.relnamespace = 'public'::regnamespace
      and c.relname = any (v_tables) and f.relname = any (v_tables)
    order by c.relname, con.conname
  loop
    v_out := v_out || format(E'alter table public.%I add constraint %I %s;\n', r.relname, r.conname, r.def);
  end loop;

  -- Unique indexes that are not constraints (ON CONFLICT targets live here).
  for r in
    select pg_get_indexdef(x.indexrelid) as def
    from pg_index x join pg_class c on c.oid = x.indrelid join pg_class i on i.oid = x.indexrelid
    where c.relnamespace = 'public'::regnamespace and c.relname = any (v_tables)
      and x.indisunique and not exists (select 1 from pg_constraint con where con.conindid = x.indexrelid)
    order by c.relname, i.relname
  loop
    v_out := v_out || r.def || E';\n';
  end loop;
  v_out := v_out || E'\n';

  -- Functions (every overload), then views, then triggers.
  for r in
    select pg_get_functiondef(p.oid) as def
    from unnest(v_funcs) with ordinality u(name, ord)
    join pg_proc p on p.proname = u.name and p.pronamespace = 'public'::regnamespace
    order by u.ord, pg_get_function_identity_arguments(p.oid)
  loop
    v_out := v_out || r.def || E';\n\n';
  end loop;

  for r in
    select c.relname, pg_get_viewdef(c.oid, true) as def
    from unnest(v_views) u(name)
    join pg_class c on c.relname = u.name and c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  loop
    v_out := v_out || format(E'create view public.%I as\n%s\n\n', r.relname, r.def);
  end loop;

  -- Row-level security and its policies (after the functions they call).
  for r in
    select c.relname from unnest(v_tables) with ordinality u(name, ord)
    join pg_class c on c.relname = u.name and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    where c.relrowsecurity order by u.ord
  loop
    v_out := v_out || format(E'alter table public.%I enable row level security;\n', r.relname);
  end loop;
  for r in
    select p.* from pg_policies p
    where p.schemaname = 'public' and p.tablename = any (v_tables)
    order by p.tablename, p.policyname
  loop
    v_out := v_out || format(E'create policy %I on public.%I as %s for %s to %s%s%s;\n',
      r.policyname, r.tablename, r.permissive, r.cmd, array_to_string(r.roles, ', '),
      coalesce(' using (' || r.qual || ')', ''), coalesce(' with check (' || r.with_check || ')', ''));
  end loop;
  v_out := v_out || E'\n';

  for r in
    select pg_get_triggerdef(t.oid) as def
    from unnest(v_triggers) with ordinality u(name, ord)
    join pg_trigger t on t.tgname = u.name and not t.tgisinternal
    join pg_class c on c.oid = t.tgrelid and c.relnamespace = 'public'::regnamespace
    order by u.ord
  loop
    v_out := v_out || r.def || E';\n';
  end loop;

  return v_out;
end;
$function$;

revoke all on function public.test_schema_snapshot() from public, anon, authenticated;
grant execute on function public.test_schema_snapshot() to service_role;
