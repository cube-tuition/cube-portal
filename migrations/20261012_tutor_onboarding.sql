-- Tutor onboarding — Admin → Staff → Onboarding.
--
-- A director sends a newly hired tutor the onboarding pack: the Employment
-- Agreement, the Child Safety Code of Conduct and the Onboarding Document
-- (templates in the private 'onboarding' bucket, replaceable from the page),
-- plus a Pay Rates PDF built from their rates. The email carries a private
-- link (/onboarding/<token>, no login) where the tutor uploads the 6 documents
-- back; files go straight into the private bucket via signed upload URLs and
-- tick off on the director's checklist.
--
-- status: draft (tutor record made, pack not sent) → sent → submitted (all six
-- documents in) → complete (a director has checked them).
--
-- Everything is directors-only: the tables via RLS (is_admin — directors sign
-- in as 'admin'), the files via a private bucket read only through signed URLs
-- from the server. The tutor's page never touches the tables directly; it goes
-- through /api/onboarding/<token>, which looks the token up with the service
-- role. The token is 32 random bytes, so the link itself is the credential.
create table if not exists public.tutor_onboarding (
  id             uuid primary key default gen_random_uuid(),
  tutor_id       uuid references public.tutors(id) on delete set null,
  full_name      text not null,
  email          text not null,
  start_date     date,
  note           text,                      -- personal line added to the email
  token          text not null unique,
  status         text not null default 'draft'
                 check (status in ('draft','sent','submitted','complete')),
  sent_at        timestamptz,
  sent_count     integer not null default 0,
  sent_by_name   text,
  submitted_at   timestamptz,
  completed_at   timestamptz,
  completed_by_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists tutor_onboarding_status_idx on public.tutor_onboarding (status, created_at desc);

create table if not exists public.tutor_onboarding_files (
  id             uuid primary key default gen_random_uuid(),
  onboarding_id  uuid not null references public.tutor_onboarding(id) on delete cascade,
  doc_key        text not null check (doc_key in ('agreement','code','onboarding','super_choice','super_letter','tfn')),
  storage_path   text not null,
  filename       text not null,
  size_bytes     integer,
  uploaded_at    timestamptz not null default now(),
  unique (onboarding_id, doc_key)           -- one current file per document; re-uploading replaces it
);

alter table public.tutor_onboarding enable row level security;
alter table public.tutor_onboarding_files enable row level security;
drop policy if exists directors_all on public.tutor_onboarding;
create policy directors_all on public.tutor_onboarding for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists directors_all on public.tutor_onboarding_files;
create policy directors_all on public.tutor_onboarding_files for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

comment on table public.tutor_onboarding is 'Onboarding packs sent to new tutors, with the private upload-link token.';
comment on table public.tutor_onboarding_files is 'The documents a new tutor uploaded back (one per doc_key), stored in the private onboarding bucket.';

-- Private bucket: templates/ (the pack) and submissions/<onboarding id>/ (uploads).
insert into storage.buckets (id, name, public, file_size_limit)
values ('onboarding', 'onboarding', false, 20971520)
on conflict (id) do nothing;
