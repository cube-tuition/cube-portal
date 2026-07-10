-- generate_lessons_for_class was written against a plain UNIQUE (class_id, lesson_date)
-- constraint. The makeup-lessons feature replaced that with a PARTIAL unique index
-- (lessons_class_date_regular_idx: (class_id, lesson_date) WHERE is_makeup = false)
-- so a makeup lesson can share a date with the regular lesson. Postgres cannot
-- infer a partial index for ON CONFLICT unless the arbiter predicate is spelled
-- out, so the bare `ON CONFLICT (class_id, lesson_date)` now raises
--   42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
-- and lesson generation silently fails for every class (first hit when generating
-- Term 3, the first term rolled over after the makeup feature landed).
--
-- Fix: set is_makeup = false explicitly and add the matching WHERE predicate to
-- ON CONFLICT so the partial index is used.

CREATE OR REPLACE FUNCTION public.generate_lessons_for_class(p_class_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_class        classes%ROWTYPE;
  v_term         terms%ROWTYPE;
  v_cur          date;
  v_end          date;
  v_day_name     text;
  v_days         text[];
  v_inserted     integer := 0;
  v_week         integer;
  v_teacher_id   uuid;
BEGIN
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

  -- Resolve the main teacher's UUID once
  v_teacher_id := public.resolve_tutor_by_first_name(v_class.teacher);

  v_cur := v_term.start_date;
  v_end := v_term.end_date;

  WHILE v_cur <= v_end LOOP
    v_day_name := CASE EXTRACT(DOW FROM v_cur)
      WHEN 0 THEN 'Sunday'
      WHEN 1 THEN 'Monday'
      WHEN 2 THEN 'Tuesday'
      WHEN 3 THEN 'Wednesday'
      WHEN 4 THEN 'Thursday'
      WHEN 5 THEN 'Friday'
      WHEN 6 THEN 'Saturday'
    END;

    IF v_day_name = ANY(v_days) THEN
      v_week := FLOOR((v_cur - v_term.start_date)::numeric / 7)::integer + 1;

      INSERT INTO lessons (
        class_id, lesson_date, start_time, end_time, room, status, week,
        main_teacher, scheduled_teacher_id, is_makeup
      )
      VALUES (
        p_class_id, v_cur,
        v_class.start_time, v_class.end_time, v_class.room,
        'scheduled', v_week,
        v_class.teacher, v_teacher_id, false
      )
      ON CONFLICT (class_id, lesson_date) WHERE (is_makeup = false) DO NOTHING;

      v_inserted := v_inserted + 1;
    END IF;

    v_cur := v_cur + INTERVAL '1 day';
  END LOOP;

  RETURN v_inserted;
END;
$function$;
