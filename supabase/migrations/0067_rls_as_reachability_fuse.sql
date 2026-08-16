-- 0067_rls_as_reachability_fuse.sql — retire RLS as an authorization system.
--
-- ─── What changes ────────────────────────────────────────────────────────────
--
-- Policies are dropped from every tenant table. RLS stays ENABLED, which with no
-- policy means deny-all: `anon` and `authenticated` get nothing. The server
-- reads with service-role, which bypasses RLS entirely.
--
-- So RLS stops being a second opinion on who may see what, and becomes a blunt
-- fuse: "can this table be reached at all with the public key?" — answer, no.
--
-- ─── Why ─────────────────────────────────────────────────────────────────────
--
-- Authorization was TWO systems that had to agree. The database enforced a COARSE
-- rule (is_team_member — any member of the team, any of its projects) while the
-- actual rule lived in AccessService (a plain member sees only projects granted
-- to one of their access groups). The database was never expressing the real
-- policy; it was a net underneath one.
--
-- And the net hid holes. Twelve routes and repository methods turned out to have
-- no check of their own — POST /api/issues took project_id straight from the
-- request body, GET /api/sessions/overview called listAll(), notifications were
-- read and marked with no owner filter. Every one of them worked, because RLS was
-- quietly narrowing the result. A single explicit gate makes that class of bug
-- fail loudly instead of silently passing.
--
-- What replaces the net is not nothing. It is two invariants enforced in CI:
--   lib/server/http/route-authz.test.ts        every route reaching tenant data
--                                              carries a tenant guard, per
--                                              HANDLER, not per file
--   lib/server/http/repository-scoping.test.ts every tenant query carries a
--                                              predicate; every mutation a KEYED
--                                              one
--
-- ─── What keeps its policies, and why that is not optional ───────────────────
--
-- NEXT_PUBLIC_SUPABASE_ANON_KEY ships in the browser bundle. For any table the
-- browser can reach, RLS is not defence in depth — it is the only thing between
-- a published key and the data. The browser holds a direct Supabase connection
-- for auth and for postgres_changes on exactly three tables, so those three keep
-- real, working policies:
--
--   project_analyser     indexing progress, watched live by the analyser panel
--   issue_suggestions    analyser output, watched by the suggestion box
--   notifications        the in-app feed
--
-- Reference tables (icon_catalog*) keep their read-only `using (true)` policies:
-- they are shared data owned by nobody, and dropping them would break nothing
-- while making the intent less clear.

do $$
declare
    r record;
    -- Browser-reachable over realtime — these MUST keep enforcing.
    keep constant text[] := array[
        'project_analyser', 'issue_suggestions', 'notifications',
        'icon_catalog', 'icon_catalog_meta'
    ];
begin
    for r in
        select schemaname, tablename, policyname
        from pg_policies
        where schemaname = 'tracker'
          and tablename <> all (keep)
        order by tablename, policyname
    loop
        execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
        raise notice '0067: dropped %.% policy %', r.schemaname, r.tablename, r.policyname;
    end loop;
end $$;

-- RLS stays ON everywhere. Enabled-with-no-policy is deny-all, which is exactly
-- the fuse we want: a leaked anon key reads nothing. Re-assert it rather than
-- assume, since a table added later could have arrived without it.
do $$
declare t record;
begin
    for t in
        select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'tracker' and c.relkind in ('r', 'p') and not c.relrowsecurity
    loop
        execute format('alter table tracker.%I enable row level security', t.relname);
        raise notice '0067: enabled RLS on tracker.%', t.relname;
    end loop;
end $$;

-- The SECURITY DEFINER helpers (is_team_member, member_of_project_team, …) are
-- deliberately left in place. Nothing calls them once the policies are gone, but
-- they are the only remaining description of the coarse rule, and dropping them
-- is a separate cleanup that should not ride along with a behaviour change.
