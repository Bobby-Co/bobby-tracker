-- tracker.pull_request_analysis_rounds — one row per completed review of a pull
-- request, so a re-review can say what CHANGED rather than replacing the last
-- answer.
--
-- tracker.pull_request_analyses stays exactly as it is: keyed on
-- (project_id, pr_number), it means "the review currently on this PR". This is
-- the history beside it, so every existing read is untouched.

create table if not exists tracker.pull_request_analysis_rounds (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid not null references tracker.projects (id) on delete cascade,
    pr_number    integer not null,

    -- The head this round reviewed. The round is created when a review of that
    -- head completes, so two rounds never describe the same run.
    head_sha     text not null,

    -- Ordinal within the PR, 1-based, so the UI can say "round 3" without
    -- counting rows and a rebase that reuses a SHA cannot collide.
    round        integer not null,

    status       text not null,
    verdict      text,
    score        integer,
    score_max    integer,

    -- The findings this round produced, as stored on the analysis row. Kept in
    -- FULL rather than summarised: the delta is recomputed from them whenever
    -- the fingerprinting rules change, and a stored summary would freeze today's
    -- rules into history.
    findings     jsonb not null default '[]'::jsonb,

    -- DEGRADED marks a round whose grounded pass did not complete. It exists so
    -- the delta can refuse to resolve anything from it: a blocker missing from a
    -- partial review looks exactly like a blocker that was fixed, and treating
    -- the two alike would open the merge on a PR nobody reviewed.
    degraded     boolean not null default false,

    -- What reviewed it (0079), carried per round: a profile edited mid-PR means
    -- round 3 was judged by a different reviewer than round 1, and the delta
    -- should be able to say so.
    review_profile jsonb,
    analyser_build text,

    created_at   timestamptz not null default now(),

    constraint pull_request_analysis_rounds_pr_round_uniq
        unique (project_id, pr_number, round)
);

create index if not exists pr_rounds_pr_idx
    on tracker.pull_request_analysis_rounds (project_id, pr_number, round desc);

-- Reachability fuse, per 0067: enabled, no policies, so the public key reads
-- nothing. Authorization is the app's job (AccessService), not the database's.
-- Without this the table would be the one readable table in the schema — the
-- rounds carry a PR's full finding history, which is exactly the sort of thing
-- 0067 exists to keep away from an anon key.
alter table tracker.pull_request_analysis_rounds enable row level security;

-- The head a push moved to WHILE a review was in flight.
--
-- Without it those pushes were dropped outright: the in-flight guard returned
-- early and kept no record, so the review finished describing an older head, the
-- comment described code no longer in the PR, and the merge gate judged it —
-- with nothing left to trigger a re-run. Recording the head here makes the
-- running review its own debounce window: pushes during it coalesce to the
-- latest, and the callback starts the next round when it lands.
alter table tracker.pull_request_analyses
    add column if not exists pending_head_sha text;

comment on column tracker.pull_request_analyses.pending_head_sha is
    'Head seen while a review was in flight; the callback re-runs when it differs from head_sha.';
