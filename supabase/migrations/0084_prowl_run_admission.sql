-- 0084_prowl_run_admission.sql — stop a team spending past its allowance, both
-- before a run starts and while one is running.
--
-- ─── What was still open after 0076 ──────────────────────────────────────────
--
-- SpendGate refuses a dispatch when the balance is gone. Two things slip past it,
-- and neither is a bug in the gate:
--
--   1. THE LEDGER LAGS. The analyser meters incrementally and flushes a ledger
--      row every $0.25 or two minutes (internal/server/usage_run.go). Between a
--      run starting and its first flush the balance has not moved, so a burst of
--      dispatches all read the same number and all pass. The overshoot is bounded
--      by how many runs you can start inside that window — which, unbounded, is
--      as many as you care to script.
--
--   2. NOTHING WATCHES A RUN. The gate is asked once, at the start. A run that
--      crosses the allowance at minute forty carries on to completion, because
--      the crossing is recorded by the analyser straight into the ledger and the
--      tracker is not in that loop.
--
-- The app-side halves of both fixes are a concurrency cap per tier
-- (modules/analysis/application/RunAdmission.ts) and a sweep that cancels a
-- team's in-flight runs (application/ExhaustionSweep.ts). This migration supplies
-- what those need from the database: indexes that make "what is this team running
-- right now" cheap enough to ask before every dispatch, and the trigger that tells
-- the app a balance moved.
--
-- ─── Why the DATABASE has to be the one to notice ────────────────────────────
--
-- There is no scheduler in this stack — no cron, no pg_cron, no OpenNext
-- scheduled handler — so nothing can poll for "has anyone gone over?". The write
-- itself has to be the event. Same mechanism, and the same config table, as the
-- notification-email callback (0051).
--
-- The trigger deliberately does NOT decide who is exhausted. Deciding needs the
-- tier ladder (allowances, per-team overrides), which lives in TypeScript on
-- purpose — "config, not schema", so tuning a plan is a one-line change with no
-- migration (see modules/billing/domain/Tier.ts). Copying it here would create a
-- second copy to drift. So the trigger reports the FACT (this team's usage moved)
-- and the app applies the POLICY. It therefore fires more often than a team
-- actually crosses a line; the no-op path is one balance read and a 200.

-- ─── the in-flight indexes ───────────────────────────────────────────────────
-- Both counts run in front of every billable dispatch, filtered to one status and
-- a recency cutoff, so they are partial indexes on exactly that predicate. Rows
-- not 'analysing' — very nearly all of them — are not in the index at all.
--
-- These matter on the DATA plane, where the run rows live. `projects` (which the
-- app reads first, to turn a team into its project ids) is CONTROL-plane and
-- already indexed for this by the composite unique projects_repo_url_per_team,
-- whose leading column is team_id.
create index if not exists issues_analysing_idx
    on tracker.issues (project_id, analysis_started_at)
    where analysis_status = 'analysing';

create index if not exists pull_request_analyses_analysing_idx
    on tracker.pull_request_analyses (project_id, updated_at)
    where status = 'analysing';

comment on index tracker.issues_analysing_idx is
    'Backs the per-team in-flight run count (RunAdmission) and the exhaustion '
    'sweep. Partial on analysis_status=''analysing''; analysis_started_at is in '
    'the index because a run is only believed to be in flight if it started '
    'recently — see modules/analysis/domain/AnalysisRun.ts.';

-- ─── the sweep callback ──────────────────────────────────────────────────────
-- To turn the sweep ON, the operator inserts these two rows (the token must match
-- the app's SPEND_SWEEP_TOKEN env var):
--
--   insert into tracker.app_config (key, value) values
--     ('spend_sweep_url',   'https://<app-host>/api/internal/spend-sweep'),
--     ('spend_sweep_token', '<same value as the app''s SPEND_SWEEP_TOKEN>')
--   on conflict (key) do update set value = excluded.value;
--
-- Unconfigured → no sweep, and usage recording is unaffected. That is the same
-- fail-soft posture as 0051 and it is the right one here: the ledger write must
-- never fail because a callback is not set up. Note this means the sweep is OFF
-- until an operator turns it on — the dispatch-time cap in 0084's app half works
-- regardless.
-- SECURITY DEFINER with a PINNED search_path, matching prowl_rollup_usage in
-- 0059. Definer rights are needed to read app_config (RLS-locked, no grants to
-- authenticated); pinning the path is what stops a caller's search_path deciding
-- which `app_config` a definer-rights function reads. It also matters mechanically
-- here: this trigger fires from INSIDE prowl_rollup_usage, so without a pin it
-- would inherit that function's path rather than have one of its own.
create or replace function tracker.prowl_sweep_usage()
returns trigger language plpgsql security definer set search_path = tracker, pg_temp as $$
declare
    v_url   text;
    v_token text;
begin
    select value into v_url   from tracker.app_config where key = 'spend_sweep_url';
    select value into v_token from tracker.app_config where key = 'spend_sweep_token';

    -- Not configured → sweeping disabled. Never raise: the usage rollup must
    -- stand on its own regardless of whether the callback is set up. A regional
    -- node lands here too — usage is control-plane, so its rollup is empty and
    -- these keys are unset.
    if v_url is null or v_token is null then
        return null;
    end if;

    -- Fire-and-forget, and it carries only the team id: the app re-reads the
    -- balance so the decision is made on committed state, and no secret-bearing
    -- payload rides the request beyond the auth token.
    perform net.http_post(
        url     := v_url,
        body    := jsonb_build_object('team_id', new.team_id),
        headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || v_token
        ),
        timeout_milliseconds := 5000
    );
    return null;
end $$;

-- AFTER INSERT OR UPDATE: the rollup is maintained by an upsert
-- (prowl_rollup_on_usage, 0059), so a team's first spend of a period is an INSERT
-- and every later one is an UPDATE. Watching only one of the two would miss
-- either the small teams or everybody else.
drop trigger if exists prowl_sweep_on_usage on tracker.prowl_usage_period;
create trigger prowl_sweep_on_usage
    after insert or update on tracker.prowl_usage_period
    for each row execute function tracker.prowl_sweep_usage();

comment on function tracker.prowl_sweep_usage() is
    'Tells the app that a team''s period usage moved, so it can cancel in-flight '
    'runs if that crossed the allowance. Reports the fact; the app owns the '
    'policy, because the tier ladder is deliberately not in the schema.';
