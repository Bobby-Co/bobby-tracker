-- 0089_checkout_session_resume.sql — let an abandoned checkout be picked back up.
--
-- ─── What went wrong without it ──────────────────────────────────────────────
--
-- The checkout route guarded against double-clicks with a Stripe idempotency key
-- scoped to (team, tier, day). Stripe's rule is stricter than that guard assumed:
-- a key may only ever be replayed with the SAME parameters. Anything that changed
-- the session between two attempts on one day — the return URLs, or the customer
-- id appearing after a first attempt created one — produced a hard 502:
--
--   Keys for idempotent requests can only be used with the same parameters they
--   were first used with.
--
-- So the guard turned "the user came back to finish paying" into an error, which
-- is the worst possible moment to fail.
--
-- ─── The replacement is a better guard anyway ───────────────────────────────
--
-- Remember the session instead of a key. On a second attempt the route retrieves
-- it: still open and for the same plan, the user is sent back to the very page
-- they left, part-filled card and all. Otherwise a fresh session is made.
--
-- That protects against the same thing the key was for — two completed sessions
-- becoming two subscriptions and two charges — and does it by handing back the
-- same session rather than by replaying an old HTTP response. It also survives
-- parameters changing, because nothing is keyed on them.
--
-- Stripe expires an open session after 24 hours, and `status` says so, so there
-- is nothing here to clean up: a stale id simply fails the "still open" test and
-- is replaced. Which matters, because this stack has no scheduler to clean with.

alter table tracker.team_subscriptions
    add column if not exists stripe_checkout_session_id text;

comment on column tracker.team_subscriptions.stripe_checkout_session_id is
    'The last Checkout Session started for this team, so an abandoned checkout can '
    'be resumed rather than duplicated. Not a record of payment — a completed '
    'session is reported by webhook and it is the SUBSCRIPTION that is the '
    'entitlement. Safe to be stale: the route re-checks the session is still open.';
