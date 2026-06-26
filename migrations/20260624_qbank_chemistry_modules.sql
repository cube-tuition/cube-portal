-- Chemistry uses "Modules" instead of topics: Year 11 → Modules 1-4,
-- Year 12 → Modules 5-8. Seed them as qbank_topics for the Chemistry subjects.
-- (subject ids are the Chemistry Year 11 / Year 12 rows.)
insert into qbank_topics (subject_id, name, sort_order, active)
select s.id, m.name, m.sort_order, true
from qbank_subjects s
join (values
  (11, 'Module 1', 1), (11, 'Module 2', 2), (11, 'Module 3', 3), (11, 'Module 4', 4),
  (12, 'Module 5', 5), (12, 'Module 6', 6), (12, 'Module 7', 7), (12, 'Module 8', 8)
) as m(year_level, name, sort_order) on m.year_level = s.year_level
where s.name = 'Chemistry'
  and not exists (
    select 1 from qbank_topics t where t.subject_id = s.id and t.name = m.name
  );
