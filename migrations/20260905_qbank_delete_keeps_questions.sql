-- Deleting a topic or subtopic in the Question Bank must keep the questions and
-- simply leave them untagged.
--
-- qbank_questions.topic_id and .subtopic_id were already ON DELETE SET NULL, so
-- a question already survived its topic. But deleting a topic CASCADES to the
-- skills under it (qbank_skills.topic_id), and qbank_questions.skill_id was
-- ON DELETE RESTRICT — so the moment any question was tagged to a skill in that
-- topic, the whole delete failed:
--
--   update or delete on table "qbank_skills" violates foreign key constraint
--   "qbank_questions_skill_id_fkey" on table "qbank_questions"
--
-- The column is already nullable and the app already treats a null skill as
-- "not tagged yet", so SET NULL matches both the schema and the intent: the
-- taxonomy row goes, the question stays and loses that one tag.
alter table public.qbank_questions
  drop constraint qbank_questions_skill_id_fkey;

alter table public.qbank_questions
  add constraint qbank_questions_skill_id_fkey
  foreign key (skill_id) references public.qbank_skills(id) on delete set null;
