-- 0082_grant_pr_review_rounds.sql — the API roles were never granted on
-- pull_request_analysis_rounds, so nothing has ever been written to it.
--
-- ─── The bug ─────────────────────────────────────────────────────────────────
--
-- 0080 creates tracker.pull_request_analysis_rounds and carries no GRANT. Every
-- other table created since 0073 does (0074 beta_allowlist, 0075
-- deleted_account_usage, 0076 usage_subjects, 0077 review_profiles); this one is
-- the exception, and it is the same omission 0073 was written to repair — this
-- time from the other direction.
--
-- 0073 did leave a rule rather than a snapshot:
--
--     alter default privileges in schema tracker grant all on tables to …
--
-- but default privileges are scoped to the ROLE THAT SET THEM. They apply to
-- tables that role later creates, and to nothing else. 0073 says so in as many
-- words — "a table created by some other role still needs its own grant" — and
-- that is exactly what happened: 0080 was applied by a different role than the
-- one 0073 ran as, so the rule did not reach it.
--
-- ─── What it looked like ─────────────────────────────────────────────────────
--
-- Not an error. The table exists, with every column 0080 and 0081 give it, and
-- `service_role` gets `permission denied` on both the insert and the select.
-- Both call sites swallowed it:
--
--   appendRound  ignored the insert error  → no round was EVER recorded
--   listRounds   ignored the query error   → returned [], which means
--                                            "first review of this pull request"
--
-- So every round decided `first_round`, reviewed the whole pull request, and
-- carried nothing — while reporting a scope, a reason, and a completed review.
-- A pipeline that has never once worked is indistinguishable from one working as
-- designed. Four rounds on one merge request produced zero rows and no warning
-- anywhere.
--
-- The silence is fixed in the application (both call sites now log the cause).
-- This is the privilege.
--
-- ─── Why this is not a widening ──────────────────────────────────────────────
--
-- Verbatim 0073's argument, and it still holds. 0067 made RLS the reachability
-- fuse: enabled with no policies on every tenant table, so `anon` and
-- `authenticated` read nothing whatever the grants say. 0080 put this table in
-- exactly that state deliberately, and it stays in it. The grant restores what
-- the schema assumes everywhere else — the API roles can ADDRESS the table, RLS
-- decides whether they get rows.

do $$
declare
    t text;
begin
    -- Every table created since 0073, checked rather than assumed. Naming only
    -- the known-broken one would repair the instance and leave the class, which
    -- is the mistake 0073 explicitly set out not to repeat — and then this
    -- migration exists because repeating it was still possible.
    foreach t in array array[
        'pull_request_analysis_rounds',
        'beta_allowlist',
        'deleted_account_usage',
        'usage_subjects',
        'review_profiles'
    ] loop
        if to_regclass('tracker.' || quote_ident(t)) is null then
            raise notice '0082: tracker.% does not exist here — skipped', t;
        else
            execute format('grant all on tracker.%I to authenticated, service_role', t);
            raise notice '0082: granted on tracker.%', t;
        end if;
    end loop;
end $$;

-- The sweep, again. 0073 ran it and called it a no-op at the time; it was not a
-- no-op forever, which is the whole lesson. Cheap, idempotent, and it catches
-- anything added between 0073 and now that nobody has noticed yet.
grant all     on all tables    in schema tracker to authenticated, service_role;
grant all     on all sequences in schema tracker to authenticated, service_role;
grant execute on all functions in schema tracker to authenticated, service_role;

-- And re-assert the RULE as the role applying THIS migration, so the next table
-- created the way 0080 was is grantable without anyone remembering. Still scoped
-- to one role — that is a property of ALTER DEFAULT PRIVILEGES, not a choice —
-- but it now covers the role that has actually been applying migrations lately,
-- which is the one that created the table this migration is repairing.
alter default privileges in schema tracker
    grant all on tables to authenticated, service_role;
alter default privileges in schema tracker
    grant all on sequences to authenticated, service_role;
alter default privileges in schema tracker
    grant execute on functions to authenticated, service_role;

comment on table tracker.pull_request_analysis_rounds is
    'One completed review of one head (0080). RLS is enabled with NO policies, '
    'which is what keeps anon/authenticated out — the grants in 0082 are '
    'addressability, not authorization (see 0067 and 0073). Without them the '
    'service role cannot write a round, every re-review looks like a first '
    'review, and incremental review silently never happens.';
