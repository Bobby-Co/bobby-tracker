-- 0092_project_branches.sql — the branches a project keeps indexed, beyond its default.
--
-- ─── Why a new table and not a column ────────────────────────────────────────
--
-- project_analyser is `primary key (project_id)`: one project, one graph, and
-- its graph_id is the repository's own. Widening that key would move every row
-- and every foreign key that points at it, to express something that is not
-- actually a property of the analyser integration — it is a list.
--
-- So project_analyser keeps its exact meaning: the DEFAULT branch's graph, the
-- one every existing caller already reads. This table is additive, and a
-- project with no rows here behaves precisely as it does today.
--
-- ─── Why a branch is cheap enough to offer at all ────────────────────────────
--
-- The analyser indexes a branch by COPYING the repository's graph and replaying
-- the branch's parse over the copy (job_type=branch). The expensive layer —
-- cluster summaries, embeddings, PageRank — rides along in the copy, so a
-- branch costs a parse and no model calls. What it does cost is memory:
-- FalkorDB is in-memory and every tracked branch is resident, which is why this
-- is an explicit per-project opt-in list rather than "index every branch".
--
-- ─── Control plane ───────────────────────────────────────────────────────────
--
-- Written by the tracker app alongside projects, so it belongs with projects,
-- on the control plane. The plane is whatever the writer addresses.

create table if not exists tracker.project_branches (
    id                  uuid        primary key default gen_random_uuid(),
    project_id          uuid        not null references tracker.projects(id) on delete cascade,
    -- The branch name as git spells it: "feat/multi-branch", slashes and all.
    branch              text        not null,
    status              tracker.analyser_status not null default 'pending',
    -- The analyser's logical graph name for this branch. Null until the first
    -- index lands. Mirrors project_analyser.graph_id, which is null until the
    -- first bootstrap finishes for the same reason.
    graph_id            text,
    last_indexed_at     timestamptz,
    last_indexed_sha    text,
    last_error          text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    -- One row per branch per project. The upsert on re-index depends on it, and
    -- without it a double-click on "track" would index the same branch twice
    -- into the same graph name — the second run clobbering the first mid-flight.
    constraint project_branches_unique unique (project_id, branch),
    -- A branch name that is blank, or carries whitespace, can only produce a
    -- graph nobody can address — the name is used verbatim as a FalkorDB key.
    -- Deliberately not a full git-refname validator: the useful half of that
    -- check is "not empty, no whitespace", and a POSIX class says it without
    -- the backslash-in-bracket-expression ambiguity a fuller pattern needs.
    constraint project_branches_branch_nonempty check (length(branch) > 0),
    constraint project_branches_branch_no_space check (branch !~ '[[:space:]]')
);

create index if not exists project_branches_project_idx
    on tracker.project_branches(project_id, branch);

-- Rows are read by the branch picker and by every analyser call that names a
-- branch, so the common lookup is "this project's branches, ready ones first".
create index if not exists project_branches_ready_idx
    on tracker.project_branches(project_id) where status = 'ready';

drop trigger if exists touch_project_branches on tracker.project_branches;
create trigger touch_project_branches
    before update on tracker.project_branches
    for each row execute function tracker.touch_updated_at();

-- 0067 made RLS the reachability fuse: enabled, no policies, so anon and
-- authenticated read nothing whatever the grants say. Authorization is the
-- app's job (AccessService), not the database's. Skipping this would make it
-- the one readable table in the schema.
alter table tracker.project_branches enable row level security;

-- 0001's grant was a snapshot of the tables that existed then, not a rule, so
-- every table created since has to carry its own. 0080 did not and 0082 had to
-- repair it after the table sat unwritable; this is that lesson applied rather
-- than re-learned.
grant all on tracker.project_branches to authenticated, service_role;

comment on table tracker.project_branches is
    'Branches a project keeps indexed beyond its default. The default branch is '
    'project_analyser; this is additive, and a project with no rows here behaves '
    'exactly as it did before branches existed.';

comment on column tracker.project_branches.graph_id is
    'The analyser''s logical graph name for this branch (repoID@branch/<name>). '
    'Null until the first index lands.';

comment on column tracker.project_branches.status is
    'pending → queued but not yet indexed; indexing → a job is in flight; ready → '
    'queryable; failed → see last_error. A branch that is not ready must not be '
    'sent to the analyser: it answers ErrBranchNotIndexed rather than silently '
    'falling back to the default branch.';
