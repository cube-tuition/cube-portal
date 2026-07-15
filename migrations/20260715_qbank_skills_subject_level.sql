-- Skills are a subject-level dimension: they belong to a subject directly,
-- independent of topics and subtopics.
alter table qbank_skills add column if not exists subject_id uuid references qbank_subjects(id) on delete cascade;
alter table qbank_skills alter column topic_id drop not null;

-- Backfill existing skills' subject from their topic.
update qbank_skills s
set subject_id = t.subject_id
from qbank_topics t
where s.topic_id = t.id and s.subject_id is null;
