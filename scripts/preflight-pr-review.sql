-- preflight-pr-review.sql — does THIS database support the PR-review pipeline?
--
-- Run it against any database the pipeline touches, control or regional:
--
--     psql "$DATABASE_URL" -f scripts/preflight-pr-review.sql
--
-- It prints one row per check, with a remedy for each failure. Read-only.
--
-- ─── Why this exists ─────────────────────────────────────────────────────────
--
-- Every deployment failure this pipeline has had was invisible from inside the
-- application, because every one of them degrades to something survivable:
--
--   a column the build selects and the database lacks   → an empty result set,
--                                                          read as "no history"
--   a grant the service role never got                  → permission denied,
--                                                          discarded by the caller
--   a foreign key a regional node cannot satisfy        → 23503, discarded
--   a stale PostgREST schema cache                      → PGRST205, discarded
--
-- Each one produced a pipeline that looked exactly like a working one. Finding
-- the FK took four review rounds and six redeploys, and the error was sitting in
-- the database driver the whole time. This asks the database directly, before
-- anything is deployed, and answers in one screen.
--
-- The application-side silences are fixed too — every one of those calls now
-- logs its cause. This is the half that does not need a deploy to run.

\pset footer off
\echo ''
\echo '─── PR-review preflight ─────────────────────────────────────────────────'
\echo ''

with plane as (
    select case
             when to_regclass('tracker.app_config') is null then 'control (no app_config)'
             when coalesce((select value from tracker.app_config where key = 'plane'), 'control') = 'data'
                  then 'REGIONAL (data plane)'
             else 'control'
           end as name,
           coalesce((select value = 'data' from tracker.app_config where key = 'plane'), false) as is_regional
),

-- 1. The tables the pipeline reads and writes.
tables as (
    select t.name,
           to_regclass('tracker.' || t.name) is not null as present
    from (values
        ('projects'), ('pull_requests'), ('pull_request_analyses'),
        ('pull_request_analysis_rounds'), ('pr_comments'), ('review_profiles')
    ) as t(name)
),

-- 2. The columns each migration added. A build that selects one the database
--    lacks gets an error PostgREST reports and the caller has historically
--    thrown away.
columns as (
    select c.tbl, c.col, c.since,
           exists (
               select 1 from information_schema.columns ic
               where ic.table_schema = 'tracker' and ic.table_name = c.tbl and ic.column_name = c.col
           ) as present
    from (values
        ('pull_request_analyses',       'head_sha',        '0042'),
        ('pull_request_analyses',       'review_profile',  '0079'),
        ('pull_request_analyses',       'review_profile_id','0079'),
        ('pull_request_analyses',       'pending_head_sha','0080'),
        ('pull_request_analyses',       'review_scope',    '0081'),
        ('pull_request_analysis_rounds','round',           '0080'),
        ('pull_request_analysis_rounds','findings',        '0080'),
        ('pull_request_analysis_rounds','degraded',        '0080'),
        ('pull_request_analysis_rounds','scope',           '0081'),
        ('pull_request_analysis_rounds','scope_reason',    '0081'),
        ('pull_request_analysis_rounds','prev_head_sha',   '0081'),
        ('pull_request_analysis_rounds','base_sha',        '0081'),
        ('pull_request_analysis_rounds','commits',         '0081'),
        ('pull_request_analysis_rounds','carried_count',   '0081'),
        ('pull_request_analysis_rounds','reviewed_files',  '0081'),
        ('pull_request_analysis_rounds','resolved',        '0081')
    ) as c(tbl, col, since)
),

-- 3. Grants. RLS bypass is not a table privilege — 0073 exists because that
--    distinction cost two tables their entire write path.
grants as (
    select g.tbl,
           has_table_privilege('service_role', 'tracker.' || g.tbl, 'SELECT') as can_select,
           has_table_privilege('service_role', 'tracker.' || g.tbl, 'INSERT') as can_insert
    from (values ('pull_request_analyses'), ('pull_request_analysis_rounds')) as g(tbl)
    where to_regclass('tracker.' || g.tbl) is not null
),

-- 4. Cross-plane foreign keys. Correct centrally, fatal regionally: the
--    referenced table is empty there by design, so the key rejects every row.
crossplane as (
    select c.relname as child, con.conname, tc.relname as parent
    from pg_constraint con
    join pg_class c       on c.oid  = con.conrelid
    join pg_namespace cn  on cn.oid = c.relnamespace
    join pg_class tc      on tc.oid = con.confrelid
    join pg_namespace tn  on tn.oid = tc.relnamespace
    where con.contype = 'f'
      and cn.nspname = 'tracker'
      and (tn.nspname = 'auth' or (tn.nspname = 'tracker' and tc.relname in ('projects', 'public_sessions')))
)

select 'plane' as check, (select name from plane) as subject, 'INFO' as status,
       'every check below is read against THIS database' as detail
union all
select 'table', name, case when present then 'OK' else 'MISSING' end,
       case when present then '' else 'the migration that creates it has not run here' end
from tables
union all
select 'column', tbl || '.' || col, case when present then 'OK' else 'MISSING' end,
       case when present then '' else 'added by migration ' || since || ' — re-run it (idempotent)' end
from columns where not present or true
union all
select 'grant', tbl, case when can_select and can_insert then 'OK' else 'DENIED' end,
       case when can_select and can_insert then ''
            else 'grant all on tracker.' || tbl || ' to authenticated, service_role;' end
from grants
union all
select 'cross-plane fk', child || ' -> ' || parent,
       case when (select is_regional from plane) then 'FATAL' else 'OK (control)' end,
       case when (select is_regional from plane)
            then 'alter table tracker.' || child || ' drop constraint ' || conname || ';'
            else 'correct here — projects is in this database' end
from crossplane
order by 1, 2;

\echo ''
\echo 'Anything MISSING / DENIED / FATAL above will NOT raise an error in the app.'
\echo 'Each one degrades to an empty result the pipeline reads as "nothing to do".'
\echo ''
\echo 'PostgREST caches the schema and this script cannot see that cache. After ANY'
\echo 'migration, reload it or the app keeps getting PGRST205 for a table that is'
\echo 'demonstrably present:'
\echo ''
\echo '    notify pgrst, ''reload schema'';'
\echo ''
