-- guardians.student_id was free text with no FK, so deleting a student left
-- orphaned guardian rows ("not linked to any student" on the quality page).
-- Remove the one existing orphan, convert the column to uuid, and add a real
-- foreign key with ON DELETE CASCADE so guardian rows follow their student.

-- 1. Remove orphaned guardians (student no longer exists)
delete from public.guardians g
where g.student_id is not null
  and not exists (select 1 from public.students s where s.id::text = g.student_id);

-- 2. Convert text → uuid
alter table public.guardians
  alter column student_id type uuid using nullif(student_id, '')::uuid;

-- 3. Real foreign key: deleting a student removes its guardian rows
alter table public.guardians
  add constraint guardians_student_id_fkey
  foreign key (student_id) references public.students(id) on delete cascade;

create index if not exists guardians_student_id_idx on public.guardians(student_id);
