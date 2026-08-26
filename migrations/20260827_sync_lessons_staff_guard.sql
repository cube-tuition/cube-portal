-- sync_lessons_for_class: restrict to staff.
--
-- This is a SECURITY DEFINER function that inserts, updates AND DELETES rows in
-- public.lessons. It had no internal authorisation check and was executable over
-- PostgREST by `anon` and by any `authenticated` user — and `authenticated`
-- includes students. An unauthenticated caller could therefore re-sync (and
-- delete) a class's future lessons just by knowing a class id.
--
-- Grants alone can't fix it: the staff database explorer calls this RPC as an
-- ordinary authenticated user, so revoking `authenticated` would break that
-- page. The check has to live inside the function.
--
-- Body is otherwise byte-for-byte the deployed definition; only the guard is
-- added. search_path stays pinned (see 20260707_pin_function_search_path.sql).
--
-- NOTE: is_staff() is false under the service-role key (a service-role JWT has
-- no app_metadata.role and auth.uid() is null). No server-side route calls this
-- RPC today; if one is ever added it must bypass PostgREST or be exempted here.

CREATE OR REPLACE FUNCTION public.sync_lessons_for_class(p_class_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_class      classes%ROWTYPE;
  v_term       terms%ROWTYPE;
  v_days       text[];
  v_teacher_id uuid;
  v_today      date := current_date;
  v_desired    date[];
  v_inserted   integer := 0;
  v_updated    integer := 0;
  v_deleted    integer := 0;
  v_protected  integer := 0;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'forbidden: staff only';
  END IF;

  SELECT * INTO v_class FROM classes WHERE id = p_class_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class % not found', p_class_id; END IF;

  SELECT * INTO v_term FROM terms WHERE id = v_class.term_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No term linked to class %', p_class_id; END IF;

  SELECT ARRAY(
    SELECT TRIM(d)
    FROM unnest(string_to_array(v_class.day_of_week, ',')) AS d
    WHERE TRIM(d) <> ''
  ) INTO v_days;
  IF array_length(v_days, 1) IS NULL THEN
    RAISE EXCEPTION 'Class % has no day_of_week set', p_class_id;
  END IF;

  v_teacher_id := public.resolve_tutor_by_first_name(v_class.teacher);

  SELECT ARRAY(
    SELECT d::date
    FROM generate_series(v_term.start_date, v_term.end_date, interval '1 day') AS d
    WHERE (CASE EXTRACT(DOW FROM d)
             WHEN 0 THEN 'Sunday'    WHEN 1 THEN 'Monday'   WHEN 2 THEN 'Tuesday'
             WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday'
             WHEN 6 THEN 'Saturday'
           END) = ANY (v_days)
      AND d::date >= v_today
  ) INTO v_desired;

  WITH ins AS (
    INSERT INTO lessons (
      class_id, lesson_date, start_time, end_time, room, status, week,
      main_teacher, scheduled_teacher_id, is_makeup
    )
    SELECT p_class_id, d,
           v_class.start_time, v_class.end_time, v_class.room, 'scheduled',
           FLOOR((d - v_term.start_date)::numeric / 7)::int + 1,
           v_class.teacher, v_teacher_id, false
    FROM unnest(v_desired) AS d
    ON CONFLICT (class_id, lesson_date) WHERE (is_makeup = false) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  WITH upd AS (
    UPDATE lessons l
    SET start_time = v_class.start_time,
        end_time   = v_class.end_time,
        room       = v_class.room,
        week       = FLOOR((l.lesson_date - v_term.start_date)::numeric / 7)::int + 1
    WHERE l.class_id = p_class_id
      AND l.is_makeup = false
      AND (l.lesson_type IS NULL OR l.lesson_type = 'class')
      AND l.lesson_date >= v_today
      AND l.status <> 'cancelled'
      AND l.lesson_date = ANY (v_desired)
      AND (l.start_time IS DISTINCT FROM v_class.start_time
        OR l.end_time   IS DISTINCT FROM v_class.end_time
        OR l.room       IS DISTINCT FROM v_class.room
        OR l.week       IS DISTINCT FROM FLOOR((l.lesson_date - v_term.start_date)::numeric / 7)::int + 1)
    RETURNING 1
  )
  SELECT count(*) INTO v_updated FROM upd;

  IF array_length(v_desired, 1) IS NOT NULL THEN
    WITH del AS (
      DELETE FROM lessons l
      WHERE l.class_id = p_class_id
        AND l.is_makeup = false
        AND (l.lesson_type IS NULL OR l.lesson_type = 'class')
        AND l.lesson_date >= v_today
        AND l.status <> 'cancelled'
        AND NOT (l.lesson_date = ANY (v_desired))
        AND NOT EXISTS (SELECT 1 FROM attendance a
                        WHERE a.class_id = p_class_id AND a.session_date = l.lesson_date)
        AND NOT EXISTS (SELECT 1 FROM lessons m WHERE m.makeup_source_lesson_id = l.id)
        AND l.notes IS NULL AND l.notes_general IS NULL
        AND l.notes_workbook IS NULL AND l.notes_homework IS NULL
        AND COALESCE(l.has_rq, false) = false
      RETURNING 1
    )
    SELECT count(*) INTO v_deleted FROM del;

    SELECT count(*) INTO v_protected
    FROM lessons l
    WHERE l.class_id = p_class_id
      AND l.is_makeup = false
      AND (l.lesson_type IS NULL OR l.lesson_type = 'class')
      AND l.lesson_date >= v_today
      AND NOT (l.lesson_date = ANY (v_desired))
      AND (
        l.status = 'cancelled'
        OR EXISTS (SELECT 1 FROM attendance a
                   WHERE a.class_id = p_class_id AND a.session_date = l.lesson_date)
        OR EXISTS (SELECT 1 FROM lessons m WHERE m.makeup_source_lesson_id = l.id)
        OR l.notes IS NOT NULL OR l.notes_general IS NOT NULL
        OR l.notes_workbook IS NOT NULL OR l.notes_homework IS NOT NULL
        OR COALESCE(l.has_rq, false) = true
      );
  END IF;

  RETURN jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated,
    'deleted', v_deleted, 'protected', v_protected
  );
END;
$function$;
