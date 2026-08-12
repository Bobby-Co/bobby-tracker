-- Prowl — usage metering & credits foundation (app-side).
--
-- "Prowl" is Ucelot's billing system: every model call the analyser runs spends
-- PROWL POINTS, drawn from a team's monthly allowance. This migration lays the
-- store the app needs to (a) know each team's tier + allowance and (b) record
-- every metered call. Enforcement (blocking a call when the balance is spent) and
-- the analyser-side token accounting come later — this is the ledger they'll read.
--
-- BILLING SUBJECT = the TEAM (migration 0052). Every account already has a
-- personal team that owns its resources; the subscription + usage attach there,
-- so a shared team's spend pools naturally across its members.
--
-- AUTHORISATION — same hybrid model as 0052:
--   • RLS is the coarse tenant backstop: a row is visible iff you are a member of
--     the owning team (tracker.is_team_member). Cross-team leakage is impossible
--     by construction.
--   • Usage events are WRITTEN by the trusted service role only (the metering
--     layer uses Supabase.service(), which bypasses RLS) — there is no client
--     insert policy, so a member can read their team's spend but never forge it.
--   • Tier changes are admin-gated (is_team_admin); the eventual billing provider
--     writes them through the service role.

-- ─── tier enum (mirrors modules/billing TierId) ──────────────────────────────
do $$ begin
    if not exists (
        select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'prowl_tier' and n.nspname = 'tracker'
    ) then
        create type tracker.prowl_tier as enum ('kit', 'prowler', 'pride', 'apex');
    end if;
end $$;

-- ─── team_subscriptions — one row per team ───────────────────────────────────
-- monthly_points is a NEGOTIATED OVERRIDE only: when NULL (the norm) the app uses
-- the tier's catalogue default (modules/billing Tier), so re-pricing a tier is a
-- code change with no data migration. Non-null carries a bespoke Apex allowance.
create table if not exists tracker.team_subscriptions (
    team_id        uuid              primary key references tracker.teams(id) on delete cascade,
    tier           tracker.prowl_tier not null default 'kit',
    monthly_points integer,
    -- Rolling period anchor. balance = allowance − Σ(points since period_start).
    -- Defaults to the start of the current UTC month; a real billing provider
    -- will advance this on renewal (no cron in this stack — the provider drives it).
    period_start   timestamptz       not null default date_trunc('month', now() at time zone 'utc'),
    status         text              not null default 'active',
    created_at     timestamptz       not null default now(),
    updated_at     timestamptz       not null default now(),
    constraint team_subscriptions_status_chk check (status in ('active', 'past_due', 'canceled')),
    constraint team_subscriptions_points_chk check (monthly_points is null or monthly_points >= 0)
);

drop trigger if exists touch_team_subscriptions on tracker.team_subscriptions;
create trigger touch_team_subscriptions before update on tracker.team_subscriptions
    for each row execute function tracker.touch_updated_at();

-- ─── prowl_usage_events — the append-only usage ledger ───────────────────────
-- One row per metered model call. project_id is a denormalised convenience with
-- NO FK: a call's spend must survive the project's deletion (you still billed it),
-- and skipping the constraint keeps the hot-path insert cheap.
create table if not exists tracker.prowl_usage_events (
    id            uuid        primary key default gen_random_uuid(),
    team_id       uuid        not null references tracker.teams(id) on delete cascade,
    user_id       uuid        references auth.users(id) on delete set null,
    -- What was called: 'issue_analyse' | 'compose' | 'embed' | 'query' | 'chat'
    -- | 'pr_analyse' | 'deep_dive'. Free text (not an enum) so a new analyser
    -- endpoint can be metered without a migration.
    kind          text        not null,
    model         text,
    -- Prowl Points charged (the billed unit). Raw signals kept alongside for audit.
    points        integer     not null default 0,
    cost_usd      numeric(12, 6),
    input_tokens  integer,
    output_tokens integer,
    project_id    uuid,
    meta          jsonb       not null default '{}'::jsonb,
    created_at    timestamptz not null default now(),
    constraint prowl_usage_events_points_chk check (points >= 0)
);
create index if not exists prowl_usage_events_team_time_idx
    on tracker.prowl_usage_events(team_id, created_at desc);

-- ─── auto-provision a Kit subscription for every team ────────────────────────
-- Mirrors 0052's ensure_personal_team pattern: new teams get a free-tier row on
-- insert (SECURITY DEFINER so it runs regardless of the caller's RLS), and
-- existing teams are backfilled below. There is no cron to repair drift, so the
-- trigger is the durable guarantee that every team has exactly one subscription.
create or replace function tracker.ensure_team_subscription()
returns trigger language plpgsql security definer set search_path = tracker, pg_temp as $$
begin
    insert into tracker.team_subscriptions(team_id, tier)
    values (new.id, 'kit')
    on conflict (team_id) do nothing;
    return new;
end $$;

drop trigger if exists ensure_subscription_on_team on tracker.teams;
create trigger ensure_subscription_on_team after insert on tracker.teams
    for each row execute function tracker.ensure_team_subscription();

-- Backfill: every existing team starts on Kit.
insert into tracker.team_subscriptions(team_id, tier)
select id, 'kit' from tracker.teams
on conflict (team_id) do nothing;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table tracker.team_subscriptions  enable row level security;
alter table tracker.prowl_usage_events   enable row level security;

-- Subscriptions: any team member may read; only admins may change the tier from
-- the app (the billing provider writes via the service role, which bypasses RLS).
drop policy if exists team_subscriptions_member_select on tracker.team_subscriptions;
create policy team_subscriptions_member_select on tracker.team_subscriptions
    for select using (tracker.is_team_member(team_id));

drop policy if exists team_subscriptions_admin_update on tracker.team_subscriptions;
create policy team_subscriptions_admin_update on tracker.team_subscriptions
    for update using (tracker.is_team_admin(team_id)) with check (tracker.is_team_admin(team_id));

-- Usage events: members read their team's spend. NO insert/update/delete policy —
-- the append-only ledger is written exclusively by the service-role metering
-- layer, so members can never forge or erase usage.
drop policy if exists prowl_usage_events_member_select on tracker.prowl_usage_events;
create policy prowl_usage_events_member_select on tracker.prowl_usage_events
    for select using (tracker.is_team_member(team_id));

-- ─── grants (0001's blanket grant predates these tables) ─────────────────────
grant select, update on tracker.team_subscriptions to authenticated;
grant all           on tracker.team_subscriptions to service_role;
grant select         on tracker.prowl_usage_events to authenticated;
grant all           on tracker.prowl_usage_events to service_role;
