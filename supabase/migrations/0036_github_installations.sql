-- tracker.github_installations — the "Bobby" GitHub App installation
-- registry and installation-token cache backing the two-way issue sync.
--
-- When a user installs the Bobby GitHub App, the install callback and the
-- `installation` webhook record the installation here. The row carries the
-- installation-token cache (`cached_token`/`token_expires_at`) so
-- lib/github-app.ts can reuse a short-lived installation access token
-- across requests instead of re-minting on every call — a DB-column cache
-- is strongly consistent and needs no new infra (no KV binding in v1).
--
-- `user_id` is set only by the install callback, the one flow that knows
-- which tracker user installed the app; webhook-driven upserts leave it
-- untouched. RLS lets a user read their own installations; all writes go
-- through the service-role client (install callback + webhook), which
-- bypasses RLS. suspended_at / deleted_at are soft-delete lifecycle
-- markers driven by the `installation` webhook (suspend / unsuspend /
-- deleted actions).

create table if not exists tracker.github_installations (
    -- GitHub's numeric installation id — the stable join key we key
    -- installation tokens and repo lookups on.
    installation_id   bigint      primary key,
    -- Set by the install callback (the only flow that knows the tracker
    -- user); null for installations only ever seen via webhook.
    user_id           uuid        references auth.users(id) on delete cascade,
    -- The GitHub account (user or org) the app is installed on.
    account_login     text,
    account_type      text,
    account_id        bigint,
    -- Installation access token cache. Short-lived (~1h); re-minted with
    -- a 5-min safety margin by lib/github-app.ts.
    cached_token      text,
    token_expires_at  timestamptz,
    -- Soft-delete lifecycle, driven by the `installation` webhook.
    suspended_at      timestamptz,
    deleted_at        timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index if not exists github_installations_user_id_idx
    on tracker.github_installations (user_id);

drop trigger if exists touch_github_installations on tracker.github_installations;
create trigger touch_github_installations
    before update on tracker.github_installations
    for each row execute function tracker.touch_updated_at();

alter table tracker.github_installations enable row level security;

-- Owner-select only; writes are service-role (install callback + webhook).
drop policy if exists github_installations_owner_select on tracker.github_installations;
create policy github_installations_owner_select on tracker.github_installations
    for select using (user_id = auth.uid());

grant all on tracker.github_installations to authenticated, service_role;
