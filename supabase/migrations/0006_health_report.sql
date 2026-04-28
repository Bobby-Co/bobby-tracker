-- Persisted "graph health" report. Every verify run — manual UI
-- button, post-update QC pass, post-bootstrap QC pass — writes here
-- so the tracker UI always renders the latest report on load (no
-- "click verify to see results" empty state) and so realtime
-- subscribers see updates as soon as a server-side run finishes.
--
-- Schema mirrors internal/verify.Report on the analyser side. Stored
-- as jsonb so we can extend without a migration; the tracker reads
-- with a TypeScript interface (lib/analyser.ts:VerifyReport) and
-- tolerates missing keys.
--
-- last_health_check_at separates "have we ever run verify" from
-- "is the report current" — the column is null until the first
-- successful verify completes.

alter table tracker.project_analyser
    add column if not exists last_health_report   jsonb,
    add column if not exists last_health_check_at timestamptz;

comment on column tracker.project_analyser.last_health_report is
    'Latest verify.Report for this graph (citation hit rate, drift, coverage, content-stale, broken cites). Updated on every verify run — manual UI button, post-update QC, post-bootstrap QC. Null until first verify.';

comment on column tracker.project_analyser.last_health_check_at is
    'Timestamp of the last successful verify run that wrote last_health_report. Null when never run.';
