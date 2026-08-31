-- 0094_issue_branch.sql — the branch an issue is about.
--
-- 0092 gave a project a list of indexed branches; the PR path already reviews
-- against the branch a pull request targets. Issue analysis had no such datum:
-- every investigation read the project's DEFAULT graph, so an issue filed
-- against a feature branch was answered from trunk — confidently, and with
-- citations to lines that branch may have moved or deleted.
--
-- ─── Why a nullable text column, not a foreign key ───────────────────────────
--
-- Issues outlive branches. A branch is deleted the day its pull request merges
-- and the issue that referenced it stays open for weeks. An FK would force a
-- choice between blocking that deletion and erasing the issue's own history of
-- what it was about; text keeps the record and lets the resolution fail soft.
--
-- It is also how the same fact is already stored one module over: a pull
-- request's base ref is text, for the same reason.
--
-- ─── Why nullable rather than "every issue must be tagged" ───────────────────
--
-- project_branches is an explicit, memory-bounded opt-in, and the overwhelming
-- majority of projects will have no rows in it. A required branch would be a
-- mandatory field whose only possible value is "the default", and it would give
-- a GitHub-imported issue — which arrives with no branch at all — nothing
-- honest to say. Null means "the project's default tree", which is precisely
-- what every issue means today.
--
-- Modelled on analyse_effort (0032): a per-issue choice, null = inherit.

alter table tracker.issues
    add column if not exists branch text;

-- The name is used verbatim as part of a FalkorDB graph key downstream, so the
-- same two checks project_branches carries apply here. Deliberately NOT a
-- foreign key or an existence check: see above, and because an issue may be
-- filed against a branch before anyone has tracked it.
alter table tracker.issues
    drop constraint if exists issues_branch_shape;
alter table tracker.issues
    add constraint issues_branch_shape
    check (branch is null or (length(branch) > 0 and branch !~ '[[:space:]]'));

comment on column tracker.issues.branch is
    'The branch this issue is about. Null = the project''s default tree, which '
    'is what every issue meant before this column existed. Resolved at analyse '
    'time against project_branches: only a TRACKED and READY branch is sent to '
    'the analyser, because it refuses one it has not indexed rather than '
    'silently answering from the default.';

-- ─── Which tree the run in flight is actually about ─────────────────────────
--
-- `branch` above is the user's INTENT. What a run was dispatched against is the
-- RESOLUTION of that intent — the branch only if it was tracked and ready at
-- dispatch, the default otherwise — and the two can disagree.
--
-- The callback needs the resolution, not the intent, and it arrives minutes
-- later. Re-deriving it then reads a world that may have moved: a branch that
-- was ready at dispatch and has since failed would re-derive to "default", and
-- the answer computed from feat/x would be filed as the default tree's. That is
-- the silent-wrong-tree failure, reached through the cache. So it is recorded
-- when it is known, next to analysis_status and analysis_started_at, which are
-- on this row for the same reason.
alter table tracker.issues
    add column if not exists analysis_branch text;

comment on column tracker.issues.analysis_branch is
    'The branch the current (or last) analysis run was dispatched against, after '
    'resolving `branch` against project_branches. Null = the default tree. '
    'Written at dispatch and read by the callback, which must file the result '
    'under the tree it was actually computed from.';

-- ─── The cached answer has to remember which tree it came from ──────────────
--
-- IssueAnalysisService short-circuits to "done" the moment an issue has any
-- cached suggestion. Without this column, retargeting an issue from `main` to
-- `feat/x` would keep serving the answer computed against main — the exact
-- silent-wrong-tree failure ErrBranchNotIndexed exists to prevent, arrived at
-- from the cache instead of the graph. With it, "is there a cached answer"
-- becomes "is there a cached answer FOR THIS TREE".
--
-- graph_id is already on this table and technically encodes the branch, but it
-- encodes it in the ANALYSER's naming scheme. Reading a branch back out of it
-- would mean duplicating that scheme in the tracker and keeping the copy in
-- step forever; storing what we asked for is cheaper and cannot drift.
alter table tracker.issue_suggestions
    add column if not exists branch text;

comment on column tracker.issue_suggestions.branch is
    'The branch this analysis was run against; null = the project default. Read '
    'as a cache key, so retargeting an issue to another branch re-analyses '
    'rather than replaying an answer about a different tree.';
