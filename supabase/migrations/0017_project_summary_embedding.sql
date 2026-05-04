-- Project-level summary + embedding, refreshed on every successful
-- bootstrap or incremental update by bobby-analyser.
--
-- Why on project_analyser instead of a new table:
--   The summary's lifecycle matches the analyser's lifecycle exactly
--   — created when indexing finishes, replaced on every reindex, and
--   gone if the project's analyser row is deleted. A separate table
--   would only add a join with no extra flexibility.
--
-- Columns:
--   summary_markdown      — human-readable snapshot of what the
--                           project is, what it's built with, and
--                           which modules / surfaces it exposes.
--                           Powers the future project-groups UI
--                           ("which project does this issue belong
--                           to?") and is a great context block for
--                           the AI compose flow when an org has
--                           multiple repos in one group.
--   summary_embedding     — 1536-dim vector from
--                           text-embedding-3-small over the markdown.
--                           Used by similarity lookups against
--                           issue-draft embeddings to route an issue
--                           to the right project in a group.
--   summary_model         — name of the embedding model that produced
--                           the vector. Lets a future re-embed sweep
--                           target old rows.
--   summary_updated_at    — when the markdown + vector were last
--                           refreshed.

alter table tracker.project_analyser
    add column if not exists summary_markdown   text,
    add column if not exists summary_embedding  vector(1536),
    add column if not exists summary_model      text,
    add column if not exists summary_updated_at timestamptz;

create index if not exists project_analyser_summary_hnsw_idx
    on tracker.project_analyser
    using hnsw (summary_embedding vector_cosine_ops)
    where summary_embedding is not null;

-- Similarity RPC: given a query vector (typically an issue-draft
-- embedding) + a candidate set of project IDs, return the projects
-- ranked by cosine similarity to the query. The caller scopes the
-- candidate set so we don't need a global "see all projects" check
-- — passing an empty array returns nothing.
--
-- security_invoker so the caller's RLS still applies: a user can
-- only see projects they own (existing project_analyser RLS does
-- the join through tracker.projects).
create or replace function tracker.find_similar_projects(
    p_embedding   vector(1536),
    p_project_ids uuid[],
    p_limit       int default 5
)
returns table (
    project_id uuid,
    similarity float
)
language sql
security invoker
set search_path = tracker, public
as $$
    select
        a.project_id,
        1 - (a.summary_embedding <=> p_embedding) as similarity
    from tracker.project_analyser a
    where a.summary_embedding is not null
      and a.project_id = any(p_project_ids)
    order by a.summary_embedding <=> p_embedding
    limit p_limit;
$$;

grant execute on function tracker.find_similar_projects(vector(1536), uuid[], int)
    to authenticated, service_role;
