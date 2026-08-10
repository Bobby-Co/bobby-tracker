-- GitLab integration — provider discriminator + GitLab-specific link/credential
-- storage, alongside the existing GitHub wiring (0031/0036/0037/0039/0041).
--
-- The VCS module (modules/vcs) is already provider-agnostic; this migration adds
-- the DATA a second provider needs. Three additions:
--
--   1. tracker.provider_tokens — a multi-provider replacement for the user-
--      authority OAuth token. github_tokens is keyed by user_id alone and assumes
--      a long-lived, non-expiring classic token; GitLab tokens expire (~2h) and
--      carry a refresh token, and a user may connect BOTH providers — so this is
--      keyed (user_id, provider) with an expires_at. GitHub keeps using
--      github_tokens for now; a later migration can fold it in here.
--
--   2. tracker.projects.provider + gitlab_project_id — the discriminator the
--      composition root (modules/vcs/Composition.ts) branches on, plus the stable
--      numeric GitLab project id used to route an inbound webhook back to a
--      project (the GitLab analog of github_repo_id). The existing sync-setting
--      columns (github_sync_enabled / _direction / _deletes, auto_index_on_push)
--      are provider-neutral in meaning and are REUSED for GitLab — no new copies.
--
--   3. tracker.gitlab_project_links — the per-project bot credential + webhook
--      registration. GitLab has no "app installation" concept (cf.
--      github_installations); the bot credential is a Project Access Token
--      provisioned per repo via the owner's OAuth token, and each project webhook
--      has its OWN secret (X-Gitlab-Token), unlike GitHub's single app-level
--      secret. These are secrets, so the table is SERVICE-ROLE ONLY (no owner
--      select) — the UI reads connection status from projects.gitlab_project_id,
--      never the credential itself.

-- ─── 1. multi-provider user OAuth tokens ────────────────────────────────────

create table if not exists tracker.provider_tokens (
    user_id           uuid        not null references auth.users(id) on delete cascade,
    -- 'github' | 'gitlab'. A user may connect both, hence the composite PK.
    provider          text        not null check (provider in ('github', 'gitlab')),
    -- The instance this credential is for. 'gitlab.com', or a self-managed host
    -- like 'gitlab.acme.com'. Part of the key because this is a PUBLIC service:
    -- one user can connect BOTH public gitlab.com (via OAuth) and their own
    -- self-hosted instance(s) (via a pasted token) — different hosts, different
    -- rows. GitHub rows use 'github.com'.
    host              text        not null default 'gitlab.com',
    -- How the credential was obtained: 'oauth' (gitlab.com, Supabase-brokered,
    -- refreshable) or 'pat' (a user-pasted Personal/Project Access Token for a
    -- self-managed instance — the only mechanism that works across arbitrary
    -- instances, since OAuth can't be brokered to an unknown host).
    auth_kind         text        not null default 'oauth' check (auth_kind in ('oauth', 'pat')),
    -- The user's access token (acts AS the signed-in user).
    access_token      text        not null,
    -- Refresh token. OAuth (gitlab.com) issues one; used to mint a new access
    -- token when the current one expires (no scheduler here — refresh is lazy,
    -- on read, when expires_at has passed). Null for PATs.
    refresh_token     text,
    -- When access_token expires. Null = non-expiring (a PAT with no expiry).
    expires_at        timestamptz,
    -- Space/comma-separated granted scopes, for deciding whether to re-consent.
    scopes            text,
    -- Provider numeric user id (diagnostics) + login ("connected as @user").
    provider_user_id  text,
    provider_login    text,
    -- API base for a self-managed instance (e.g. https://gitlab.acme.com/api/v4).
    -- Null → derive from host (https://<host>/api/v4).
    api_base          text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    primary key (user_id, provider, host)
);

drop trigger if exists touch_provider_tokens on tracker.provider_tokens;
create trigger touch_provider_tokens
    before update on tracker.provider_tokens
    for each row execute function tracker.touch_updated_at();

alter table tracker.provider_tokens enable row level security;

drop policy if exists provider_tokens_owner_select on tracker.provider_tokens;
create policy provider_tokens_owner_select on tracker.provider_tokens
    for select using (user_id = auth.uid());

drop policy if exists provider_tokens_owner_insert on tracker.provider_tokens;
create policy provider_tokens_owner_insert on tracker.provider_tokens
    for insert with check (user_id = auth.uid());

drop policy if exists provider_tokens_owner_update on tracker.provider_tokens;
create policy provider_tokens_owner_update on tracker.provider_tokens
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists provider_tokens_owner_delete on tracker.provider_tokens;
create policy provider_tokens_owner_delete on tracker.provider_tokens
    for delete using (user_id = auth.uid());

grant all on tracker.provider_tokens to authenticated, service_role;

-- ─── 2. projects: provider discriminator + GitLab repo id ───────────────────

alter table tracker.projects
    -- Existing rows are GitHub; default keeps them so with no backfill needed.
    add column if not exists provider          text   not null default 'github'
        check (provider in ('github', 'gitlab')),
    -- Stable numeric GitLab project id — the rename-proof join key for routing
    -- an inbound GitLab webhook back to a project (mirrors github_repo_id).
    add column if not exists gitlab_project_id bigint;

-- One project per linked GitLab repo → unambiguous inbound routing. Partial so
-- unlinked projects (gitlab_project_id is null) don't collide (mirrors
-- projects_github_repo_id_uniq).
create unique index if not exists projects_gitlab_project_id_uniq
    on tracker.projects (gitlab_project_id)
    where gitlab_project_id is not null;

-- ─── 3. per-project GitLab bot credential + webhook (service-role only) ──────

create table if not exists tracker.gitlab_project_links (
    -- One link per project (GitLab has no cross-repo installation concept).
    project_id         uuid        primary key references tracker.projects(id) on delete cascade,
    -- The numeric GitLab project id, mirrored here for the webhook route's
    -- id → link lookup (projects also carries it for the id → project routing).
    gitlab_project_id  bigint      not null,
    -- The provisioned Project Access Token acting as the bot (app authority).
    -- Rotated lazily via the owner's provider_tokens refresh token on 401/expiry.
    access_token       text,
    -- PAT expiry (GitLab mandates one, max ~365d). Drives lazy re-provisioning.
    token_expires_at   timestamptz,
    -- The registered project-hook id, so we can update/delete the hook later.
    webhook_id         bigint,
    -- This project's webhook secret (compared to X-Gitlab-Token, constant-time).
    -- Per-project, unlike GitHub's single GITHUB_APP_WEBHOOK_SECRET.
    webhook_secret     text,
    -- API base for self-managed GitLab (e.g. https://git.example.com/api/v4).
    -- Null → gitlab.com. Derived from the project's repo_url host at link time.
    api_base           text,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create index if not exists gitlab_project_links_gitlab_project_id_idx
    on tracker.gitlab_project_links (gitlab_project_id);

drop trigger if exists touch_gitlab_project_links on tracker.gitlab_project_links;
create trigger touch_gitlab_project_links
    before update on tracker.gitlab_project_links
    for each row execute function tracker.touch_updated_at();

-- Secrets live here (bot PAT + webhook secret): service-role only. RLS is on
-- with NO policies, and no grant to `authenticated`, so only the service-role
-- client (webhook + link/provision flows, which bypass RLS) can touch it.
alter table tracker.gitlab_project_links enable row level security;
grant all on tracker.gitlab_project_links to service_role;

-- ─── 4. generic webhook-delivery idempotency ledger ─────────────────────────

-- GitLab redelivers hooks; X-Gitlab-Event-UUID is the stable delivery id. A
-- generic (provider, delivery_id) ledger dedupes them the way
-- github_webhook_deliveries does for GitHub (that table stays as-is; this one
-- serves GitLab and any future provider). Service-role only.
create table if not exists tracker.webhook_deliveries (
    provider     text        not null,
    delivery_id  text        not null,
    event        text,
    created_at   timestamptz not null default now(),
    primary key (provider, delivery_id)
);

alter table tracker.webhook_deliveries enable row level security;
grant all on tracker.webhook_deliveries to service_role;
