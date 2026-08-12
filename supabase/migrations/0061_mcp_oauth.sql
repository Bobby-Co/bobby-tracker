-- tracker.mcp_oauth_clients / _codes / _tokens — the backing store for the
-- self-contained OAuth 2.1 Authorization Server this app exposes so Claude
-- (Claude Code / Desktop / claude.ai) can authorize against the remote MCP
-- server at /api/mcp.
--
-- The Authorization Server and the Resource Server are the SAME app, so there
-- is no JWT to verify: access tokens are OPAQUE random strings and validation
-- is a lookup in mcp_oauth_tokens. That buys instant revocation (revoked_at)
-- and costs no signing key — mirroring the precedent set by tracker.relay_workers
-- (0033), whose opaque per-user bearer token works exactly the same way.
--
-- SECRETS ARE NEVER STORED IN THE CLEAR. Only SHA-256 hashes (base64url) of the
-- authorization code, the access token, the refresh token and any client secret
-- land in these tables; a database leak therefore yields nothing replayable.
--
-- SERVICE ROLE is load-bearing here, not boilerplate. The token endpoint has no
-- cookie (it is called by a CLI/desktop client), and the authorization code is
-- minted before any bearer token exists, so every write below happens through
-- Supabase.service() with RLS bypassed. Because RLS is bypassed there, the app
-- repositories filter every query explicitly (client_id / user_id / revoked_at /
-- expires_at) — see modules/mcp-oauth/infrastructure.
--
-- RLS is still enabled on all three tables so that the ONLY thing a signed-in
-- user can reach with their anon key is their OWN token rows: read them (to list
-- "connected MCP clients") and revoke them (update revoked_at). Column-level
-- grants make that literal — `authenticated` may update revoked_at and nothing
-- else. Clients and codes get no user-facing policy at all; with RLS enabled and
-- no policy, `authenticated` sees zero rows.

-- ─── tracker.mcp_oauth_clients ──────────────────────────────────────────────
-- One row per client registered through RFC 7591 Dynamic Client Registration.
-- Claude registers itself as a PUBLIC client (token_endpoint_auth_method 'none',
-- no secret) and relies on PKCE; the confidential case is supported for
-- completeness (client_secret_hash non-null).
create table if not exists tracker.mcp_oauth_clients (
    client_id                   text        primary key,
    -- SHA-256 (base64url) of the client secret. NULL for public clients.
    client_secret_hash          text,
    client_name                 text        not null default 'Unnamed client',
    -- Exact-match allow-list. An authorize request whose redirect_uri is not
    -- byte-identical to one of these is refused WITHOUT redirecting.
    redirect_uris               text[]      not null,
    grant_types                 text[]      not null default array['authorization_code', 'refresh_token'],
    token_endpoint_auth_method  text        not null default 'none',
    client_uri                  text,
    created_at                  timestamptz not null default now(),
    constraint mcp_oauth_clients_redirect_uris_not_empty
        check (array_length(redirect_uris, 1) >= 1),
    constraint mcp_oauth_clients_auth_method_known
        check (token_endpoint_auth_method in ('none', 'client_secret_basic', 'client_secret_post'))
);

alter table tracker.mcp_oauth_clients enable row level security;

-- No policy: only the service role (which bypasses RLS) touches this table.
grant all on tracker.mcp_oauth_clients to service_role;

-- ─── tracker.mcp_oauth_codes ────────────────────────────────────────────────
-- Single-use, ~60s authorization codes. The row is keyed by the code's HASH, so
-- the code itself exists only in the redirect that carried it. `consumed_at` is
-- stamped by a conditional UPDATE ... where consumed_at is null, which makes
-- consumption atomic: a replayed code loses the race, and the token endpoint
-- then revokes every token previously issued from it (RFC 6749 §4.1.2).
create table if not exists tracker.mcp_oauth_codes (
    code_hash               text        primary key,
    client_id               text        not null references tracker.mcp_oauth_clients(client_id) on delete cascade,
    user_id                 uuid        not null references auth.users(id) on delete cascade,
    -- Bound at mint time; the token request must present the identical value.
    redirect_uri            text        not null,
    -- PKCE (RFC 7636). S256 only — 'plain' is rejected at the authorize endpoint.
    code_challenge          text        not null,
    code_challenge_method   text        not null default 'S256'
                            check (code_challenge_method = 'S256'),
    scope                   text        not null default 'mcp:read',
    -- RFC 8707 resource indicator, i.e. <APP_URL>/api/mcp. Optional.
    resource                text,
    expires_at              timestamptz not null,
    consumed_at             timestamptz,
    created_at              timestamptz not null default now()
);

create index if not exists mcp_oauth_codes_client_idx  on tracker.mcp_oauth_codes (client_id);
create index if not exists mcp_oauth_codes_user_idx    on tracker.mcp_oauth_codes (user_id);
create index if not exists mcp_oauth_codes_expires_idx on tracker.mcp_oauth_codes (expires_at);

alter table tracker.mcp_oauth_codes enable row level security;

-- No policy: codes are only ever read/written by the service role.
grant all on tracker.mcp_oauth_codes to service_role;

-- ─── tracker.mcp_oauth_tokens ───────────────────────────────────────────────
-- One row per issued access/refresh pair. Refresh rotation inserts a NEW row and
-- stamps revoked_at on the old one, so the table doubles as the audit trail of a
-- client's session chain. `code_hash` records which authorization code minted the
-- row, which is what lets a detected code replay revoke the tokens that code
-- already produced.
create table if not exists tracker.mcp_oauth_tokens (
    id                  uuid        primary key default gen_random_uuid(),
    -- SHA-256 (base64url) of the opaque access token ("bmcp_…").
    token_hash          text        not null unique,
    -- SHA-256 (base64url) of the opaque refresh token ("bmcp_rt_…"). NULL when
    -- the grant issued no refresh token.
    refresh_hash        text        unique,
    client_id           text        not null references tracker.mcp_oauth_clients(client_id) on delete cascade,
    user_id             uuid        not null references auth.users(id) on delete cascade,
    scope               text        not null default 'mcp:read',
    expires_at          timestamptz not null,
    refresh_expires_at  timestamptz,
    -- Set on explicit revoke, on refresh rotation, and on replay detection.
    -- A non-null value makes the token stop resolving immediately.
    revoked_at          timestamptz,
    last_used_at        timestamptz,
    created_at          timestamptz not null default now(),
    -- Provenance: the authorization code this pair descends from. Carried across
    -- refresh rotations so replay revocation reaches the whole chain.
    code_hash           text
);

-- token_hash / refresh_hash are already indexed by their UNIQUE constraints.
create index if not exists mcp_oauth_tokens_user_idx    on tracker.mcp_oauth_tokens (user_id);
create index if not exists mcp_oauth_tokens_client_idx  on tracker.mcp_oauth_tokens (client_id);
create index if not exists mcp_oauth_tokens_code_idx    on tracker.mcp_oauth_tokens (code_hash)
    where code_hash is not null;
create index if not exists mcp_oauth_tokens_active_idx  on tracker.mcp_oauth_tokens (user_id, client_id)
    where revoked_at is null;

alter table tracker.mcp_oauth_tokens enable row level security;

-- A signed-in user may LIST their own connected clients …
drop policy if exists mcp_oauth_tokens_owner_select on tracker.mcp_oauth_tokens;
create policy mcp_oauth_tokens_owner_select on tracker.mcp_oauth_tokens
    for select using (user_id = auth.uid());

-- … and REVOKE them. The column grant below narrows this to revoked_at, so the
-- policy cannot be used to re-point a token at another user or extend its life.
drop policy if exists mcp_oauth_tokens_owner_revoke on tracker.mcp_oauth_tokens;
create policy mcp_oauth_tokens_owner_revoke on tracker.mcp_oauth_tokens
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on tracker.mcp_oauth_tokens to authenticated;
grant update (revoked_at) on tracker.mcp_oauth_tokens to authenticated;
grant all on tracker.mcp_oauth_tokens to service_role;
