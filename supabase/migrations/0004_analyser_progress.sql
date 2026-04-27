-- Live progress snapshot for an in-flight analyser indexing job. The
-- tracker route writes here ~once per second while a job runs; the
-- AnalyserPanel reads it (via the realtime subscription added in 0003)
-- and renders the progress bar.
--
-- Persisting progress in the DB means a client doesn't need to keep
-- the indexing HTTP stream open to see progress — refresh, switch
-- tabs, or join from another device and the latest snapshot is right
-- there. The stream-died-but-server-still-working case (caddy idle
-- timeout, fetch interruption, etc.) becomes a non-issue.
--
-- Schema is forward-compatible: clients tolerate missing keys, so we
-- can add fields later without a migration.

alter table tracker.project_analyser
    add column if not exists progress jsonb default '{}'::jsonb;

comment on column tracker.project_analyser.progress is
    'Live progress snapshot during status=indexing: {phase, slug, step_idx, step_total, cost_usd, started_at, message}. Stale once status flips to ready/failed.';
