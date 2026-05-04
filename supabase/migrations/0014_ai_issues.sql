-- AI issue composer + duplicate detection.
--
-- Two structural pieces:
--
--   1. tracker.issues.embedding — 1536-dim vector from OpenAI's
--      text-embedding-3-small. Generated server-side after each
--      issue insert (best-effort, async). Used to surface similar
--      already-filed issues when someone composes a new one.
--
--   2. tracker.issues.duplicate_of_issue_id — when a submitter
--      flags their new issue as a duplicate of an existing one,
--      this column captures the link. The issue is still persisted
--      so the report isn't lost, but UIs treat it as a satellite
--      of its parent (no AI suggestion run, hidden from default lists).
--
--   3. ai_proposed flag — distinguishes AI-composed drafts from
--      hand-typed ones for analytics + display badges.
--
-- pgvector is required. Install once at the database level; the
-- extension is harmless on subsequent runs.

create extension if not exists vector;

alter table tracker.issues
    add column if not exists embedding              vector(1536),
    add column if not exists duplicate_of_issue_id  uuid references tracker.issues(id) on delete set null,
    add column if not exists ai_proposed            boolean not null default false;

-- HNSW is the sweet spot for our scale (thousands of issues per
-- project, not millions): fast inserts, sub-ms cosine queries, no
-- training step. cosine_ops because text-embedding-3-small is
-- normalized — cosine distance equals dot product.
create index if not exists issues_embedding_hnsw_idx
    on tracker.issues
    using hnsw (embedding vector_cosine_ops)
    where embedding is not null;

create index if not exists issues_duplicate_of_idx
    on tracker.issues(duplicate_of_issue_id)
    where duplicate_of_issue_id is not null;

-- RPC: similarity search scoped to one project.
--
-- We expose this as a security-definer function so the tracker can
-- call it through the regular supabase-js client without round-
-- tripping every embedding through the RLS planner. The function
-- itself only ever returns rows from a project the caller already
-- owns — we re-check ownership via auth.uid() to be safe.
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
        1 - (i.embedding <=> p_embedding) as similarity
    from tracker.issues i
    where i.project_id = p_project_id
      and i.embedding is not null
      and (p_exclude_id is null or i.id <> p_exclude_id)
      and i.duplicate_of_issue_id is null
    order by i.embedding <=> p_embedding
    limit p_limit;
end $$;

grant execute on function tracker.find_similar_issues(uuid, vector(1536), int, uuid)
    to authenticated, service_role;
