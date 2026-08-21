-- 0079_pr_review_attribution.sql — record which reviewer actually ran.
--
-- ─── The problem this fixes ──────────────────────────────────────────────────
--
-- 0077 let a team configure a PR reviewer and let a project point at one. What
-- it did not do is leave any trace of the choice on the review it produced. The
-- profile was read at dispatch, compiled into a policy, sent to the analyser and
-- then forgotten — so "is this review actually running under our profile?" was
-- a question nobody could answer from the product, only by reading the code and
-- trusting it. A setting you cannot confirm took effect is a setting people stop
-- believing in.
--
-- ─── Why the run stores it, and not just a pointer ───────────────────────────
--
-- projects.review_profile_id says what the NEXT review will use. It is the wrong
-- thing to render beside a review from three weeks ago, because the assignment
-- moves: somebody switches the project to a different profile, or edits the
-- profile's dials, and the old review silently re-labels itself as something it
-- never was. So the run keeps its own snapshot, taken at dispatch, of the policy
-- that was actually sent.
--
-- ─── Why review_profile_id carries no foreign key ────────────────────────────
--
-- Two reasons, either sufficient.
--
-- The record is HISTORY. 0077 gave projects.review_profile_id `on delete set
-- null` so that deleting a profile degrades its projects to the default rather
-- than breaking them — right for a pointer, wrong for a log. Deleting "Payments
-- — strict" must not go back and erase the fact that it reviewed PR #412; the
-- name snapshot in review_profile is what keeps that readable afterwards.
--
-- And the two tables need not share a database. review_profiles is CONTROL-plane
-- (team-owned, alongside teams and billing); pull_request_analyses is REGIONAL,
-- living in whichever cell holds the project's content. A cross-plane foreign
-- key is not expressible, so the id here is a reference by value.
--
-- ─── Why the snapshot is jsonb and shaped as a union ─────────────────────────
--
-- Same argument as 0077's dials: the policy vocabulary lives in
-- modules/analysis/domain/ReviewProfile.ts and grows by deploy, not by
-- migration. What matters at the database level is only that the three states
-- stay distinguishable:
--
--   null                 — the run predates this migration; we genuinely do not
--                          know, and saying so is better than implying default.
--   {"kind":"default"}   — the built-in reviewer, recorded EXPLICITLY. This is
--                          the state that makes the feature trustworthy: it is
--                          the difference between "no profile was applied" and
--                          "nobody has written this down yet".
--   {"kind":"profile",…} — name, preset and the exact compiled policy, plan
--                          depth-clamp included, as it crossed the wire.

alter table tracker.pull_request_analyses
    add column if not exists review_profile_id uuid,
    add column if not exists review_profile    jsonb;

-- "Which reviews ran under this profile" is the first question this column will
-- be asked — by an admin who just loosened a blocking dial and wants to know
-- what it touched. Partial, because the default-reviewer rows are the majority
-- and are never the subject of that question.
create index if not exists pull_request_analyses_review_profile_idx
    on tracker.pull_request_analyses(review_profile_id)
    where review_profile_id is not null;

comment on column tracker.pull_request_analyses.review_profile_id is
    'The review profile this run used (tracker.review_profiles.id), or null for '
    'the built-in default. Deliberately NOT a foreign key: this is a historical '
    'record that must survive the profile being deleted, and review_profiles is '
    'control-plane while this table is regional.';

comment on column tracker.pull_request_analyses.review_profile is
    'Snapshot of the reviewer this run actually used, taken at dispatch: '
    '{"kind":"default"} or {"kind":"profile","name":…,"preset":…,"policy":…}. '
    'The policy is the compiled wire payload sent to the analyser, plan depth '
    'clamp included. Null means the run predates attribution — which is NOT the '
    'same as the default reviewer, and is rendered differently.';
