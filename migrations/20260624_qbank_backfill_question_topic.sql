-- ─────────────────────────────────────────────────────────────────────────────
-- CUBE Portal — Backfill qbank_questions.topic_id
-- (already applied to production via MCP)
--
-- Some questions were tagged only via skill_id / subtopic_id, leaving the
-- denormalised topic_id null. The exam marking view resolves topic from
-- topic_id, so those questions showed as "Uncategorised" even though they have
-- a topic in the bank. Populate topic_id from the subtopic (preferred) or skill.
--
-- (The exam loader in lib/examMarking.js was also updated to resolve topic via
-- subtopic/skill, so this is belt-and-braces for any future gaps.)
-- ─────────────────────────────────────────────────────────────────────────────

update qbank_questions q
set topic_id = st.topic_id
from qbank_subtopics st
where q.subtopic_id = st.id and q.topic_id is null;

update qbank_questions q
set topic_id = sk.topic_id
from qbank_skills sk
where q.skill_id = sk.id and q.topic_id is null;
