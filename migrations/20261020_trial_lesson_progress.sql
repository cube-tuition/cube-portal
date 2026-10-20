-- Trial stages follow the roll: "Trial 1/2 completed" / "Trial 2/2 completed".
--
-- A trial is two lessons. trial_completed now means 2/2 and a new stage,
-- trial_1_completed, means 1/2. A lesson counts once the tutor has marked the
-- student present (or late) with trial feedback — the same attendance the
-- feedback emails read. When such a roll is saved, the subject's submission
-- moves on by itself; it only ever moves forward, and a paused, enrolled or
-- declined enquiry is left alone. Each subject moves on its own (a student
-- trialling two subjects has one submission per subject).

alter table public.trial_submissions drop constraint if exists trial_submissions_status_check;
alter table public.trial_submissions add constraint trial_submissions_status_check
  check (status = any (array['new', 'contacted', 'trial_scheduled', 'trial_1_completed', 'trial_completed', 'on_hold', 'enrolled', 'declined']));

create or replace function public.attendance_trial_progress() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_done integer; v_target text;
begin
  if new.student_id is null or new.class_id is null then return new; end if;
  if new.status not in ('present', 'late') or coalesce(btrim(new.trial_feedback), '') = '' then return new; end if;
  select count(distinct a.session_date) into v_done from public.attendance a
   where a.student_id = new.student_id and a.class_id = new.class_id
     and a.status in ('present', 'late') and coalesce(btrim(a.trial_feedback), '') <> '';
  v_target := case when v_done >= 2 then 'trial_completed' else 'trial_1_completed' end;
  update public.trial_submissions ts set status = v_target
   where ts.converted_student_id = new.student_id
     and ts.status in ('new', 'contacted', 'trial_scheduled', 'trial_1_completed')
     and ts.status <> v_target
     and (ts.trial_class_id = new.class_id
          or (ts.trial_class_id is null
              and (select count(*) from public.trial_submissions x where x.converted_student_id = new.student_id) = 1));
  return new;
end $$;

drop trigger if exists attendance_trial_progress on public.attendance;
create trigger attendance_trial_progress after insert or update of status, trial_feedback on public.attendance
  for each row execute function public.attendance_trial_progress();

-- Trials already under way catch up now.
with done as (
  select a.student_id, a.class_id, count(distinct a.session_date) n
    from public.attendance a
   where a.status in ('present', 'late') and coalesce(btrim(a.trial_feedback), '') <> ''
   group by 1, 2
)
update public.trial_submissions ts
   set status = case when d.n >= 2 then 'trial_completed' else 'trial_1_completed' end
  from done d
 where d.student_id = ts.converted_student_id and d.class_id = ts.trial_class_id
   and ts.status in ('new', 'contacted', 'trial_scheduled', 'trial_1_completed')
   and ts.status <> case when d.n >= 2 then 'trial_completed' else 'trial_1_completed' end;
