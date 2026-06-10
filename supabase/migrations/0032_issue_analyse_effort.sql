-- Per-issue analyser effort. Lets a creator pick how thorough the analyser
-- should be when investigating THIS issue (set from the create-issue modal's
-- advanced settings, overridable per-run from the suggestions popover).
--
-- Stored on the issue so the choice survives the navigation to the issue's
-- detail page (where the first analysis auto-fires) and any later reload.
-- Null means "no per-issue choice" — the analyse call omits effort entirely
-- and the analyser falls back to the project default, then its own default.
-- Values mirror lib/analyser.ts AnalyseEffort (distinct from the indexing
-- effort): fast | medium | high | veryhigh.

alter table tracker.issues
    add column if not exists analyse_effort text;

alter table tracker.issues
    drop constraint if exists issues_analyse_effort_valid;
alter table tracker.issues
    add constraint issues_analyse_effort_valid
    check (analyse_effort is null or analyse_effort in ('fast', 'medium', 'high', 'veryhigh'));
