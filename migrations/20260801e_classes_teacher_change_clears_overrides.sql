-- Payroll follows lessons.scheduled_teacher_id when set (the substitute
-- override), falling back to the class's teacher. Term seeding stamped that
-- override onto EVERY lesson with the teacher of the day, so renaming the
-- teacher on the class silently kept paying the old one — Kevin Park's Ext 1
-- shifts landed on Aiden Kim (and vice versa for Y10 Maths) after the two
-- swapped classes.
--
-- When a class's teacher changes, clear any lesson override that merely
-- repeats the OLD teacher (a seeded default). An override pointing at anyone
-- else is a genuine sub assignment and is kept.
create or replace function public.clear_stale_lesson_teacher_overrides()
returns trigger language plpgsql security definer as $$
begin
  update public.lessons
     set scheduled_teacher_id = null
   where class_id = new.id
     and is_makeup = false
     and scheduled_teacher_id = public.resolve_tutor_by_first_name(old.teacher);
  return new;
end $$;

drop trigger if exists classes_teacher_change_clears_overrides on public.classes;
create trigger classes_teacher_change_clears_overrides
after update of teacher on public.classes
for each row when (new.teacher is distinct from old.teacher)
execute function public.clear_stale_lesson_teacher_overrides();
