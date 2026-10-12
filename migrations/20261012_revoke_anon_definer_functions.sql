-- Lock SECURITY DEFINER functions away from the anonymous role.
--
-- Supabase grants EXECUTE on every new function to `anon` (anyone holding the
-- public key, which ships in the website's JavaScript). For SECURITY DEFINER
-- functions that bypass RLS that was a real hole: before this migration an
-- anonymous caller could run add_lessons_for_class (it has no caller check and
-- writes lessons when p_apply is true), list every staff id (chat_staff_ids),
-- resolve tutors by name, and call the payroll RPCs (those check the caller,
-- but should not be reachable at all).
--
-- Audit (Oct 2026):
--   • every .rpc() call in the app runs only after a login (the student pages
--     gate on requireStudent, lib/activity returns early with no session), so
--     it goes as `authenticated`, which keeps its own EXECUTE grant;
--   • server routes use the service role — unaffected;
--   • trigger functions don't need EXECUTE when the trigger fires (only to
--     CREATE TRIGGER), so revoking them changes nothing but the advisor noise.
--
-- Deliberately NOT revoked: the RLS helper functions used inside policies —
-- is_staff(), is_admin() (both overloads), infohub_role(), infohub_can_edit(),
-- chat_is_member(), chat_can_post(), chat_channel_open(). A policy that
-- applies to every role is evaluated for anon too, and pulling EXECUTE would
-- turn its quiet "false" into a permission error. They only answer questions
-- about the caller, which for an anonymous caller is always "no".
--
-- Note: new functions are still granted to anon by default; revoke them here
-- (or in their own migration) when they are SECURITY DEFINER.

revoke execute on function public.add_lessons_for_class(p_class_id integer, p_apply boolean) from anon, public;
revoke execute on function public.approve_pay_run(p_pay_run uuid, p_sweep boolean) from anon, public;
revoke execute on function public.approve_shift(p_shift uuid, p_pay_run uuid) from anon, public;
revoke execute on function public.chat_add_member(p_channel uuid, p_user uuid) from anon, public;
revoke execute on function public.chat_can_manage(p_channel uuid) from anon, public;
revoke execute on function public.chat_create_channel(p_name text) from anon, public;
revoke execute on function public.chat_delete_channel(p_channel uuid) from anon, public;
revoke execute on function public.chat_open_cube_dm(p_other uuid) from anon, public;
revoke execute on function public.chat_open_dm(p_other uuid) from anon, public;
revoke execute on function public.chat_remove_member(p_channel uuid, p_user uuid) from anon, public;
revoke execute on function public.chat_rename_channel(p_channel uuid, p_name text) from anon, public;
revoke execute on function public.chat_set_directors_only(p_channel uuid, p_on boolean) from anon, public;
revoke execute on function public.chat_set_quiet(p_channel uuid, p_on boolean) from anon, public;
revoke execute on function public.chat_staff_ids() from anon, public;
revoke execute on function public.chat_unread_counts() from anon, public;
revoke execute on function public.dropin_session_capacity() from anon, public;
revoke execute on function public.ensure_pay_run(p_date date) from anon, public;
revoke execute on function public.mark_pay_run_exported(p_pay_run uuid) from anon, public;
revoke execute on function public.pay_run_recompute_totals(p_pay_run uuid) from anon, public;
revoke execute on function public.record_page_view(p_path text) from anon, public;
revoke execute on function public.record_portal_activity(p_login boolean) from anon, public;
revoke execute on function public.record_portal_event(p_event text, p_path text, p_meta jsonb) from anon, public;
revoke execute on function public.resolve_comment(p_id uuid, p_resolved boolean) from anon, public;
revoke execute on function public.resolve_tutor_by_first_name(p_name text) from anon, public;
revoke execute on function public.save_dropin_shift(p_session_id uuid, p_start time without time zone, p_end time without time zone) from anon, public;
revoke execute on function public.student_class_open_week(p_class integer) from anon, public;
revoke execute on function public.student_workbook_blocks(p_booklet uuid, p_class integer) from anon, public;
revoke execute on function public.sync_lessons_for_class(p_class_id integer) from anon, public;
revoke execute on function public.unapprove_shift(p_shift uuid) from anon, public;
revoke execute on function public.update_lessons_for_class(p_class_id integer, p_apply boolean) from anon, public;
-- trigger functions
revoke execute on function public.absence_sync_attendance() from anon, public;
revoke execute on function public.absence_sync_cancellation() from anon, public;
revoke execute on function public.absence_sync_makeup_lesson() from anon, public;
revoke execute on function public.check_dropin_capacity() from anon, public;
revoke execute on function public.clear_stale_lesson_teacher_overrides() from anon, public;
revoke execute on function public.create_shift_from_class_attendance() from anon, public;
revoke execute on function public.create_shifts_from_dropin() from anon, public;
revoke execute on function public.enrolments_default_price() from anon, public;
revoke execute on function public.ensure_trial_submission() from anon, public;
revoke execute on function public.infohub_pages_cascade_roles() from anon, public;
revoke execute on function public.infohub_pages_hierarchy() from anon, public;
revoke execute on function public.propagate_class_teacher_to_lessons() from anon, public;
revoke execute on function public.set_admin_role_on_insert() from anon, public;
revoke execute on function public.set_tutor_role_on_insert() from anon, public;
revoke execute on function public.sync_family_invoice_payment_method() from anon, public;
revoke execute on function public.sync_lesson_main_teacher() from anon, public;
