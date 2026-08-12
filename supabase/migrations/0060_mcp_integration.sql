-- Treat "expose this project's knowledge base over MCP" as a per-project
-- integration, mirroring tracker.project_public_integration (0011).
--
--   tracker.project_mcp_integration — one row per project, opt-in.
--   Projects default to DISABLED: a knowledge base is only reachable by an
--   MCP client once someone deliberately turns it on.
--
-- AUTHORISATION — the TEAM-AWARE pattern, not 0011's original owner-only one.
-- 0011 shipped before teams; migration 0052 moved every project-gated table to
-- the coarse team gate and explicitly rewrote project_public_integration's
-- policy to `tracker.member_of_project_team(project_id)`. A fresh owner-scoped
-- (projects.user_id = auth.uid()) policy would be inconsistent with that and
-- would break outright for team-owned projects whose creator has left
-- (projects.user_id is nullable since 0052). So this table is born team-aware.
--
-- The finer intra-team rule — only an admin/owner may FLIP the switch — is
-- enforced in the app layer (the PATCH route's requireRole(role, "admin")),
-- matching the hybrid model 0052/0059 describe: coarse tenant isolation in RLS,
-- rich role logic in modules/access.
--
-- SERVICE ROLE: the MCP server resolves a project's exposure without a browser
-- session, so it reads this table through Supabase.service() (RLS bypass). The
-- service_role grant below is load-bearing, not boilerplate.

-- ─── tracker.project_mcp_integration ────────────────────────────────────────
create table if not exists tracker.project_mcp_integration (
    project_id  uuid primary key references tracker.projects(id) on delete cascade,
    enabled     boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

drop trigger if exists touch_project_mcp_integration on tracker.project_mcp_integration;
create trigger touch_project_mcp_integration
    before update on tracker.project_mcp_integration
    for each row execute function tracker.touch_updated_at();

alter table tracker.project_mcp_integration enable row level security;

-- Coarse tenant backstop: a row is visible/writable iff you are a member of the
-- team that owns the project. Cross-team access is impossible by construction.
drop policy if exists project_mcp_integration_owner_all on tracker.project_mcp_integration;
drop policy if exists project_mcp_integration_team_all  on tracker.project_mcp_integration;
create policy project_mcp_integration_team_all on tracker.project_mcp_integration
    for all
    using      (tracker.member_of_project_team(project_id))
    with check (tracker.member_of_project_team(project_id));

grant all on tracker.project_mcp_integration to authenticated, service_role;

-- Deliberately NO backfill: exposing a knowledge base is opt-in, so every
-- existing project starts with no row, which the app reads as disabled.
