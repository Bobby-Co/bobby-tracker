-- 0073_grant_tables_created_after_0001.sql — repair two tables the API roles were
-- never granted on, and stop the next one from happening.
--
-- ─── The bug ─────────────────────────────────────────────────────────────────
--
-- 0001 grants with `on ALL TABLES in schema tracker`, which is a snapshot, not a
-- rule: it grants on the tables that exist AT THAT MOMENT and says nothing about
-- any table created later. So every migration since has had to carry its own
-- `grant all on tracker.<table> to authenticated, service_role`. Almost all of
-- them did. Two did not:
--
--   mind_context           0035 — reasoned explicitly about RLS ("no policies, so
--                                 only service_role, which bypasses RLS") and
--                                 concluded no grant was needed. RLS bypass is
--                                 not a table privilege; service_role still needs
--                                 the GRANT, and without it every access fails
--                                 with `permission denied for table mind_context`
--                                 regardless of role.
--   newsletter_subscribers 0053 — same omission, no stated reasoning.
--
-- Surfaced by project deletion: the regional purge clears mind_context by
-- project_id and threw there, which — by design — aborts the delete before the
-- project row is removed. The Mind chat's managed-context writes go through the
-- same table from the analyser, so those have been failing since 0035 too.
--
-- ─── Why granting these is not a widening ────────────────────────────────────
--
-- 0067 made RLS the reachability fuse: enabled with no policies on every tenant
-- table, so `anon` and `authenticated` read nothing whatever the grants say.
-- Both tables here are in exactly that state, and stay in it. The grant restores
-- what the schema assumes everywhere else — the API roles can address the table,
-- RLS decides whether they get rows — and matches the 30-odd tables that already
-- carry it.

-- Guarded on existence, because the file set and the deployed database do not
-- agree: `newsletter_subscribers` is absent from the hosted project even though
-- 0053 creates it. (0053 is a COLLIDING number — 0053_newsletter_subscribers and
-- 0053_notification_outbox — which is the likely reason one of the two never got
-- applied.) A repair migration is the wrong place to discover that; it should fix
-- what is there and say what it skipped.
do $$
declare
    t text;
begin
    foreach t in array array['mind_context', 'newsletter_subscribers'] loop
        if to_regclass('tracker.' || quote_ident(t)) is null then
            raise notice '0073: tracker.% does not exist here — skipped', t;
        else
            execute format('grant all on tracker.%I to authenticated, service_role', t);
            raise notice '0073: granted on tracker.%', t;
        end if;
    end loop;
end $$;

-- Re-run 0001's sweep to catch anything else that slipped through between then
-- and now. Idempotent, and the audit that found the two above says it is a no-op
-- today — it is here so this migration repairs the CLASS, not just the instance.
grant all     on all tables    in schema tracker to authenticated, service_role;
grant all     on all sequences in schema tracker to authenticated, service_role;
grant execute on all functions in schema tracker to authenticated, service_role;

-- And the actual fix: a RULE rather than another snapshot. Default privileges
-- apply to objects created LATER by the role that owns them, so a future
-- `create table tracker.x` is grantable without anyone remembering to say so.
--
-- Scoped to the role running this migration (the schema owner, which is also
-- what applies every other migration). A table created by some other role still
-- needs its own grant — but that is not how anything here is deployed.
alter default privileges in schema tracker
    grant all on tables to authenticated, service_role;
alter default privileges in schema tracker
    grant all on sequences to authenticated, service_role;
alter default privileges in schema tracker
    grant execute on functions to authenticated, service_role;

do $$ begin
    if to_regclass('tracker.mind_context') is not null then
        execute 'comment on table tracker.mind_context is '
            '''Mind chat managed context, written by the analyser with the service-role key. '
            'RLS is enabled with NO policies, which is what keeps anon/authenticated out — '
            'the grants in 0073 are addressability, not authorization (see 0067).''';
    end if;
end $$;
