-- 0072_project_duplicate_sensitivity.sql — per-project duplicate sensitivity.
--
-- How similar two issues must be before we call one a likely duplicate of the
-- other. There is no correct value: a project filing terse, templated bug
-- reports has a very different similarity distribution from one filing long
-- prose, so the same cosine number means different things in each. It belongs to
-- the project, not to the codebase.
--
-- Stored as a NAME, not a number. The names are the product surface and the
-- numbers are a tuning detail — leaving the mapping in code means it can be
-- retuned (a new embedding model shifts every distribution) without a migration
-- and without rewriting rows whose stored number would silently change meaning.
--
-- Values, and note the inversion that makes this worth reading twice: LOW
-- sensitivity means a HIGH threshold. Low is fussy and flags almost nothing;
-- veryhigh is eager and will flag things that merely rhyme.
--
--     low      0.90    only near-identical
--     medium   0.80    the default
--     high     0.70    more matches, some wrong
--     veryhigh 0.65    noticeably more false positives
--
-- CHECK rather than an enum: adding a level to an enum needs ALTER TYPE and a
-- deploy ordering dance, while this is one migration and matches how the rest of
-- the schema treats small closed sets (see the region/cell format constraints).

alter table tracker.projects
    add column if not exists duplicate_sensitivity text not null default 'medium';

do $$ begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'projects_duplicate_sensitivity_valid'
          and conrelid = 'tracker.projects'::regclass
    ) then
        alter table tracker.projects
            add constraint projects_duplicate_sensitivity_valid
            check (duplicate_sensitivity in ('low', 'medium', 'high', 'veryhigh'));
    end if;
end $$;

comment on column tracker.projects.duplicate_sensitivity is
    'How eagerly to flag an issue as a likely duplicate. Names, not numbers — the '
    'cosine thresholds live in modules/issues/domain/DuplicateSensitivity.ts so they '
    'can be retuned without a migration. NOTE the inversion: low sensitivity = high '
    'threshold = fewer matches.';
