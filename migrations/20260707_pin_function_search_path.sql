-- Pin search_path on every SECURITY DEFINER function in public.
--
-- A SECURITY DEFINER function runs with the OWNER's privileges. If its
-- search_path is not pinned, the CALLER chooses which schema an unqualified
-- name resolves to, so a hostile caller can shadow a table or function the
-- body references and have their own object read/executed as the owner.
--
-- Two distinct problems are fixed here:
--
--   * 13 functions had no search_path at all (fully caller-controlled).
--   * 10 already had `search_path=public`, which is still not airtight:
--     Postgres searches the session's temporary schema BEFORE pg_catalog
--     whenever pg_temp is not named explicitly. Listing `pg_temp` last pushes
--     it to the end of resolution, closing the temp-object shadowing route.
--
-- `public, pg_temp` is behaviour-preserving: every body below references either
-- public.-qualified objects, unqualified objects that live in public
-- (classes, terms, lessons, students, …), or pg_catalog builtins.
--
-- ALTER FUNCTION only rewrites the function's config — bodies are never
-- retyped, so this cannot alter any function's logic.

-- Previously unpinned
alter function public.clear_stale_lesson_teacher_overrides()  set search_path = public, pg_temp;
alter function public.create_shift_from_class_attendance()    set search_path = public, pg_temp;
alter function public.ensure_trial_submission()               set search_path = public, pg_temp;
alter function public.generate_lessons_for_class(integer)     set search_path = public, pg_temp;
alter function public.get_table_oids()                        set search_path = public, pg_temp;
alter function public.infohub_can_edit()                      set search_path = public, pg_temp;
alter function public.infohub_role()                          set search_path = public, pg_temp;
alter function public.is_admin()                              set search_path = public, pg_temp;
alter function public.is_admin(uuid)                          set search_path = public, pg_temp;
alter function public.resolve_tutor_by_first_name(text)       set search_path = public, pg_temp;
alter function public.set_admin_role_on_insert()              set search_path = public, pg_temp;
alter function public.set_tutor_role_on_insert()              set search_path = public, pg_temp;
alter function public.sync_lessons_for_class(integer)         set search_path = public, pg_temp;

-- Already `search_path=public`; tightened so pg_temp resolves last
alter function public.approve_pay_run(uuid)                   set search_path = public, pg_temp;
alter function public.check_dropin_capacity()                 set search_path = public, pg_temp;
alter function public.create_shifts_from_dropin()             set search_path = public, pg_temp;
alter function public.dropin_session_capacity()               set search_path = public, pg_temp;
alter function public.enrolments_default_price()              set search_path = public, pg_temp;
alter function public.ensure_pay_run(date)                    set search_path = public, pg_temp;
alter function public.get_column_type(text, text)             set search_path = public, pg_temp;
alter function public.is_staff()                              set search_path = public, pg_temp;
alter function public.mark_pay_run_exported(uuid)             set search_path = public, pg_temp;
alter function public.sync_family_invoice_payment_method()    set search_path = public, pg_temp;
