-- tracker.pr_review_index — the Phase-5 institutional-memory index the
-- bobby-analyser's KB-grounded PR reviewer populates (analyser ADR-0057).
--
-- After each PR review the analyser upserts one row per reviewed file, recording
-- the merge verdict and the finding categories it raised. Keyed by the analyser
-- graph id (`repo_id`, == tracker.project_analyser.graph_id) rather than a
-- tracker project id, because the analyser is GitHub-/tracker-agnostic and only
-- knows the graph it reviewed against. This lets a later review of the same file
-- surface "we've seen churn here before" and, once the revert-feedback wire lands
-- (see below), learn which past reviews shipped changes that were later backed
-- out — the signal Phase 5 uses to calibrate its own confidence.
--
-- The analyser writes AND reads via the service role (which bypasses RLS); RLS
-- here only governs owner-facing reads in-app. Ownership is derived by joining
-- the graph id back to a project the caller owns (through project_analyser).
--
-- REVERT-FEEDBACK WIRE (not built yet — hook only): when a merged PR is later
-- reverted, the tracker should flip `reverted` on every row for that PR:
--
--     update tracker.pr_review_index
--        set reverted = true, updated_at = now()
--      where repo_id = <graph_id> and pr_number = <n>;
--
-- Detecting the revert (a "Revert \"…\"" PR merging, or the analyser reporting it)
-- is deliberately out of scope for this migration — this is only the column +
-- index the flip targets. See analyser ADR-0057 Phase 5.

create table if not exists tracker.pr_review_index (
    id           uuid        primary key default gen_random_uuid(),
    -- Analyser graph id (== tracker.project_analyser.graph_id). Plain text, not
    -- an FK: the analyser owns the graph-id namespace and may write before the
    -- tracker has materialised a matching project_analyser row.
    repo_id      text        not null,
    pr_number    int         not null,
    -- Repo-relative path of the reviewed file. One row per (repo, pr, file).
    file         text        not null,
    -- PR title + merge verdict at review time (snapshotted for the reverse lookup
    -- so we don't re-join to pull_request_analyses).
    title        text,
    verdict      text,
    -- Finding categories raised on this file, as a JSON string[] (e.g.
    -- ["convention","test_gap"]). Defaults to an empty array.
    finding_tags jsonb       not null default '[]'::jsonb,
    -- Flipped true by the tracker when the PR that touched this file is later
    -- reverted (see the revert-feedback wire above). Drives Phase-5 calibration.
    reverted     boolean     not null default false,
    updated_at   timestamptz not null default now(),
    -- The analyser upserts on this key with resolution=merge-duplicates.
    constraint pr_review_index_repo_pr_file_uniq unique (repo_id, pr_number, file)
);

-- Reverse lookup: "what have we reviewed about this file before?"
create index if not exists pr_review_index_repo_file_idx
    on tracker.pr_review_index (repo_id, file);

drop trigger if exists touch_pr_review_index on tracker.pr_review_index;
create trigger touch_pr_review_index
    before update on tracker.pr_review_index
    for each row execute function tracker.touch_updated_at();

alter table tracker.pr_review_index enable row level security;

-- Owner-select through the graph → project ownership chain; all writes are
-- service-role (the analyser populates; the tracker flips `reverted`).
drop policy if exists pr_review_index_owner_select on tracker.pr_review_index;
create policy pr_review_index_owner_select on tracker.pr_review_index
    for select using (
        exists (
            select 1
            from tracker.project_analyser pa
            join tracker.projects p on p.id = pa.project_id
            where pa.graph_id = pr_review_index.repo_id and p.user_id = auth.uid()
        )
    );

grant all on tracker.pr_review_index to authenticated, service_role;
