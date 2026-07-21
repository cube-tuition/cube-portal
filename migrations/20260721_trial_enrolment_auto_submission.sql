-- A trial enrolment created (or flipped to trial) outside the trials page gets
-- an automatic pipeline entry, so trial_submissions and enrolments can't drift.
-- Skips students who already have a live submission (any status but 'enrolled')
-- or one already tied to this enrolment.
create or replace function ensure_trial_submission() returns trigger
language plpgsql security definer as $$
begin
  if new.status = 'trial'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not exists (
       select 1 from trial_submissions ts
       where ts.enrolment_id = new.id
          or (ts.converted_student_id = new.student_id and ts.status <> 'enrolled')
     )
  then
    insert into trial_submissions
      (submitted_at, student_name, student_year, status, source,
       trial_class_id, converted_student_id, enrolment_id, admin_notes)
    select now(), s.full_name, s.year,
           case when new.class_id is null then 'new' else 'trial_scheduled' end,
           'manual', new.class_id, new.student_id, new.id,
           'Auto-created: trial enrolment added outside the pipeline'
    from students s where s.id = new.student_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_enrolments_trial_submission on enrolments;
create trigger trg_enrolments_trial_submission
  after insert or update of status on enrolments
  for each row execute function ensure_trial_submission();
