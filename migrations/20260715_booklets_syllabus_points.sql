-- Booklets created via the curriculum/master-DB modal record which syllabus
-- dotpoints they draw, so the syllabus page can mark them covered (the booklet
-- builder already does this via booklet_builds.syllabus_points).
alter table booklets add column if not exists syllabus_points jsonb;

-- Backfill: match existing booklet content lines to syllabus dotpoint texts
-- for the same subject + year.
with lines as (
  select b.id as booklet_id, b.subject, b.year, trim(l.line) as line
  from booklets b
  cross join lateral unnest(string_to_array(b.content, E'\n')) as l(line)
  where b.content is not null and b.syllabus_points is null
),
matched as (
  select li.booklet_id, d.id as dp_id
  from lines li
  join syllabus_modules m on m.subject = li.subject and m.year = li.year
  join syllabus_topics t on t.module_id = m.id
  join syllabus_dotpoints d on d.topic_id = t.id and trim(d.text) = li.line
),
agg as (
  select booklet_id, jsonb_agg(distinct dp_id) as pts
  from matched
  group by booklet_id
)
update booklets b
set syllabus_points = agg.pts
from agg
where b.id = agg.booklet_id;
