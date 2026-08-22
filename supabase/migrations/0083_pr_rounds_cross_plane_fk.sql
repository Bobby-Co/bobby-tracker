-- 0083_pr_rounds_cross_plane_fk.sql — drop the round table's foreign key to
-- `projects` on a REGIONAL node, where that table is permanently empty.
--
-- ─── The bug ─────────────────────────────────────────────────────────────────
--
-- 0080 created tracker.pull_request_analysis_rounds with
--
--     project_id uuid not null references tracker.projects (id) on delete cascade
--
-- which is correct on the primary and impossible on a regional data-plane node.
-- `projects` is CONTROL-plane: it lives centrally because four queries enumerate
-- a TEAM's worth of projects and a regional copy would silently return a subset.
-- So on a regional node that table is empty by design, and a foreign key into it
-- rejects the first row anyone writes:
--
--     23503: insert or update on table "pull_request_analysis_rounds" violates
--            foreign key constraint "pull_request_analysis_rounds_project_id_fkey"
--     DETAIL: Key (project_id)=(72e5a1c5-…) is not present in table "projects".
--
-- scripts/migration-replay/regional-node-setup.sql exists precisely to sever
-- these twelve cross-plane keys at provisioning time, and it already lists
-- `pull_request_analyses_project_id_fkey` — the sibling table, one FK away. It
-- predates 0080, so it never learned about the rounds table, and 0080 did not
-- think to add itself to it.
--
-- 0079 got this exactly right for a different column and wrote down why:
-- "the two tables need not share a database … A cross-plane foreign key is not
-- expressible, so the id here is a reference by value." 0080 had the same
-- constraint and reached for `references` anyway.
--
-- ─── What it looked like ─────────────────────────────────────────────────────
--
-- Silent. appendRound discarded the insert error, so no round was ever recorded
-- on any regional project. listRounds then returned [] — which the scope decision
-- reads as "first review of this pull request" — so every re-review scoped
-- itself FULL and carried nothing, while reporting a completed review with a
-- scope and a reason. Four rounds on one merge request, zero rows, no error
-- anywhere. Incremental review could not have worked on a regional project, and
-- nothing said so.
--
-- ─── Why this is conditional ─────────────────────────────────────────────────
--
-- The key is CORRECT on the primary — `projects` is right there and the cascade
-- does real work. Dropping it everywhere would trade a regional bug for a
-- central one. Regional nodes identify themselves in tracker.app_config
-- (`plane` = `data`), set by regional-node-setup.sql, so this migration can be
-- applied to every database and act only where it should.
--
-- The purge that replaces the cascade regionally lives in
-- SupabaseProjectContentPurge; this migration ships alongside the change that
-- adds the rounds table to it.

do $$
declare
    is_regional boolean := false;
begin
    if to_regclass('tracker.app_config') is not null then
        select coalesce((select value = 'data' from tracker.app_config where key = 'plane'), false)
          into is_regional;
    end if;

    if not is_regional then
        raise notice
            '0083: this is the control plane — tracker.projects is here, so the '
            'foreign key is correct and is being LEFT IN PLACE.';
        return;
    end if;

    if to_regclass('tracker.pull_request_analysis_rounds') is null then
        raise notice '0083: tracker.pull_request_analysis_rounds does not exist here — skipped';
        return;
    end if;

    alter table tracker.pull_request_analysis_rounds
        drop constraint if exists pull_request_analysis_rounds_project_id_fkey;
    raise notice
        '0083: dropped pull_request_analysis_rounds_project_id_fkey — this node is '
        'a data plane and tracker.projects is empty here by design.';
end $$;

-- The column stays and still identifies the project; it is resolved against the
-- control plane by the application, exactly as issues.project_id has been since
-- the planes split. The index it is queried by is untouched.
comment on column tracker.pull_request_analysis_rounds.project_id is
    'The project this round belongs to. A reference BY VALUE on a regional node: '
    'tracker.projects is control-plane, so the foreign key cannot be expressed '
    'there and 0083 drops it (see regional-node-setup.sql). Deletion is handled '
    'by ProjectContentPurge, not by a cascade.';
