-- regional-node-setup.sql — run ONCE on a regional data-plane project, AFTER
-- asia-full-schema.sql.
--
-- Deliberately NOT a migration in supabase/migrations. These statements are
-- correct on a regional node and WRONG on the primary: they sever constraints
-- that hold perfectly well where the referenced tables actually live. Node
-- provisioning is a different thing from schema evolution.
--
-- ─── The plane boundary ──────────────────────────────────────────────────────
--
-- CENTRAL (control): identity, teams, billing, the three realtime tables, AND
--   `projects` plus every per-project config table. `projects` is central for a
--   specific reason — four queries enumerate a TEAM's worth of projects (the
--   sidebar/grid, the create-time duplicate check, the collections picker, and
--   MCP list_knowledge_bases). Those span regions, and a regional `projects`
--   would silently return a subset: no error, just missing projects.
--
-- REGIONAL (data): the per-issue and per-PR content — `issues`,
--   `issue_embeddings`, `issue_comments`, `pr_comments`, `pull_requests`,
--   `pull_request_analyses`, `mind_context`, `public_issue_reporters`. Every
--   query against these is keyed by id or project_id (verified across the whole
--   codebase), so none of them span a team and none break when they move.
--
-- That boundary is what makes the write path local: the embedding sweep in
-- IssueEmbedder.ensureEmbeddings writes one row per issue SEQUENTIALLY, so with
-- issues and embeddings regional a Bangkok worker stops paying a Pacific round
-- trip per issue.
--
-- ─── What this drops ─────────────────────────────────────────────────────────
--
-- The 12 foreign keys pointing from those regional tables at central ones
-- (`projects`, `auth.users`, `public_sessions`). They cannot survive the split —
-- those tables are permanently empty here, so every one would reject the first
-- row written. The COLUMNS stay: `issues.project_id` still identifies the
-- project, it is simply resolved against the control plane by the application.
--
-- Intra-regional keys are untouched and still enforced: issue_embeddings →
-- issues, public_issue_reporters → issues, and the issues self-reference for
-- duplicates. The similarity RPCs (find_similar_to_issue, match_project_issues)
-- join issues to issue_embeddings — both regional, so they keep working.
--
-- ─── RLS needs nothing ───────────────────────────────────────────────────────
--
-- `team_members` is empty here, so is_team_member() can never return true and
-- every inherited policy already evaluates to false. This database is deny-all to
-- `authenticated`/`anon` and reachable only by `service_role`, which bypasses
-- RLS. The posture we want, by arithmetic rather than another migration.
--
-- ─── The one obligation you take on ──────────────────────────────────────────
--
-- On the PRIMARY, `issue_suggestions.issue_id → issues` (ON DELETE CASCADE) also
-- has to go, since issue_suggestions is central and issues are not. Deleting an
-- issue must then delete its suggestions in application code. That is the entire
-- cascade debt of this design — compare the earlier `projects`-regional cut,
-- which put team deletion itself on the hook.

-- ─── Why this is driven by the CATALOGUE, not by a list ──────────────────────
--
-- It used to be twelve hand-written DROP statements. That list was correct on
-- the day it was written and silently wrong afterwards: migration 0080 added
-- tracker.pull_request_analysis_rounds with a foreign key to `projects`, nobody
-- added it here, and every round insert on a regional node failed with 23503 —
-- discarded by the caller, so PR review rounds simply never recorded and
-- incremental review could not work on any regional project. Nothing said so for
-- four review rounds.
--
-- A list you have to remember to extend is the same shape as the grant bug 0073
-- had to repair. So the boundary is now enforced by asking the catalogue: drop
-- EVERY foreign key from this schema into a table that lives centrally. New
-- regional tables are covered the day they are created, without anyone
-- remembering this file exists.
--
-- The central set is named explicitly rather than inferred. It is short, it
-- changes rarely, and inferring it would be the second guess in a file whose
-- whole job is to be certain about one boundary.

begin;

do $$
declare
    r record;
    n int := 0;
begin
    for r in
        select con.conname, c.relname as child, tc.relname as parent, tn.nspname as parent_schema
        from pg_constraint con
        join pg_class c       on c.oid  = con.conrelid
        join pg_namespace cn  on cn.oid = c.relnamespace
        join pg_class tc      on tc.oid = con.confrelid
        join pg_namespace tn  on tn.oid = tc.relnamespace
        where con.contype = 'f'
          and cn.nspname = 'tracker'
          -- The control plane: identity, and the two tracker tables that have
          -- team-spanning listing queries. Everything else in `tracker` is
          -- regional and its keys are intra-regional, so they stay enforced.
          and (tn.nspname = 'auth' or (tn.nspname = 'tracker' and tc.relname in ('projects', 'public_sessions')))
    loop
        execute format('alter table tracker.%I drop constraint %I', r.child, r.conname);
        raise notice 'regional-node-setup: dropped %.% → %.% (%)',
            'tracker', r.child, r.parent_schema, r.parent, r.conname;
        n := n + 1;
    end loop;
    raise notice 'regional-node-setup: severed % cross-plane foreign key(s)', n;
end $$;

-- Mark the node, so a human opening this database knows what it is and the app
-- can refuse to treat it as if it held identity.
insert into tracker.app_config (key, value)
values ('plane', 'data')
on conflict (key) do update set value = excluded.value;

commit;

-- Verify — must return 0. Same catalogue query as the drop above, with no table
-- list of its own: a new regional table with a cross-plane key shows up here
-- whether or not anyone thought to mention it.
--
--   select c.relname as child, con.conname, tc.relname as parent
--   from pg_constraint con
--   join pg_class c      on c.oid  = con.conrelid
--   join pg_namespace cn on cn.oid = c.relnamespace
--   join pg_class tc     on tc.oid = con.confrelid
--   join pg_namespace tn on tn.oid = tc.relnamespace
--   where con.contype = 'f'
--     and cn.nspname = 'tracker'
--     and (tn.nspname = 'auth'
--          or (tn.nspname = 'tracker' and tc.relname in ('projects','public_sessions')));
--
-- Worth running on every regional node after ANY migration that adds a table,
-- not only at provisioning. That is what would have caught 0080.
