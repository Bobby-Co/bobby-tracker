-- 0071_issue_analysis_started_at.sql — let an abandoned analysis be recognised.
--
-- ensure() writes analysis_status='analysing' BEFORE dispatching the run, and
-- only the analyser's callback ever clears it. So when a callback is lost — an
-- unroutable address, a redeploy mid-run, the analyser dying — the row stays
-- 'analysing' forever, and every retry short-circuits on:
--
--     if (issue.analysis_status === 'analysing') return 'in_flight'
--
-- The issue becomes permanently unanalysable. There is no scheduler in this
-- stack to reap it, so today the only cure is a manual UPDATE.
--
-- The guard needs to know WHEN the run started, and no existing column can say.
-- updated_at is wrong for this: any unrelated edit refreshes it, so editing a
-- stuck issue would extend its stuck window rather than shorten it — exactly
-- backwards from what someone poking at a broken issue is trying to do.
--
-- Nullable with no backfill, deliberately. A row currently wedged in 'analysing'
-- has no start time, and the guard treats null as STALE — so every issue stuck
-- by this bug becomes retryable the moment this ships, with no data repair.
--
-- NOTE: `issues` is a REGIONAL table. Apply this to every cell's database, not
-- just the control one.

alter table tracker.issues
    add column if not exists analysis_started_at timestamptz;

comment on column tracker.issues.analysis_started_at is
    'When the current analysis run was dispatched. Set alongside analysis_status=''analysing''; '
    'read to decide whether an in-flight run has been abandoned. Null means unknown, which is '
    'treated as stale so pre-0071 wedged rows recover on their own.';
