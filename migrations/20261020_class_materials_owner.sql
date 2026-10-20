-- Which director prepares each class's materials — the Materials section on
-- the Operations page (/tutor/admin/work). Classes are per-term rows; the
-- transition wizard copies every column, so the owner rolls into the next term.
alter table classes add column if not exists materials_owner text check (materials_owner in ('Ryan', 'Aiden'));
comment on column classes.materials_owner is 'Which director prepares this class''s materials (Operations page). Copied to the next term by the transition wizard.';
