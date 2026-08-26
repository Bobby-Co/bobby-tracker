-- 0093_fill_team_id_on_update.sql — repair the denormalised team_id, and stop it
-- going null again.
--
-- ─── The bug ─────────────────────────────────────────────────────────────────
--
-- The analyser skips billing when it cannot find an owning team:
--
--     prowl: no team for usage; skipping  kind=index project_id=54e7fd7d-…
--
-- It resolves the tenant by reading tracker.project_analyser.team_id, which is
-- denormalised from projects.team_id (0052). That column is populated by the
-- fill trigger from 0005 — and that trigger is BEFORE INSERT only.
--
-- So team_id is decided ONCE, at the instant the analyser row is first written,
-- from whatever projects.team_id happens to be at that moment. 0052 backfilled
-- every row that existed then, so this is not about old data: a project whose
-- analyser row is created before its team is assigned gets NULL written once,
-- and nothing ever repairs it. Every later write is an UPDATE — markIndexing
-- upserts, the analyser PATCHes progress and terminal state — and an
-- insert-only trigger does not fire on any of them.
--
-- The result is a project that indexes, re-indexes and analyses for as long as
-- it lives, and is billed for none of it. Silently: the skip is logged at INFO
-- because "no owning team" was meant to describe a deleted project, not a live
-- one.
--
-- ─── The fix ─────────────────────────────────────────────────────────────────
--
-- Fill on UPDATE as well as INSERT. The function already only writes when the
-- column is NULL, so this cannot overwrite a real value, and it makes the row
-- self-healing: the next status change repairs it without anyone noticing.
--
-- That is preferable to teaching each writer to send team_id. There are three —
-- the tracker's upsert, the analyser's PostgREST PATCH, and the webhook path —
-- and the one that matters most (the analyser) cannot know it. A single trigger
-- is one place to be right instead of three places to remember.
--
-- issue_suggestions has the identical trigger and the identical hole, so it is
-- fixed here too rather than waiting to be found the same way.

-- ─── project_analyser ───────────────────────────────────────────────────────
-- The function is unchanged from 0052 (fills user_id and team_id, only when
-- null); repeated here so this migration is self-contained if replayed.
create or replace function tracker.fill_project_analyser_user_id()
returns trigger language plpgsql security definer set search_path = tracker, pg_temp as $$
begin
    if new.user_id is null then
        select p.user_id into new.user_id from tracker.projects p where p.id = new.project_id;
    end if;
    if new.team_id is null then
        select p.team_id into new.team_id from tracker.projects p where p.id = new.project_id;
    end if;
    return new;
end $$;

drop trigger if exists fill_user_id on tracker.project_analyser;
create trigger fill_user_id
    before insert or update on tracker.project_analyser
    for each row execute function tracker.fill_project_analyser_user_id();

-- ─── issue_suggestions ──────────────────────────────────────────────────────
create or replace function tracker.fill_issue_suggestion_user_id()
returns trigger language plpgsql security definer set search_path = tracker, pg_temp as $$
begin
    if new.user_id is null then
        select p.user_id into new.user_id
        from tracker.issues i join tracker.projects p on p.id = i.project_id
        where i.id = new.issue_id;
    end if;
    if new.team_id is null then
        select p.team_id into new.team_id
        from tracker.issues i join tracker.projects p on p.id = i.project_id
        where i.id = new.issue_id;
    end if;
    return new;
end $$;

drop trigger if exists fill_user_id on tracker.issue_suggestions;
create trigger fill_user_id
    before insert or update on tracker.issue_suggestions
    for each row execute function tracker.fill_issue_suggestion_user_id();

-- ─── repair what is already null ────────────────────────────────────────────
-- Idempotent, and only touches rows whose project actually has a team: a
-- project with no team of its own is a different problem and must not be given
-- someone else's.
update tracker.project_analyser pa
    set team_id = p.team_id
    from tracker.projects p
    where pa.project_id = p.id and pa.team_id is null and p.team_id is not null;

update tracker.project_analyser pa
    set user_id = p.user_id
    from tracker.projects p
    where pa.project_id = p.id and pa.user_id is null and p.user_id is not null;

update tracker.issue_suggestions su
    set team_id = p.team_id
    from tracker.issues i join tracker.projects p on p.id = i.project_id
    where su.issue_id = i.id and su.team_id is null and p.team_id is not null;

comment on column tracker.project_analyser.team_id is
    'Denormalised from projects.team_id. Filled by the fill_user_id trigger on '
    'INSERT and UPDATE — update matters because the analyser resolves billing '
    'through this column, and a row first written before the project had a team '
    'would otherwise stay unbilled for the life of the project.';
