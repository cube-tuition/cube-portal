-- ─────────────────────────────────────────────────────────────────────────────
-- CUBE Portal — Syllabus points (master syllabus dotpoint list)
-- (schema applied to production via MCP; Year 11 Chemistry seeded separately
--  from the NESA Stage 6 Chemistry syllabus via a JSON-driven DO block.)
--
-- Hierarchy: Subject + Year → Module → Topic (inquiry question) → Dotpoint →
-- Subdotpoint (a dotpoint with parent_id set). Booklets draw individual
-- dotpoints/subdotpoints from this master list via booklet_builds.syllabus_points.
-- `covered` is a shared coverage tick used by the Syllabus points checklist.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists syllabus_modules (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null,
  year        int  not null,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists syllabus_modules_subject_year_idx on syllabus_modules(subject, year);

create table if not exists syllabus_topics (
  id               uuid primary key default gen_random_uuid(),
  module_id        uuid not null references syllabus_modules(id) on delete cascade,
  name             text not null,
  inquiry_question text,
  sort_order       int  not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists syllabus_topics_module_idx on syllabus_topics(module_id);

create table if not exists syllabus_dotpoints (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid not null references syllabus_topics(id) on delete cascade,
  parent_id   uuid references syllabus_dotpoints(id) on delete cascade,
  text        text not null,
  sort_order  int  not null default 0,
  covered     boolean not null default false,
  covered_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists syllabus_dotpoints_topic_idx  on syllabus_dotpoints(topic_id);
create index if not exists syllabus_dotpoints_parent_idx on syllabus_dotpoints(parent_id);

alter table booklet_builds add column if not exists syllabus_points jsonb not null default '[]'::jsonb;

do $$
declare t text;
begin
  foreach t in array array['syllabus_modules','syllabus_topics','syllabus_dotpoints'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;
