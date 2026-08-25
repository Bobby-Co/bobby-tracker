-- 0088_subscription_periods.sql — bill on the purchase date, and count usage
-- against the period actually being billed.
--
-- ─── What changed above this ─────────────────────────────────────────────────
--
-- 0086 anchored every subscription to the 1st, which made a billing period and a
-- calendar month the same object — and that is the only reason the usage rollup,
-- keyed by date_trunc('month', created_at), was the right key.
--
-- The product decision has changed: a subscription now charges the full monthly
-- price up front and renews on the anniversary of the purchase. So a period runs
-- (say) 14 Aug → 14 Sep and straddles two calendar-month rollup rows. Left alone,
-- the balance would read a window that is not the window being billed — the same
-- shape of bug as the frozen period 0086 fixed, arriving by a different route.
--
-- ─── The fix: key usage by the period being billed ──────────────────────────
--
-- The rollup key becomes the team's CURRENT PERIOD START when it has one, and
-- falls back to the calendar month when it does not. Free teams have no
-- subscription period, and a calendar month is the honest meaning of "monthly"
-- for them.
--
-- Keeping the rollup (rather than summing raw events over a date range) is
-- deliberate. The balance pill reads app-wide on every navigation; the rollup is
-- what makes that a single-row lookup instead of a scan that grows with usage.
-- Re-keying it preserves that property while making the key mean the right thing.
--
-- ─── An upgrade resets the period, and that is the point ────────────────────
--
-- When a plan changes, Stripe reports a new period start and this trigger begins
-- writing under it — so usage effectively resets with the new plan, for free, with
-- no reset job anywhere. That is what stops the upgrade discount being
-- double-counted: the customer hands back the remainder of the old month as money
-- off (see domain/UpgradeCredit.ts) and receives a whole new month, rather than
-- keeping a part-spent allowance as well.

alter table tracker.team_subscriptions
    add column if not exists current_period_start timestamptz;

comment on column tracker.team_subscriptions.current_period_start is
    'Start of the period currently being billed, maintained by the Stripe webhook. '
    'Unlike the legacy period_start column (0059), this one is actually advanced — '
    'which is what makes it safe to read. It is BOTH the window the balance is '
    'measured over and the key the usage rollup is written under; the two must be '
    'the same value or a team is billed for one window and metered over another.';

-- ─── re-key the rollup ───────────────────────────────────────────────────────
create or replace function tracker.prowl_rollup_usage()
returns trigger language plpgsql security definer set search_path = tracker, pg_temp as $$
declare
    v_period_start timestamptz;
    v_key          timestamptz;
begin
    select current_period_start into v_period_start
    from tracker.team_subscriptions
    where team_id = new.team_id;

    -- Fall back to the calendar month for a team with no subscription period —
    -- free teams, and any row written before this migration.
    --
    -- The created_at guard matters for the boundary: an event recorded slightly
    -- BEFORE the current period began belongs to the period that just ended, and
    -- keying it forward would charge the new month for the old month's work. The
    -- analyser meters incrementally, so late arrivals across a boundary are rare
    -- but not impossible.
    if v_period_start is null or new.created_at < v_period_start then
        v_key := date_trunc('month', new.created_at at time zone 'utc');
    else
        v_key := v_period_start;
    end if;

    insert into tracker.prowl_usage_period(team_id, period_start, cost_usd, calls)
    values (new.team_id, v_key, coalesce(new.cost_usd, 0), 1)
    on conflict (team_id, period_start) do update set
        cost_usd   = prowl_usage_period.cost_usd + excluded.cost_usd,
        calls      = prowl_usage_period.calls + 1,
        updated_at = now();
    return null;
end $$;

comment on function tracker.prowl_rollup_usage() is
    'Maintains prowl_usage_period. Keyed by the team''s current billing period '
    'start (0088), falling back to the calendar month for teams without one. The '
    'key must match what modules/billing reads as the period, or the balance is '
    'measured over a different window than the one being billed.';
