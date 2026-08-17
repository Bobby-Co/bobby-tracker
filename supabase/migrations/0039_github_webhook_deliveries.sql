-- tracker.github_webhook_deliveries — redelivery idempotency ledger.
--
-- GitHub sends a unique X-GitHub-Delivery id per webhook delivery and
-- retries/redelivers on failure or via the manual "Redeliver" button. The
-- webhook route inserts the delivery id here before processing; a
-- unique-violation on the primary key means "already handled" → the route
-- returns 202 without re-applying the event. This is the first line of
-- loop/duplicate prevention (content-hash echo suppression is the second).
--
-- Written only by the webhook route via the service-role client; there is
-- no per-user ownership, so RLS is enabled with no policies (service_role
-- bypasses RLS; authenticated clients get nothing).

create table if not exists tracker.github_webhook_deliveries (
    -- GitHub's X-GitHub-Delivery header — globally unique per delivery.
    delivery_id   text        primary key,
    -- The X-GitHub-Event value, kept for diagnostics.
    event         text,
    received_at   timestamptz not null default now()
);

alter table tracker.github_webhook_deliveries enable row level security;

grant all on tracker.github_webhook_deliveries to authenticated, service_role;
