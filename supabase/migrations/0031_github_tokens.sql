-- tracker.github_tokens — captures the GitHub OAuth provider token from
-- the Supabase auth callback so the app can (a) list the user's repos
-- when adding a project and (b) hand a short-lived clone credential to
-- bobby-analyser for private repos.
--
-- Supabase exposes `provider_token` / `provider_refresh_token` only in
-- the session that comes out of the OAuth callback; if we want them
-- afterwards we have to persist them ourselves. RLS keeps each user
-- locked to their own row.

create table if not exists tracker.github_tokens (
    user_id           uuid        primary key references auth.users(id) on delete cascade,
    -- GitHub access token (classic OAuth: long-lived, no expiry).
    access_token      text        not null,
    -- GitHub refresh token. Always null today (classic OAuth doesn't
    -- issue one); reserved for the GitHub-App migration so we don't
    -- have to add a column later.
    refresh_token     text,
    -- Space-separated OAuth scopes returned by GitHub. We compare
    -- against this to decide whether to prompt the user to reconnect
    -- with broader scope (e.g. missing `repo`).
    scopes            text,
    -- Stable GitHub numeric user id, captured for diagnostics.
    provider_user_id  text,
    -- GitHub login, for showing "connected as @octocat" in the UI.
    provider_login    text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

drop trigger if exists touch_github_tokens on tracker.github_tokens;
create trigger touch_github_tokens
    before update on tracker.github_tokens
    for each row execute function tracker.touch_updated_at();

alter table tracker.github_tokens enable row level security;

drop policy if exists github_tokens_owner_select on tracker.github_tokens;
create policy github_tokens_owner_select on tracker.github_tokens
    for select using (user_id = auth.uid());

drop policy if exists github_tokens_owner_insert on tracker.github_tokens;
create policy github_tokens_owner_insert on tracker.github_tokens
    for insert with check (user_id = auth.uid());

drop policy if exists github_tokens_owner_update on tracker.github_tokens;
create policy github_tokens_owner_update on tracker.github_tokens
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists github_tokens_owner_delete on tracker.github_tokens;
create policy github_tokens_owner_delete on tracker.github_tokens
    for delete using (user_id = auth.uid());

grant all on tracker.github_tokens to authenticated, service_role;
