-- Texts/Stimuli library for English materials: reusable passages (poems,
-- extracts, articles) with their attribution, browsable from the English hub.
create table if not exists stimulus_texts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source text,                 -- author / origin, e.g. "Langston Hughes, 1922"
  text_type text not null default 'Poem',
  year int,                    -- intended year level (nullable = any)
  body text not null default '',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table stimulus_texts enable row level security;
create policy staff_all on stimulus_texts for all to authenticated using (true) with check (true);
