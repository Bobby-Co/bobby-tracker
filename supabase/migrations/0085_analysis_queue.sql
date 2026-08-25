-- 0085_analysis_queue.sql — the concurrency cap QUEUES work instead of refusing it.
--
-- ─── What changed and why ────────────────────────────────────────────────────
--
-- 0084 gave each tier a ceiling on how many runs it may have in flight, which is
-- what bounds a burst when the ledger cannot keep up. It enforced that ceiling by
-- REFUSING the dispatch, which bounds the spend correctly and treats the user
-- badly: pressing "Investigate" on a third issue reported a failure for something
-- that was only ever a matter of waiting a couple of minutes.
--
-- So the cap now admits the request and defers the WORK: the run is recorded as
-- 'queued' and started when a slot frees. Nothing about the spend bound weakens —
-- a queued run has not been dispatched, costs nothing while it waits, and is
-- re-checked against the balance at the moment it is about to start. That last
-- part makes queueing strictly SAFER than refusing was: a burst of fifty tasks
-- queued against the last of a team's credits now dies in the queue when the
-- balance runs out, where fifty dispatched tasks would all have run.
--
-- ─── Why 'queued' is a status and not a queue table ──────────────────────────
--
-- Both run kinds already have a row that tracks their lifecycle — issues carry
-- analysis_status, pull requests carry a tracking row — and those rows are already
-- what the idempotency, staleness and cancellation paths read. A separate queue
-- table would be a second place for the same fact to live, and every one of those
-- paths would have to learn to consult both and to agree with itself when they
-- disagreed. One more value in an existing enum is a much smaller change than a
-- second source of truth.
--
-- ─── What drains it ──────────────────────────────────────────────────────────
--
-- The finishing run does. There is no scheduler in this stack to poll with, so
-- the completion callback — the moment a slot demonstrably frees — starts the
-- next queued run for that team. This is the same self-clocking trick the
-- pending-head continuation already uses (0080): the work that ends is what
-- starts the work that follows, and no timer exists anywhere.

-- ─── issues ──────────────────────────────────────────────────────────────────
alter table tracker.issues
    drop constraint if exists issues_analysis_status_valid;
alter table tracker.issues
    add constraint issues_analysis_status_valid
    check (analysis_status is null or analysis_status in ('queued', 'analysing', 'done', 'failed', 'cancelled'));

comment on column tracker.issues.analysis_status is
    'Lifecycle of the detached analysis run. ''queued'' means admitted but not yet '
    'dispatched — the team was at its tier''s concurrency cap (0084). A queued run '
    'holds NO slot and has spent nothing; analysis_started_at stays null until it '
    'actually starts, which is what keeps the staleness rule for ''analysing'' '
    'meaning what it always meant.';

-- Oldest-first, per project: how the drain picks what to start next. Partial, so
-- the index holds only what is actually waiting.
create index if not exists issues_queued_idx
    on tracker.issues (project_id, updated_at)
    where analysis_status = 'queued';

-- ─── pull requests ───────────────────────────────────────────────────────────
alter table tracker.pull_request_analyses
    drop constraint if exists pull_request_analyses_status_valid;
alter table tracker.pull_request_analyses
    add constraint pull_request_analyses_status_valid
    check (status is null or status in ('queued', 'analysing', 'done', 'failed', 'cancelled'));

create index if not exists pull_request_analyses_queued_idx
    on tracker.pull_request_analyses (project_id, updated_at)
    where status = 'queued';

comment on column tracker.pull_request_analyses.status is
    'Lifecycle of the detached review. ''queued'' means the team was at its '
    'concurrency cap when the push arrived; the row remembers head_sha so the '
    'drain reviews the head that is current when a slot frees, not the one that '
    'happened to be pushed first.';
