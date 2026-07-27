-- Two-column layout preference for library texts. When set, the stimulus
-- renders its stanzas across two columns (good for long poems). Carried into a
-- booklet's stimulus block as `twoCol` when the text is picked from the library.
alter table public.stimulus_texts add column if not exists two_col boolean not null default false;
