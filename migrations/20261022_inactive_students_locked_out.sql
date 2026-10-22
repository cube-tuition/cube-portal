-- Inactive students cannot use the portal.
--
-- A student's portal login is open only while their status (worked out from
-- their enrolments — migrations/20261021_student_status_automatic.sql) is
-- active or trial. Inactive or pending: the account is suspended, using the
-- sign-in system's own ban (auth.users.banned_until), so it cannot sign in or
-- renew a session, and every session it has is ended. Nothing else changes:
-- their answers, results and reports stay; re-enrolling reopens the login
-- the moment the status turns active again.
--
-- Only student accounts are touched (no staff role in app_metadata), so a
-- staff login can never be suspended by this.

create or replace function public.sync_student_login(p_student uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  v_status text;
begin
  select status into v_status from public.students where id = p_student;
  if v_status in ('active', 'trial') then
    update auth.users set banned_until = null
     where id = p_student and banned_until is not null
       and coalesce(raw_app_meta_data ->> 'role', 'student') = 'student';
  else
    -- A far-future date rather than 'infinity': the sign-in service parses it.
    update auth.users set banned_until = '2999-01-01'::timestamptz
     where id = p_student and (banned_until is null or banned_until < '2999-01-01'::timestamptz)
       and coalesce(raw_app_meta_data ->> 'role', 'student') = 'student';
    if found then
      delete from auth.sessions where user_id = p_student;   -- refresh tokens go with them
    end if;
  end if;
end;
$function$;
revoke execute on function public.sync_student_login(uuid) from public, anon, authenticated;

create or replace function public.student_status_syncs_login()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    perform sync_student_login(new.id);
  end if;
  return null;
end;
$function$;

drop trigger if exists students_sync_login on public.students;
create trigger students_sync_login
  after insert or update on public.students
  for each row execute function public.student_status_syncs_login();

-- Every student now.
select public.sync_student_login(id) from public.students;

insert into public.test_snapshot_objects (kind, name, ord)
select v.kind, v.name, coalesce((select max(ord) from public.test_snapshot_objects o where o.kind = v.kind), 0) + v.n
  from (values ('function', 'sync_student_login', 1), ('function', 'student_status_syncs_login', 2),
               ('trigger', 'students_sync_login', 1)) v(kind, name, n)
 where not exists (select 1 from public.test_snapshot_objects o where o.kind = v.kind and o.name = v.name);
