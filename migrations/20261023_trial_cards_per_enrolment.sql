-- A trial enrolment drives ITS OWN pipeline card — never another subject's.
--
-- William (Year 5) enquired in July about English, enrolled in it, and that
-- enquiry was closed as Enrolled. In October he started a Maths trial. Marking
-- the Maths enrolment as a trial:
--   1. sync_enrolment_to_trial_submission matched his July English enquiry —
--      its fallback took "the student has only one enquiry" as a match, whatever
--      enrolment that enquiry belonged to — and moved it back to Trial
--      scheduled;
--   2. ensure_trial_submission then saw the student already had an open card,
--      so no Maths card was made.
-- The pipeline showed the old English form instead of the Maths trial.
--
-- Now:
--   - the status sync touches the enquiry linked to THIS enrolment, or — for
--     old enquiries never linked to an enrolment — the one matching its class,
--     or the student's only enquiry when it is unlinked;
--   - a trial enrolment gets its own card unless one is linked to it already,
--     or an unlinked open enquiry for the student is waiting to be linked (the
--     pipeline's own "assign class" flow creates the enrolment first, then links
--     it). The new card takes the family's details from the student's latest
--     enquiry, else their guardian, so its emails can be sent.

create or replace function public.sync_enrolment_to_trial_submission()
 returns trigger
 language plpgsql
as $function$
declare
  mapped_status text;
begin
  mapped_status := case new.status
    when 'active'         then 'enrolled'
    when 'disenrol'       then 'declined'
    when 'trial complete' then 'trial_completed'
    when 'trial'          then 'trial_scheduled'
    else null
  end;

  if mapped_status is null then return new; end if;
  if mapped_status = 'declined' and new.end_reason = 'Trial on hold' then return new; end if;

  update trial_submissions ts
     set status = mapped_status
   where ts.converted_student_id = new.student_id
     and (
       ts.enrolment_id = new.id
       or (ts.enrolment_id is null and (
             ts.trial_class_id is not distinct from new.class_id
             or (select count(*) from trial_submissions x where x.converted_student_id = new.student_id) = 1))
     );

  return new;
end;
$function$;

create or replace function public.ensure_trial_submission()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.status = 'trial'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not exists (
       select 1 from trial_submissions ts
        where ts.enrolment_id = new.id
           or (ts.converted_student_id = new.student_id and ts.enrolment_id is null
               and ts.status not in ('enrolled', 'declined'))
     )
  then
    insert into trial_submissions
      (submitted_at, student_name, student_year, subjects, status, source,
       trial_class_id, converted_student_id, enrolment_id, admin_notes,
       parent_name, parent_email, parent_phone, relationship, school, how_heard)
    select now(), s.full_name, s.year,
           -- the subject from the class name: "Y5 Maths" → Maths
           case when c.class_name is not null then array[regexp_replace(c.class_name, '^Y[0-9]+\s+', '')] end,
           case when new.class_id is null then 'new' else 'trial_scheduled' end,
           'manual', new.class_id, new.student_id, new.id,
           'Auto-created: trial enrolment added outside the pipeline',
           coalesce(prev.parent_name, g.full_name), coalesce(prev.parent_email, g.email),
           coalesce(prev.parent_phone, g.phone), prev.relationship, coalesce(prev.school, s.school), prev.how_heard
      from students s
      left join classes c on c.id = new.class_id
      left join lateral (
        select * from trial_submissions p where p.converted_student_id = s.id
         order by (p.parent_email is not null) desc, p.submitted_at desc limit 1
      ) prev on true
      left join lateral (
        select * from guardians gg where gg.student_id = s.id
         order by (gg.email is not null) desc limit 1
      ) g on true
     where s.id = new.student_id;
  end if;
  return new;
end $function$;

-- Both triggers are now covered by tests/trialCards.db.test.mjs.
insert into public.test_snapshot_objects (kind, name, ord)
select v.kind, v.name, coalesce((select max(ord) from public.test_snapshot_objects o where o.kind = v.kind), 0) + v.n
  from (values ('function', 'sync_enrolment_to_trial_submission', 1), ('function', 'ensure_trial_submission', 2),
               ('trigger', 'enrolment_status_sync', 1), ('trigger', 'trg_enrolments_trial_submission', 2)) v(kind, name, n)
 where not exists (select 1 from public.test_snapshot_objects o where o.kind = v.kind and o.name = v.name);
