-- Portal-hosted forms: every form families fill in (holiday sign-ups,
-- enrolments, …) with a public URL at /forms/<slug>, and their submissions.
-- Definitions are edited on /tutor/admin/forms; the public page and the submit
-- route read and write through the service role, so RLS only needs staff.
create table if not exists public.forms (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null default 'Untitled form',
  description   text not null default '',
  fields        jsonb not null default '[]'::jsonb,   -- [{key,label,type,required,placeholder,options[]}]
  confirmation  text not null default 'Thank you — we have received your form and will be in touch shortly.',
  notify_email  text,                                 -- where new submissions are emailed (null = admin inbox)
  active        boolean not null default true,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.form_submissions (
  id            uuid primary key default gen_random_uuid(),
  form_id       uuid not null references public.forms(id) on delete cascade,
  data          jsonb not null default '{}'::jsonb,   -- {field key: value}
  status        text not null default 'new',          -- new | handled
  submitted_at  timestamptz not null default now()
);
create index if not exists form_submissions_form_idx on public.form_submissions(form_id, submitted_at desc);

alter table public.forms enable row level security;
drop policy if exists staff_all on public.forms;
create policy staff_all on public.forms for all to authenticated using (public.is_staff()) with check (public.is_staff());
alter table public.form_submissions enable row level security;
drop policy if exists staff_all on public.form_submissions;
create policy staff_all on public.form_submissions for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Starter forms.
insert into public.forms (slug, title, description, fields, created_by) values
('holiday-course-signup', 'Holiday Course Sign-up',
 'Reserve a place in a CUBE holiday course. We will confirm your booking and send payment details by email.',
 '[{"key":"parent_name","label":"Parent / guardian name","type":"text","required":true},
   {"key":"parent_email","label":"Parent email","type":"email","required":true},
   {"key":"parent_phone","label":"Parent mobile","type":"tel","required":true},
   {"key":"student_name","label":"Student name","type":"text","required":true},
   {"key":"student_year","label":"Student year level (this year)","type":"select","required":true,"options":["Year 3","Year 4","Year 5","Year 6","Year 7","Year 8","Year 9","Year 10","Year 11","Year 12"]},
   {"key":"school","label":"School","type":"text","required":false},
   {"key":"subjects","label":"Which course(s)?","type":"checkboxes","required":true,"options":["Mathematics","English"]},
   {"key":"payment","label":"Preferred payment method","type":"radio","required":true,"options":["Bank transfer","Cash"]},
   {"key":"notes","label":"Anything we should know?","type":"textarea","required":false,"placeholder":"Allergies, pick-up arrangements, questions…"}]'::jsonb,
 'Claude'),
('enrolment', 'Enrolment Form',
 'Enrol a student at CUBE Tuition for the coming term. We will confirm the class and send an invoice.',
 '[{"key":"parent_name","label":"Parent / guardian name","type":"text","required":true},
   {"key":"parent_email","label":"Parent email","type":"email","required":true},
   {"key":"parent_phone","label":"Parent mobile","type":"tel","required":true},
   {"key":"student_name","label":"Student name","type":"text","required":true},
   {"key":"student_year","label":"Student year level (this year)","type":"select","required":true,"options":["Year 3","Year 4","Year 5","Year 6","Year 7","Year 8","Year 9","Year 10","Year 11","Year 12"]},
   {"key":"school","label":"School","type":"text","required":true},
   {"key":"subjects","label":"Subjects","type":"checkboxes","required":true,"options":["Mathematics","English","Chemistry","Physics","Science"]},
   {"key":"how_heard","label":"How did you hear about CUBE?","type":"select","required":false,"options":["Friend or family","Google","Social media","School","Other"]},
   {"key":"notes","label":"Anything else?","type":"textarea","required":false}]'::jsonb,
 'Claude')
on conflict (slug) do nothing;
