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

begin;

-- → tracker.projects (central)
alter table tracker.issues                 drop constraint if exists issues_project_id_fkey;
alter table tracker.issue_comments         drop constraint if exists issue_comments_project_id_fkey;
alter table tracker.issue_embeddings       drop constraint if exists issue_embeddings_project_id_fkey;
alter table tracker.pr_comments            drop constraint if exists pr_comments_project_id_fkey;
alter table tracker.pull_requests          drop constraint if exists pull_requests_project_id_fkey;
alter table tracker.pull_request_analyses  drop constraint if exists pull_request_analyses_project_id_fkey;
alter table tracker.mind_context           drop constraint if exists mind_context_project_id_fkey;

-- → auth.users (central)
alter table tracker.issues                 drop constraint if exists issues_user_id_fkey;
alter table tracker.issue_comments         drop constraint if exists issue_comments_author_user_id_fkey;
alter table tracker.pr_comments            drop constraint if exists pr_comments_author_user_id_fkey;
alter table tracker.public_issue_reporters drop constraint if exists public_issue_reporters_auth_user_id_fkey;

-- → tracker.public_sessions (central — it has a team-scoped listing query)
alter table tracker.public_issue_reporters drop constraint if exists public_issue_reporters_session_id_fkey;

-- Mark the node, so a human opening this database knows what it is and the app
-- can refuse to treat it as if it held identity.
insert into tracker.app_config (key, value)
values ('plane', 'data')
on conflict (key) do update set value = excluded.value;

commit;

-- Verify — must return 0:
--   select count(*) from pg_constraint con
--   join pg_class c  on c.oid  = con.conrelid
--   join pg_class tc on tc.oid = con.confrelid
--   join pg_namespace tn on tn.oid = tc.relnamespace
--   where con.contype = 'f'
--     and c.relname in ('issues','issue_embeddings','issue_comments','pr_comments',
--                       'pull_requests','pull_request_analyses','mind_context',
--                       'public_issue_reporters')
--     and (tn.nspname = 'auth' or tc.relname in ('projects','public_sessions'));
