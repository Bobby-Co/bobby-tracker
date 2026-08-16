-- 0063_issue_embeddings_partitioned.sql — write down the deployed shape of
-- tracker.issue_embeddings, which has never been in a migration.
--
-- ─── The drift ───────────────────────────────────────────────────────────────
--
-- 0015 checked in a PLAIN table keyed by issue_id, with an HNSW cosine index.
-- What is actually deployed is:
--
--   * PARTITIONED BY HASH (project_id) into 16 partitions (_p0 … _p15)
--   * primary key (project_id, issue_id)          — not (issue_id)
--   * an extra project_id column, NOT NULL, FK → projects(id) ON DELETE CASCADE
--   * NO HNSW index. Not on the parent, not on any partition.
--
-- The partitioning was applied directly to the hosted database and never written
-- down, so replaying supabase/migrations into an empty Postgres has been
-- producing a schema that differs from production in the primary key, the column
-- list, and the index set. Harmless while there is one database. Fatal with two:
-- a second region built from these files would diverge silently, and every bug
-- after that becomes a two-region bug that reproduces in only one of them.
--
-- ─── What this migration does ────────────────────────────────────────────────
--
-- Against PRODUCTION: nothing. It detects the partitioned table and returns.
-- Against a FRESH REPLAY: drops 0015's plain table (empty by definition at this
-- point) and rebuilds it in the deployed shape, then restores the RLS policy that
-- 0052 attached and the touch trigger 0015 attached, both of which go with the
-- dropped table.
-- Against ANYTHING ELSE — an unpartitioned table that already holds rows — it
-- refuses. That is a database nobody expected to exist, and silently dropping
-- embeddings to reshape it would be the wrong call to make automatically.
--
-- ─── Deliberately NOT restoring the HNSW index ───────────────────────────────
--
-- 0015 created `issue_embeddings_hnsw_idx`; production does not have it. This
-- migration reproduces production, so it does not recreate it either — the point
-- of the file is to make the two agree, not to quietly change how similarity
-- search behaves. Note what that means today: with hash partitioning, a
-- project-scoped lookup prunes to one partition and index-scans the (project_id,
-- issue_id) prefix, then does an EXACT k-NN over that project's rows. Exact
-- beats approximate for correctness and is fine at current per-project row
-- counts; it degrades linearly as any single project grows. Adding HNSW back is
-- a deliberate performance decision with its own migration, not a side effect of
-- this one.

do $$
declare
    v_relkind "char";
    v_rows    bigint;
begin
    select c.relkind into v_relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'tracker' and c.relname = 'issue_embeddings';

    if v_relkind is null then
        raise exception 'tracker.issue_embeddings is missing — 0015 must run before 0063';
    end if;

    -- Production, and any database already reconciled by this migration.
    if v_relkind = 'p' then
        raise notice '0063: issue_embeddings already partitioned — nothing to do';
        return;
    end if;

    execute 'select count(*) from tracker.issue_embeddings' into v_rows;
    if v_rows > 0 then
        raise exception
            'tracker.issue_embeddings is not partitioned but holds % row(s). Refusing to rebuild — move the data yourself, then re-run.', v_rows;
    end if;

    -- Fresh replay: 0015's table is empty. Dropping it also removes the policy
    -- 0052 created and the touch trigger 0015 created; both are restored below.
    -- No CASCADE: nothing should depend on this table, and if something does we
    -- want to hear about it rather than lose it silently.
    drop table tracker.issue_embeddings;

    create table tracker.issue_embeddings (
        -- Partition key first: it leads the primary key, which is what lets a
        -- project-scoped read prune to one partition and then index-scan.
        project_id  uuid         not null references tracker.projects(id) on delete cascade,
        issue_id    uuid         not null references tracker.issues(id)   on delete cascade,
        embedding   vector(1536) not null,
        -- Which model produced the vector, so a re-embed sweep can target only
        -- rows from an older model.
        model       text         not null default 'text-embedding-3-small',
        created_at  timestamptz  not null default now(),
        updated_at  timestamptz  not null default now(),
        primary key (project_id, issue_id)
    ) partition by hash (project_id);

    for i in 0..15 loop
        execute format(
            'create table tracker.issue_embeddings_p%s partition of tracker.issue_embeddings for values with (modulus 16, remainder %s)',
            i, i
        );
    end loop;

    execute 'alter table tracker.issue_embeddings enable row level security';

    -- The team policy from 0052 (its owner-era predecessor died with the table).
    -- Walks issue → project → team_members via the SECURITY DEFINER helper.
    execute $ddl$
        create policy issue_embeddings_team_all on tracker.issue_embeddings
            for all using (tracker.member_of_issue_team(issue_id))
                with check (tracker.member_of_issue_team(issue_id))
    $ddl$;

    execute 'grant all on tracker.issue_embeddings to authenticated, service_role';

    -- 0015's updated_at trigger. Declared on the parent so it applies to every
    -- partition, including ones added later.
    execute $ddl$
        create trigger touch_issue_embeddings
            before update on tracker.issue_embeddings
            for each row execute function tracker.touch_updated_at()
    $ddl$;

    raise notice '0063: rebuilt issue_embeddings as 16-way hash partitions on project_id';
end $$;

comment on table tracker.issue_embeddings is
    'Per-issue embedding vectors. HASH-partitioned on project_id (16 ways) so a project-scoped similarity search prunes to one partition. Upserts must carry project_id and conflict on (project_id, issue_id) — see modules/issues/infrastructure/SupabaseEmbeddingIndex.ts.';
