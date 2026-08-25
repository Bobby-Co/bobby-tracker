-- 0075_deleted_account_usage.sql — free credits survive an account deletion.
--
-- ─── The hole ────────────────────────────────────────────────────────────────
--
-- Prowl's free allowance is per TEAM per calendar month (0059): a team's balance
-- is its tier allowance minus the spend recorded against (team_id, period_start).
-- Delete the account and the team goes with it; sign up again and the new team
-- gets a fresh Kit subscription with an untouched allowance. The whole monthly
-- limit resets for the price of two clicks, as often as you like.
--
-- ─── What is kept, and what is not ───────────────────────────────────────────
--
-- One row per deleted address: how much that person had spent in the month they
-- left, and nothing else. No name, no projects, no history, and NOT the address
-- itself — only a SHA-256 of it (peppered when BOBBY_ACCOUNT_PEPPER is set). The
-- row is write-once at deletion, read once at the next sign-up, and unreadable
-- to anyone who does not already know the email they are looking for.
--
-- That is the whole point of hashing here: the table can answer "has THIS address
-- deleted an account recently?" — which is the anti-abuse question — while being
-- useless as a list of people who left, which is not a list we have any business
-- keeping.
--
-- ─── Why it expires, and why the expiry is enforced in the query ─────────────
--
-- Retention is 30 days, comfortably longer than the abuse window (a calendar
-- month) so a row cannot expire in the middle of the period it protects.
--
-- There is NO SCHEDULER in this stack — no cron, no pg_cron, no OpenNext
-- scheduled handler — so nothing will come along and delete these rows for us.
-- An `expires_at` column that only a background job honours would be a promise
-- the deployment cannot keep. So every read filters on it (an expired row is
-- invisible, whether or not it is still on disk) and every write sweeps the
-- expired ones out. Retention is therefore a property of the queries, which do
-- run, rather than of a job that does not exist.

create table if not exists tracker.deleted_account_usage (
    -- SHA-256 of the lower-cased email, hex. Primary key: one row per address,
    -- and a later deletion by the same person REPLACES it rather than adding to
    -- it — by then the earlier figure has already been carried into the account
    -- being deleted, so the new snapshot includes it. Summing would double-count.
    email_hash   text        primary key,

    -- The UTC month the spend belongs to. The carry only applies when the person
    -- comes back INSIDE this same month: past its end the allowance would have
    -- reset for everybody, and charging them for a month they sat out would
    -- punish a legitimate return rather than an abusive one.
    period_start timestamptz not null,

    -- Raw cost, matching prowl_usage_events.cost_usd — points are derived from it
    -- at read time (modules/billing), never stored, so the rate can be retuned
    -- without rewriting history. `calls` is carried for the same reason the
    -- rollup carries it: it makes the restored row legible in the ledger.
    cost_usd     numeric(14, 6) not null default 0,
    calls        integer     not null default 0,

    deleted_at   timestamptz not null default now(),
    expires_at   timestamptz not null default now() + interval '30 days',

    constraint deleted_account_usage_hash_chk check (email_hash ~ '^[0-9a-f]{64}$'),
    constraint deleted_account_usage_expiry_chk check (expires_at > deleted_at)
);

-- The sweep that stands in for a cron job: every write path deletes what has
-- expired, so this index is what keeps that cheap.
create index if not exists deleted_account_usage_expires_idx
    on tracker.deleted_account_usage (expires_at);

alter table tracker.deleted_account_usage enable row level security;

grant all on tracker.deleted_account_usage to authenticated, service_role;

comment on table tracker.deleted_account_usage is
    'Anti-abuse tombstone: this month''s Prowl spend of a deleted account, keyed by '
    'a SHA-256 of the email, so deleting and re-registering cannot reset the free '
    'monthly allowance. Expires after 30 days; the expiry is enforced by every '
    'query because this stack has no scheduler to enforce it out of band. Written '
    'by DELETE /api/account, consumed by the next team the same address creates.';
