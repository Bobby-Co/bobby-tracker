-- tracker.relay_workers + tracker.relay_pairings — the bobby-relay
-- menubar app's device-pairing and worker-management backing store.
--
-- A "worker" is a user's local machine that exposes a local LLM to the
-- bobby-analyser server. The relay app has no Supabase session, so it
-- pairs via an OAuth-device-flow-style handshake: it POSTs /relay/pair/start
-- to mint a (device_code, user_code) pair, the user approves the user_code
-- while signed into the tracker, and the relay polls /relay/pair/poll to
-- collect the opaque worker token. The analyser later resolves that token
-- back to a userId via /relay/resolve. Revoking a worker (revoked_at) stops
-- the token resolving, which makes revoke real.
--
-- RLS locks each user to their own workers/pairings. The unauthenticated
-- relay endpoints (pair/start, pair/poll, resolve) run through the
-- service-role client, which bypasses RLS.

create table if not exists tracker.relay_workers (
    id            uuid        primary key default gen_random_uuid(),
    user_id       uuid        not null references auth.users(id) on delete cascade,
    -- Human-friendly device label shown in the workers UI.
    name          text        not null default 'My Mac',
    -- Opaque bearer token the relay presents to the analyser. The
    -- analyser resolves it to user_id via /relay/resolve. Unique so a
    -- token maps to exactly one worker.
    token         text        not null unique,
    -- Last known reachable endpoint for the local LLM, when the relay
    -- reports one. Null until the relay connects.
    endpoint      text,
    -- Models the worker advertises: [{id, supportsTools?, contextWindow?}].
    models        jsonb       not null default '[]'::jsonb,
    created_at    timestamptz not null default now(),
    -- Bumped by /relay/resolve so the UI can show recency.
    last_seen_at  timestamptz,
    -- Set on revoke; revoked rows stop resolving and drop out of the UI.
    revoked_at    timestamptz
);

create index if not exists relay_workers_user_id_idx on tracker.relay_workers (user_id);

alter table tracker.relay_workers enable row level security;

drop policy if exists relay_workers_owner_select on tracker.relay_workers;
create policy relay_workers_owner_select on tracker.relay_workers
    for select using (user_id = auth.uid());

drop policy if exists relay_workers_owner_insert on tracker.relay_workers;
create policy relay_workers_owner_insert on tracker.relay_workers
    for insert with check (user_id = auth.uid());

drop policy if exists relay_workers_owner_update on tracker.relay_workers;
create policy relay_workers_owner_update on tracker.relay_workers
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists relay_workers_owner_delete on tracker.relay_workers;
create policy relay_workers_owner_delete on tracker.relay_workers
    for delete using (user_id = auth.uid());

grant all on tracker.relay_workers to authenticated, service_role;

create table if not exists tracker.relay_pairings (
    id            uuid        primary key default gen_random_uuid(),
    -- Secret the relay polls with. Never shown to the user.
    device_code   text        not null unique,
    -- Short code the user types/approves while signed into the tracker.
    user_code     text        not null unique,
    -- Bound on approval (the approving user).
    user_id       uuid        references auth.users(id) on delete cascade,
    -- The worker minted on approval.
    worker_id     uuid        references tracker.relay_workers(id) on delete set null,
    status        text        not null default 'pending'
                  check (status in ('pending', 'approved', 'denied', 'expired', 'consumed')),
    -- Suggested device name carried from pair/start to the minted worker.
    worker_name   text,
    created_at    timestamptz not null default now(),
    expires_at    timestamptz not null,
    approved_at   timestamptz,
    consumed_at   timestamptz
);

alter table tracker.relay_pairings enable row level security;

-- pair/start + poll operate via service_role before a user_id is bound;
-- the owner policies only cover rows already claimed by a user.
drop policy if exists relay_pairings_owner_select on tracker.relay_pairings;
create policy relay_pairings_owner_select on tracker.relay_pairings
    for select using (user_id = auth.uid());

drop policy if exists relay_pairings_owner_update on tracker.relay_pairings;
create policy relay_pairings_owner_update on tracker.relay_pairings
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());

grant all on tracker.relay_pairings to authenticated, service_role;
