-- Per-workbook readiness status shown in the workbooks master database.
alter table booklets add column if not exists status text not null default 'Not Started'
  check (status in ('Complete', 'Needs Improvement', 'In Progress', 'Not Started'));
