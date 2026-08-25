-- 0074_beta_allowlist.sql — the beta whitelist moves out of the environment.
--
-- ─── What it replaced ────────────────────────────────────────────────────────
--
-- NEXT_PUBLIC_BETA_ALLOWED_EMAILS: a comma-separated list, baked into the client
-- bundle at build time. Three problems, all fatal to actually running a beta:
-- enrolling someone needs a redeploy, the list is public (it ships to every
-- visitor's browser), and there is no record of who was invited, by whom, or
-- when they first came through.
--
-- The env var SURVIVES as a staff bypass — a short list of our own addresses so
-- the team is never locked out by a bad row or an unapplied migration — and
-- nothing else. Beta enrolment happens here.
--
-- ─── How the gate reads this table ───────────────────────────────────────────
--
-- It doesn't, directly. The gate (lib/shared/BetaAccess.ts) runs in the BROWSER
-- as well as on the server, and since 0067 the browser reads nothing from
-- tracker.* — so a client-side `select` here would silently return zero rows and
-- lock everyone out. The flow instead is:
--
--   sign-in (or POST /api/beta/access)
--     → server looks the address up here with the service-role key
--     → on a hit, stamps `whitelisted: true` into the user's auth metadata
--       and records granted_at/granted_user below
--     → the flag now rides in the JWT, so every existing call site keeps its
--       synchronous check
--
-- Enrolment therefore takes effect on the user's next session refresh, which the
-- waitlist page triggers for itself. Removing a row does NOT evict anyone — the
-- stamp is already in their metadata; see the revoke note in
-- modules/beta/application/BetaEnrollmentService.ts.
--
-- ─── RLS ─────────────────────────────────────────────────────────────────────
--
-- Both tables are enabled with NO policies, per 0067: an email list is precisely
-- the kind of table that must be unreachable with the published anon key. Every
-- read and write below goes through the service-role client on the server.

-- ─── the allowlist: who is in the beta ───────────────────────────────────────
create table if not exists tracker.beta_allowlist (
    -- The address as the identity provider reports it, lower-cased. Primary key
    -- rather than a surrogate id: enrolment is BY address, an address is in the
    -- beta exactly once, and an upsert on conflict (email) is how re-inviting
    -- someone updates the note instead of failing.
    email        text        primary key,
    -- Who added them, when they were added, and a free-text note ("YC batch",
    -- "design partner") — the audit the env var never had. `invited_by` is a
    -- soft reference: no FK, because the enroller's account being deleted must
    -- not cascade into revoking the beta access they granted.
    invited_by   uuid,
    note         text,
    created_at   timestamptz not null default now(),
    -- Stamped the first time the address actually signs in and is let through.
    -- The gap between created_at and granted_at is "invited but never showed
    -- up", which is the one question an invite list always ends up being asked.
    granted_at   timestamptz,
    granted_user uuid,

    -- Normalisation is enforced, not assumed. The lookup is an equality match on
    -- this column, so a row inserted by hand from the SQL editor as
    -- "Foo@Example.com" would be a row that can never match anyone.
    constraint beta_allowlist_email_normalised
        check (email = lower(btrim(email)) and email like '%_@_%')
);

-- ─── the queue: who asked to be let in ───────────────────────────────────────
--
-- "Join the beta" on /waitlist used to write `beta_requested` into the user's
-- auth metadata and stop there — which meant the answer to "who wants in?" lived
-- in a place nothing can query without paging every auth user. Same list, in a
-- table you can sort.
create table if not exists tracker.beta_requests (
    email        text        primary key,
    -- The signed-in account that asked. Soft reference for the same reason as
    -- above, and because the queue outliving a deleted account is harmless.
    user_id      uuid,
    display_name text,
    requested_at timestamptz not null default now(),
    -- Which surface the request came from, so a second entry point later doesn't
    -- need a schema change to be told apart (same trick as newsletter_subscribers).
    source       text        not null default 'waitlist',

    constraint beta_requests_email_normalised
        check (email = lower(btrim(email)) and email like '%_@_%')
);

-- The queue is read newest-first and, once it is more than a screenful, filtered
-- to those not yet enrolled. Both are served by this.
create index if not exists beta_requests_requested_at_idx
    on tracker.beta_requests (requested_at desc);

alter table tracker.beta_allowlist enable row level security;
alter table tracker.beta_requests  enable row level security;

-- 0073 made these grants automatic for tables created after it (alter default
-- privileges), but stating them keeps the file readable on its own and costs
-- nothing if they are already in place.
grant all on tracker.beta_allowlist to authenticated, service_role;
grant all on tracker.beta_requests  to authenticated, service_role;

comment on table tracker.beta_allowlist is
    'Beta enrolment list — the source of truth that replaced '
    'NEXT_PUBLIC_BETA_ALLOWED_EMAILS. Read server-side only (service role); the '
    'browser gate reads the `whitelisted` auth-metadata flag stamped from here '
    'at sign-in. See modules/beta.';

comment on table tracker.beta_requests is
    'Waitlist queue — people who pressed "Join the beta". The list you enrol '
    'FROM; tracker.beta_allowlist is the list you enrol INTO.';

-- Seed: carry over the addresses that were in the env var, so applying this
-- migration never locks out whoever is already in. Idempotent, and the staff
-- bypass keeps working either way.
insert into tracker.beta_allowlist (email, note)
values ('peterphongpak@gmail.com', 'seeded from NEXT_PUBLIC_BETA_ALLOWED_EMAILS (0074)')
on conflict (email) do nothing;
