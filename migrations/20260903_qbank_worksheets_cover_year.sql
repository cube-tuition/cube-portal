-- Cover year override for an AQ worksheet. Null = derived (the filing
-- topic's year, else the first question's); set when a sheet spans years.
alter table public.qbank_worksheets add column if not exists cover_year integer;
