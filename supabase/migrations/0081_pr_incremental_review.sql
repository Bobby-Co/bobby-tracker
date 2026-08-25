-- 0081_pr_incremental_review.sql — review the push, carry the rest, and record
-- which commit changed what.
--
-- ─── The problem this fixes ──────────────────────────────────────────────────
--
-- Every push re-reviewed the entire pull request. Three consecutive rounds on
-- one twelve-file PR: round 1 reviewed 12 files in 360s, round 2 reviewed 12
-- files after a 2-file push, round 3 reviewed 12 files after a 1-file push. Round
-- 3 spent six minutes re-deriving eleven files it had already read twice, to
-- report three findings it had already reported.
--
-- The cost is not the main problem. The TURN BUDGET is: the KB review loop is
-- capped at 14 turns and a plan clamped to `quick` yields nine — nine tool-call
-- turns to walk a 110-file graph, verify every draft finding, enumerate callers,
-- probe failures, read history, and then write JSON. It routinely runs out
-- mid-walk. Scoping the deep pass to what actually changed is a more direct fix
-- for that than anything else we have tried.
--
-- ─── Why the obvious version is a correctness bug ────────────────────────────
--
-- MergeGate counts criticals in `result.findings`, and findings are REPLACED
-- WHOLESALE on every round. Review only the last commit and a still-present
-- blocker in an untouched file is simply absent from the new list — so the gate
-- sees zero criticals and OPENS THE MERGE. Full re-review is what prevents that
-- today; it is not thoroughness for its own sake, it is the thing that gives the
-- reviewer a fair chance to re-find what it found before.
--
-- Every fail-open in this pipeline has had the same shape: something real
-- exists, but not in the place the gate reads. A degraded review scoring 10/10.
-- A migration blocker labelled `data` and silently demoted. Findings lost when
-- the turn budget ran out. Incremental review without carry-forward would be the
-- next one — which is why these columns exist and why `carried` is stamped on
-- every finding that rides along.
--
-- ─── Why the scope decision lives on the tracking row ────────────────────────
--
-- The scope is decided where the diff is fetched (dispatch) and the merge
-- happens where the result lands (the callback). Those are two different
-- requests, minutes apart, and by the time the second one runs the head may have
-- moved again. Re-deriving the decision there would compare against a state that
-- no longer exists, so it is written down once and read back.
--
-- pull_request_analyses.review_scope carries the whole decision: which rule
-- fired, the compared range, the commits, and — critically — the exact findings
-- being carried, verbatim. By value rather than by reference, for the same
-- reason 0079's profile snapshot is: a pointer to a row that could be read
-- differently later is precisely the drift this is meant to prevent.

alter table tracker.pull_request_analyses
    add column if not exists review_scope jsonb;

comment on column tracker.pull_request_analyses.review_scope is
    'What this run was scoped to, written at dispatch and read by the callback: '
    '{"scope":"full"|"incremental","code":…,"reason":…,"prevHeadSha":…,'
    '"baseSha":…,"commits":[…],"reviewedFiles":N,"carried":[…findings…]}. '
    'The carried findings are stored BY VALUE because the callback has to merge '
    'them into one findings list — the list the merge gate counts. Null on rows '
    'written before incremental review, which were all full reviews.';

-- ─── the round record ────────────────────────────────────────────────────────
--
-- Rounds (0080) already store the FULL findings list per round, so "show me the
-- review as it stood at round 2" is one row read and every round is
-- self-contained. These columns say what that round actually DID.

alter table tracker.pull_request_analysis_rounds
    -- What was reviewed, and why. `scope` defaults to 'full' so every round
    -- written before this migration reads correctly rather than as an unknown —
    -- they WERE all full reviews, and treating them as unknown would force a
    -- full pass on the first round after deploy for no reason.
    add column if not exists scope        text not null default 'full',
    add column if not exists scope_reason text,

    -- The range this round covered. prev_head_sha is the head the LAST round
    -- reviewed — the left-hand side of the compare — and null on a first round.
    add column if not exists prev_head_sha text,
    add column if not exists base_sha      text,

    -- The commits between prev_head_sha (or the base, on a first round) and
    -- head_sha: sha, subject, author, timestamp, and the files each touched.
    -- This is what turns the round strip into the series of pushes, so a reader
    -- can see WHICH commit a review was answering rather than a bare sha.
    add column if not exists commits jsonb not null default '[]'::jsonb,

    -- How many findings rode along without anyone looking at them, and how many
    -- files the reviewer was actually given. Both are derivable from `findings`
    -- and the scope, but a round is read far more often than it is written and
    -- the "N carried" chip should not cost a scan of a jsonb array.
    add column if not exists carried_count  integer not null default 0,
    add column if not exists reviewed_files integer,

    -- Blocking findings the PREVIOUS round had that this one does not, each
    -- stamped with the head that closed it.
    --
    -- Deliberately NOT part of `findings`: a resolved blocker must leave the
    -- list the merge gate counts, or fixing it would never open the merge. But
    -- it must stay readable, because the round selector's whole point is that a
    -- reader can see what the review said BEFORE their fix — the only way to
    -- check that the fix addressed what was actually reported rather than what
    -- they remembered being reported.
    add column if not exists resolved jsonb not null default '[]'::jsonb;

comment on column tracker.pull_request_analysis_rounds.scope is
    'full | incremental. What this round reviewed: the whole pull request, or '
    'only the diff between the last reviewed head and this one. Defaults to '
    'full, which is what every pre-0081 round was.';

comment on column tracker.pull_request_analysis_rounds.scope_reason is
    'One line saying which rule chose the scope ("this push touches a migration, '
    'which reaches code the diff never mentions"). Logged on every round from the '
    'first deploy, including while the decision was still advisory, so the '
    'thresholds could be tuned on real numbers rather than on a guess.';

comment on column tracker.pull_request_analysis_rounds.commits is
    'The commits this round covered: [{"sha","subject","author","at","files"}]. '
    'Files is best-effort — providers report changed paths per compare, not per '
    'commit — so it is empty when only the range list was available.';

comment on column tracker.pull_request_analysis_rounds.carried_count is
    'How many of this round''s findings were inherited from an earlier round '
    'without being re-examined. Zero on every full review. The number behind the '
    '"N carried" chip: without it a cheap round looks like a lazy one and the '
    'reader has no way to tell the difference.';

comment on column tracker.pull_request_analysis_rounds.resolved is
    'Blocking findings the previous round had that this one does not, each with '
    'provenance.resolvedBy set to this round''s head. Kept out of `findings` so '
    'the merge gate stays clean, and kept at all so the round selector can show '
    'what a push actually fixed.';

-- "How often does incremental actually happen, and which rule blocks it?" is the
-- question these columns exist to answer, and it is asked across a project's
-- rounds rather than one PR's.
create index if not exists pr_rounds_scope_idx
    on tracker.pull_request_analysis_rounds (project_id, scope, created_at desc);
