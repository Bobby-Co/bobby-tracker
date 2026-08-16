-- reset-project-data.sql — DESTRUCTIVE. Clears all project content while keeping
-- accounts, teams and connections intact.
--
-- ⚠️  READ BEFORE RUNNING. This deletes every project, issue, pull request,
--     comment, embedding, session and notification. There is no undo other than a
--     Supabase point-in-time restore. Take a backup first if there is anything
--     here you would miss.
--
-- ─── You probably do not need this ───────────────────────────────────────────
--
-- The regional split is backward compatible: the primary stays a valid data plane
-- for `north-america` projects, so existing projects keep working exactly as they
-- are, with their issues where they already live. Asia only ever receives content
-- for projects placed in `south-east-asia`. Nothing needs migrating, so nothing
-- needs clearing. Run this only if you want an empty slate to observe the new
-- behaviour without old rows confusing the picture.
--
-- ─── What survives, and why ──────────────────────────────────────────────────
--
--   auth.users            you stay signed in; no one has to re-register
--   teams, team_members   your team structure and roles
--   team_subscriptions    billing tier and allowance
--   github_tokens,        the OAuth connections you would otherwise have to
--   provider_tokens,      re-authorise one by one
--   github_installations
--   mcp_oauth_*           MCP clients stay paired (re-pairing is painful — see
--                         the comment at the top of app/mcp/route.ts)
--   icon_catalog*         expensive to rebuild (it is an embedding job)
--   app_config            holds the notification-email callback token
--   relay_workers,        paired devices stay paired
--   relay_pairings
--
-- To also drop accounts and teams, do NOT extend this script — use the Supabase
-- dashboard's own project reset. A hand-rolled DELETE across auth.* leaves
-- Supabase's internal auth state inconsistent in ways that are hard to spot.
--
-- ─── How it works ────────────────────────────────────────────────────────────
--
-- One TRUNCATE naming the four roots. CASCADE follows the foreign keys to
-- everything that hangs off them, which is why the list is short: issues,
-- embeddings, comments, PRs, analyser rows, tags, insights and integration flags
-- all descend from `projects`. Doing it in a single statement lets Postgres work
-- out the order.

begin;

truncate table
    tracker.projects,             -- → issues, embeddings, comments, PRs, analyser,
                                  --   tags, insight, mcp/public integration, groups' members
    tracker.public_sessions,      -- → session projects, invites, reporters
    tracker.project_groups,       -- Collections
    tracker.prowl_usage_events,   -- usage ledger
    tracker.prowl_usage_period,   -- and its rollup
    tracker.notifications,        -- the in-app feed
    tracker.notification_outbox,  -- undelivered notification jobs
    tracker.webhook_deliveries,   -- delivery dedupe ledgers: safe to clear, they
    tracker.github_webhook_deliveries  -- only prevent replaying old deliveries
    restart identity cascade;

commit;

-- Sanity check — every one of these should be 0:
--   select 'projects' t, count(*) from tracker.projects
--   union all select 'issues', count(*) from tracker.issues
--   union all select 'issue_embeddings', count(*) from tracker.issue_embeddings
--   union all select 'pull_requests', count(*) from tracker.pull_requests;
--
-- And these should NOT be 0 (proving accounts survived):
--   select 'teams' t, count(*) from tracker.teams
--   union all select 'team_members', count(*) from tracker.team_members;
