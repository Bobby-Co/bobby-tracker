-- tracker: the transactional OUTBOX for the Notifications module.
--
-- WHY AN OUTBOX: this stack has NO cron and no queue (OpenNext has no scheduled
-- handler), so there is no external ticker to reconcile "the fact happened" with
-- "the notification was sent". The outbox closes that gap by co-locating the two:
-- a producer INSERTs the event row here in the SAME transaction as the business
-- fact it describes (the PR was opened, the KB finished indexing). Commit is
-- atomic — either both land or neither does — so a notification can never be
-- promised for a fact that rolled back, nor a fact silently go unannounced.
--
-- HOW IT DRAINS: a drain reads pending rows and hands each to the channel
-- dispatcher, then marks it delivered. Today that drain runs inside the app —
-- BackgroundTasks / next/server `after()` piggy-backing on the same request that
-- enqueued — because that is the only post-response hook this stack has. When the
-- Notifications module is extracted the very same table becomes a proper queue's
-- source of truth; only the drain's trigger changes, not this schema.
--
-- AT-LEAST-ONCE, SO CHANNELS ARE IDEMPOTENT: a row can be pulled again if the
-- drain dies after delivering but before marking it done (crash, timeout, retry).
-- That is deliberate — losing a notification is worse than repeating one — and it
-- is the contract NotificationChannel.deliver is written against: delivery must be
-- idempotent. `attempts` is here to observe and cap redelivery later.
--
-- ADDITIVE AND DORMANT: this migration only ADDS a table. It does NOT touch,
-- disable, or replace the existing trigger-based path (0049's feed insert and
-- 0051's pg_net email fan-out), which keeps running exactly as before. Nothing
-- writes to or reads from this table until the module is wired to producers; the
-- cutover from triggers to the outbox is a separate, deliberate migration.

-- ── outbox ──────────────────────────────────────────────────────────────────
-- One row per notification event awaiting delivery. `event` is the full
-- JSON-serialised domain event (modules/notifications/domain/events.ts) — the
-- table stays kind-agnostic so adding a notification kind never touches SQL.
create table if not exists tracker.notification_outbox (
    id           uuid primary key default gen_random_uuid(),
    event        jsonb not null,
    status       text not null default 'pending' check (status in ('pending', 'done')),
    attempts     int not null default 0,
    created_at   timestamptz not null default now(),
    delivered_at timestamptz
);

-- The drain claims the oldest pending rows first. A PARTIAL index keeps only the
-- undelivered rows in the index, so the queue-head lookup stays small and cheap
-- even as delivered history accumulates.
create index if not exists notification_outbox_pending_idx
    on tracker.notification_outbox (status, created_at)
    where status = 'pending';

-- Only the service-role drain ever touches this table. Enable RLS (default-deny
-- once on) and grant nothing to `authenticated` — clients get no access at all —
-- while service_role, which bypasses RLS, retains full access.
alter table tracker.notification_outbox enable row level security;
grant all on tracker.notification_outbox to service_role;
