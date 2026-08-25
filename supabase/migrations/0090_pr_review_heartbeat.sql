-- When a PR review actually started, so a dead one can be taken over.
--
-- ─── Why ────────────────────────────────────────────────────────────────────
--
-- The review runs detached in the analyser and reports back over a callback.
-- Restart the analyser mid-review — a deploy, a crash, an OOM — and that
-- callback never comes. The row stays status='analysing' forever, and the guard
-- in PullRequestAnalysisService.start() does the right thing for a RUNNING
-- review and exactly the wrong thing for a dead one: a new push records a
-- pending head and returns, because "the callback starts the next round for it".
-- There is no callback. There is no scheduler in this stack to notice. The pull
-- request is wedged, and every further push makes it worse by overwriting the
-- pending head it will never drain.
--
-- updated_at cannot answer this: it has a touch trigger, so setPendingHead
-- refreshes it on every push and a dead review looks perpetually alive. This
-- column is written ONCE, when a run is dispatched, and cleared when it lands.
--
-- Nullable on purpose. Rows written before this existed have no start time, and
-- the code treats "unknown" as "assume it is running" — the behaviour we have
-- today, which is safe rather than merely compatible.
alter table tracker.pull_request_analyses
    add column if not exists analysing_since timestamptz;

comment on column tracker.pull_request_analyses.analysing_since is
    'When the in-flight review was dispatched. Null when no run is in flight. A '
    'row still ''analysing'' long past the analyser''s own timeout is dead, and '
    'the next push takes it over instead of waiting for a callback that is not coming.';
