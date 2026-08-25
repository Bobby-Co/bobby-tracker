-- 0087_scout_tier.sql — a $5 tier between Kit and Prowler.
--
-- ─── Why a tier needs a migration at all ─────────────────────────────────────
--
-- Prices and allowances are config: 0059 deliberately kept them out of the
-- schema so re-pricing a tier is one line in modules/billing/domain/Tier.ts with
-- no migration. The tier's NAME is different — team_subscriptions.tier is a
-- Postgres enum (tracker.prowl_tier), so a new id has to exist in the database
-- before any row can hold it. Without this, the first Scout checkout would fail
-- on the webhook, at the moment the customer had already paid.
--
-- ─── Ordering ────────────────────────────────────────────────────────────────
--
-- Added BEFORE 'prowler' rather than at the end. An enum's declaration order is
-- its sort order, so appending would have left `order by tier` reporting Scout as
-- the most expensive plan — wrong in any report or admin listing that sorts by
-- it, and wrong silently.
--
-- ─── This runs outside a transaction ─────────────────────────────────────────
--
-- ALTER TYPE ... ADD VALUE cannot be followed by USE of that value in the same
-- transaction. This migration only adds it — no default, no backfill, no row
-- written with it — so there is nothing here that would trip that rule. Keep it
-- that way: anything that needs to WRITE 'scout' belongs in a later migration.
alter type tracker.prowl_tier add value if not exists 'scout' before 'prowler';

comment on type tracker.prowl_tier is
    'Plan ladder, low → high: kit, scout, prowler, pride, apex. Mirrors TierId in '
    'modules/billing/domain/Tier.ts, which owns the prices and allowances — those '
    'are config and deliberately not in the schema. Only the NAMES live here.';
