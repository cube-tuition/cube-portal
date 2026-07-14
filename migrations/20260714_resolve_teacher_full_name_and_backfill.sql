-- resolve_tutor_by_first_name only matched staff by FIRST name, so classes
-- whose teacher field holds a full name ("Kevin Park", "Sally Kang") resolved
-- to nothing and their generated lessons had no scheduled teacher. Match the
-- full name too (exact full-name match wins over a first-name match).
CREATE OR REPLACE FUNCTION public.resolve_tutor_by_first_name(p_name text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
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
$function$;

-- Backfill: lessons with no scheduled teacher default to the class's main
-- teacher (existing assignments/subs untouched).
UPDATE public.lessons l
SET scheduled_teacher_id = public.resolve_tutor_by_first_name(c.teacher),
    main_teacher         = coalesce(l.main_teacher, c.teacher)
FROM public.classes c
WHERE c.id = l.class_id
  AND l.scheduled_teacher_id IS NULL
  AND c.teacher IS NOT NULL
  AND public.resolve_tutor_by_first_name(c.teacher) IS NOT NULL;
