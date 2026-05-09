-- Icon catalog with embeddings — global, read-only reference data
-- used by the icon picker's semantic search.
--
-- Why a separate table:
--   Icons are not user-owned. Every project shares the same Iconly
--   set, so there's nothing to scope per-user. One row per icon,
--   populated once by scripts/embed-icons.ts and refreshed only
--   when icons get added.
--
-- Columns:
--   name        — kebab-case canonical slug, matches the
--                 ICONLY_LOADERS key (e.g. "add-user", "rain-drop").
--                 This is what gets stored in
--                 project_label_icons.icon_name.
--   tags        — flat list of plain-English keywords; what we feed
--                 to the embedder along with `description`.
--   description — short one-liner ("a raindrop, used for weather,
--                 water, precipitation"). Optional — we ship without
--                 LLM expansion in v1, but keep the column so a later
--                 pass can fill it in without a schema change.
--   embedding   — 1536-dim text-embedding-3-small vector. Same model
--                 as project summary embeddings so a single embedder
--                 config covers both.
--   model       — model name that produced `embedding`. Lets a future
--                 re-embed sweep target old rows.
--   updated_at  — touched on upsert.

create table if not exists tracker.icon_catalog (
    name        text primary key,
    tags        text[]        not null default '{}',
    description text,
    embedding   vector(1536),
    model       text,
    updated_at  timestamptz   not null default now()
);

create index if not exists icon_catalog_embedding_hnsw_idx
    on tracker.icon_catalog
    using hnsw (embedding vector_cosine_ops)
    where embedding is not null;

-- The catalog is global reference data — every signed-in user
-- needs to read it from the picker. RLS on, with a permissive
-- read policy. Writes happen via the service-role key from the
-- one-shot embed script, which bypasses RLS.
alter table tracker.icon_catalog enable row level security;

drop policy if exists icon_catalog_read_all on tracker.icon_catalog;
create policy icon_catalog_read_all on tracker.icon_catalog
    for select to authenticated, anon
    using (true);

grant select on tracker.icon_catalog to authenticated, anon;
grant all    on tracker.icon_catalog to service_role;

-- Similarity RPC: rank icons by cosine similarity to a query vector.
-- security_invoker so the read policy above gates access. Empty
-- catalog or unembedded rows return nothing.
create or replace function tracker.find_similar_icons(
    p_embedding vector(1536),
    p_limit     int default 60
)
returns table (
    name       text,
    similarity float
)
language sql
stable
security invoker
set search_path = tracker, public
as $$
    select
        c.name,
        1 - (c.embedding <=> p_embedding) as similarity
    from tracker.icon_catalog c
    where c.embedding is not null
    order by c.embedding <=> p_embedding
    limit p_limit;
$$;

grant execute on function tracker.find_similar_icons(vector(1536), int)
    to authenticated, anon, service_role;
