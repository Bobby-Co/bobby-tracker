-- Move issue embeddings out of tracker.issues into a dedicated
-- tracker.issue_embeddings table.
--
-- Why: vectors are heavy (1536 floats ≈ 6 KB per row), they don't
-- belong on the hot path that selects/updates plain issue metadata,
-- and a separate table lets us stamp the model name + regen
-- timestamp per embedding so future re-embed sweeps know what's
-- stale. It also keeps the RLS surface for embeddings independent
-- of the issue row itself.
--
-- Backfill copies any existing vectors over before the column is
-- dropped, so no embeddings are lost.

create table if not exists tracker.issue_embeddings (
    issue_id    uuid primary key references tracker.issues(id) on delete cascade,
    embedding   vector(1536) not null,
    -- Which model produced the vector. Lets a re-embed sweep target
    -- only rows from older/different models.
    model       text not null default 'text-embedding-3-small',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

drop trigger if exists touch_issue_embeddings on tracker.issue_embeddings;
create trigger touch_issue_embeddings
    before update on tracker.issue_embeddings
    for each row execute function tracker.touch_updated_at();

-- HNSW cosine index on the new column. Same shape as the one we had
-- on issues.embedding — sub-ms nearest-neighbor lookups for the
-- per-project similarity panel.
create index if not exists issue_embeddings_hnsw_idx
    on tracker.issue_embeddings
    using hnsw (embedding vector_cosine_ops);

alter table tracker.issue_embeddings enable row level security;

-- Owner-only access. Mirror of the issues policy: a user can read /
-- write the embedding row iff they own the parent issue's project.
drop policy if exists issue_embeddings_owner_all on tracker.issue_embeddings;
create policy issue_embeddings_owner_all on tracker.issue_embeddings
    for all
    using      (exists (
        select 1 from tracker.issues i
            join tracker.projects p on p.id = i.project_id
        where i.id = issue_id and p.user_id = auth.uid()
    ))
    with check (exists (
        select 1 from tracker.issues i
            join tracker.projects p on p.id = i.project_id
        where i.id = issue_id and p.user_id = auth.uid()
    ));

grant all on tracker.issue_embeddings to authenticated, service_role;

-- Backfill from the column we're dropping. Idempotent — re-running
-- the migration after the column is gone is fine because the column
-- check guards against missing-column errors.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'tracker'
          and table_name = 'issues'
          and column_name = 'embedding'
    ) then
        insert into tracker.issue_embeddings (issue_id, embedding)
        select id, embedding
        from tracker.issues
        where embedding is not null
        on conflict (issue_id) do nothing;
    end if;
end $$;

-- Drop the old index + column. The find_similar_issues RPC is
-- recreated below to JOIN through the new table.
drop index if exists tracker.issues_embedding_hnsw_idx;

alter table tracker.issues
    drop column if exists embedding;

-- Replace the RPC. Same signature so existing callers keep working
-- — only the join target changes. We continue to exclude rows that
-- have been marked as duplicates so they don't dominate the
-- "similar" suggestions on a fresh issue.
create or replace function tracker.find_similar_issues(
    p_project_id uuid,
    p_embedding  vector(1536),
    p_limit      int default 5,
    p_exclude_id uuid default null
)
returns table (
    id           uuid,
    issue_number int,
    title        text,
    status       text,
    similarity   float
)
language plpgsql
security definer
set search_path = tracker, public
as $$
begin
    if not exists (
        select 1 from tracker.projects p
        where p.id = p_project_id and p.user_id = auth.uid()
    ) then
        raise exception 'project not owned by caller' using errcode = '42501';
    end if;

    return query
    select
        i.id,
        i.issue_number,
        i.title,
        i.status::text,
        1 - (e.embedding <=> p_embedding) as similarity
    from tracker.issues i
        join tracker.issue_embeddings e on e.issue_id = i.id
    where i.project_id = p_project_id
      and (p_exclude_id is null or i.id <> p_exclude_id)
      and i.duplicate_of_issue_id is null
    order by e.embedding <=> p_embedding
    limit p_limit;
end $$;

-- Sister RPC: find issues similar to an *existing* one. Takes the
-- issue id, looks up its stored embedding, then runs the same
-- nearest-neighbor query (excluding the source issue itself). Used
-- by the post-create similarity card on the issue detail page so
-- the tracker doesn't have to fetch the vector + round-trip.
--
-- security_invoker so the caller's RLS still applies: a user can
-- only run this for an issue they own, and they only see neighbors
-- in projects they own.
create or replace function tracker.find_similar_to_issue(
    p_issue_id uuid,
    p_limit    int default 5
)
returns table (
    id           uuid,
    issue_number int,
    title        text,
    status       text,
    similarity   float
)
language plpgsql
security invoker
set search_path = tracker, public
as $$
declare
    v_embedding vector(1536);
    v_project   uuid;
begin
    select e.embedding, i.project_id
        into v_embedding, v_project
        from tracker.issues i
            join tracker.issue_embeddings e on e.issue_id = i.id
        where i.id = p_issue_id;

    if v_embedding is null then
        return; -- no embedding yet → empty result
    end if;

    return query
    select
        i.id,
        i.issue_number,
        i.title,
        i.status::text,
        1 - (e.embedding <=> v_embedding) as similarity
    from tracker.issues i
        join tracker.issue_embeddings e on e.issue_id = i.id
    where i.project_id = v_project
      and i.id <> p_issue_id
      and i.duplicate_of_issue_id is null
    order by e.embedding <=> v_embedding
    limit p_limit;
end $$;

grant execute on function tracker.find_similar_issues(uuid, vector(1536), int, uuid)
    to authenticated, service_role;
grant execute on function tracker.find_similar_to_issue(uuid, int)
    to authenticated, service_role;
