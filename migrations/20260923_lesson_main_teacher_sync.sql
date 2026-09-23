-- lessons.main_teacher is a copy of classes.teacher, kept on the lesson so the
-- session page and payroll can tell the regular teacher from a substitute
-- (scheduled_teacher_id). It was only written when a lesson was created, so
-- when a class changed hands the old name lingered and every lesson looked
-- like a sub was covering (Y10 Maths showed "Sub: Aiden Kim" all term).
--
-- Now derived, both ways: a lesson takes its class's teacher when inserted or
-- re-pointed at a class, and changing a class's teacher rewrites the name on
-- every one of its lessons. Lessons without a class (level tests, drop-ins)
-- are untouched.

create or replace function public.sync_lesson_main_teacher()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if new.class_id is not null then
    select teacher into new.main_teacher from public.classes where id = new.class_id;
  end if;
  return new;
end $$;

drop trigger if exists lessons_sync_main_teacher on public.lessons;
create trigger lessons_sync_main_teacher
  before insert or update of class_id, main_teacher on public.lessons
  for each row execute function public.sync_lesson_main_teacher();

create or replace function public.propagate_class_teacher_to_lessons()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  update public.lessons set main_teacher = new.teacher
   where class_id = new.id and main_teacher is distinct from new.teacher;
  return new;
end $$;

drop trigger if exists classes_teacher_change_syncs_lessons on public.classes;
create trigger classes_teacher_change_syncs_lessons
  after update of teacher on public.classes
  for each row when (new.teacher is distinct from old.teacher)
  execute function public.propagate_class_teacher_to_lessons();

-- Backfill: every lesson now carries its class's current teacher.
update public.lessons l set main_teacher = c.teacher
  from public.classes c
 where l.class_id = c.id and l.main_teacher is distinct from c.teacher;
