-- 0086_stripe_billing.sql — real money: Stripe subscriptions, and our own invoices.
--
-- ─── The division of labour ──────────────────────────────────────────────────
--
-- Stripe owns the CLOCK and the MONEY: when a period renews, when to retry a
-- failed card, dunning mail, SCA, proration. We own ENTITLEMENT: which tier a team
-- is on, how many credits that buys, and whether a call may run.
--
-- That split is not a preference, it is the constraint. Renewal, retry schedules
-- and dunning are timer-driven, and there is no scheduler in this stack — no cron,
-- no pg_cron, no OpenNext scheduled handler. The pg_net trigger trick cannot
-- substitute: it fires on usage writes, so a team that simply stopped using the
-- product would never renew and never be dunned. Stripe has the clock and pushes
-- events at us; that is the half we cannot build.
--
-- ─── Why the billing period is not stored ────────────────────────────────────
--
-- Subscriptions are anchored to the 1st (billing_cycle_anchor), so a billing
-- period IS a calendar month — the same thing prowl_usage_period is keyed by. The
-- current period is therefore DERIVED at read time (Balance.currentPeriodStart)
-- rather than stored and advanced.
--
-- That is a bug fix as much as a design choice. team_subscriptions.period_start
-- was set by a column default when the team was created and nothing in the
-- codebase ever advanced it — no route, no trigger, no job. The balance therefore
-- looked up the rollup row for the month the team was CREATED, forever: from month
-- two onward a team's real spend was invisible and the allowance never reset. The
-- column is kept for history but is no longer read; see the comment on it below.
--
-- current_period_end IS stored, because "renews on the 1st" is a thing the UI says
-- and only Stripe knows whether that is true for a given team.

-- ─── the subscription's Stripe identity ──────────────────────────────────────
alter table tracker.team_subscriptions
    add column if not exists stripe_customer_id     text,
    add column if not exists stripe_subscription_id text,
    add column if not exists current_period_end     timestamptz,
    add column if not exists cancel_at_period_end   boolean not null default false;

-- One Stripe subscription maps to at most one team. A duplicate here would mean
-- two teams entitled by one payment, so it is a constraint rather than a check in
-- the webhook handler.
create unique index if not exists team_subscriptions_stripe_sub_uniq
    on tracker.team_subscriptions (stripe_subscription_id)
    where stripe_subscription_id is not null;

create index if not exists team_subscriptions_stripe_customer_idx
    on tracker.team_subscriptions (stripe_customer_id)
    where stripe_customer_id is not null;

comment on column tracker.team_subscriptions.period_start is
    'LEGACY — no longer read. It was set once at team creation and never advanced, '
    'which froze every balance at the creation month. Periods are calendar months '
    'derived at read time (0086); this column is retained only so historical rows '
    'are not rewritten.';
comment on column tracker.team_subscriptions.status is
    'OUR vocabulary, not Stripe''s: active | past_due | canceled | suspended. '
    'Stripe''s richer set is mapped down in modules/billing (trialing→active, '
    'unpaid→past_due, and so on) so the rest of the app has four cases to handle '
    'rather than nine.';
comment on column tracker.team_subscriptions.cancel_at_period_end is
    'The team asked to cancel but has paid through the end of the period, so it '
    'keeps its tier until then. The UI says "ends on"; entitlement is unaffected '
    'until Stripe actually cancels and sends the event.';

-- ─── our invoices ────────────────────────────────────────────────────────────
-- A MIRROR of Stripe's invoices, not a second ledger. Stripe remains the record of
-- what was charged; this exists so the billing page, the past-due banner and the
-- invoice history are ours to render and query, rather than an iframe we cannot
-- style or join against.
--
-- team_id is a SOFT reference, like prowl_usage_events (0076): a financial record
-- must outlive the team it belonged to.
create table if not exists tracker.billing_invoices (
    id                 uuid        primary key default gen_random_uuid(),
    team_id            uuid        not null,
    stripe_invoice_id  text        not null,
    -- Stripe's human-facing number (ACME-0001). Null on a draft.
    number             text,
    status             text        not null,
    -- Minor units (cents), exactly as Stripe reports them. Stored as integers
    -- because money in floating point is how rounding bugs get shipped.
    amount_due         bigint      not null default 0,
    amount_paid        bigint      not null default 0,
    currency           text        not null default 'usd',
    -- What the invoice BOUGHT: the tier, and the period it entitles. Copied at
    -- mirror time rather than joined later — a plan change must not rewrite the
    -- history of what an old invoice paid for.
    tier               text,
    period_start       timestamptz,
    period_end         timestamptz,
    hosted_invoice_url text,
    invoice_pdf        text,
    issued_at          timestamptz,
    paid_at            timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    constraint billing_invoices_stripe_uniq unique (stripe_invoice_id),
    constraint billing_invoices_status_chk
        check (status in ('draft', 'open', 'paid', 'uncollectible', 'void'))
);

create index if not exists billing_invoices_team_time_idx
    on tracker.billing_invoices (team_id, created_at desc);

drop trigger if exists touch_billing_invoices on tracker.billing_invoices;
create trigger touch_billing_invoices
    before update on tracker.billing_invoices
    for each row execute function tracker.touch_updated_at();

alter table tracker.billing_invoices enable row level security;

-- Members read their team's invoices. Every write is service-role, from the
-- webhook — there is no client path that should ever create one.
drop policy if exists billing_invoices_member_select on tracker.billing_invoices;
create policy billing_invoices_member_select on tracker.billing_invoices
    for select using (tracker.is_team_member(team_id));

grant select on tracker.billing_invoices to authenticated;
grant all    on tracker.billing_invoices to service_role;

comment on table tracker.billing_invoices is
    'Mirror of the team''s Stripe invoices, written by the Stripe webhook. Stripe '
    'stays the source of truth for what was charged; this makes the history '
    'queryable and renderable in-app. A PAID invoice for the current period is '
    'what entitles a team to that period''s credits — a failed payment leaves the '
    'subscription past_due and the top-up simply never happens.';
