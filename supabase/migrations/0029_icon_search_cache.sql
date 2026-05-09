-- Cross-session cache for icon search queries.
--
-- Why this exists:
--   The hot path on /api/icons/search is the embedding call to the
--   analyser (which is in turn an OpenAI round-trip). The catalog
--   is essentially static, so the same query maps to the same set
--   of icons every time. Caching the resolved hits per query lets
--   every signed-in user benefit from anyone else's previous
--   search — typing "weather" once warms the cache for everyone.
--
-- Catalog-drift caveat:
--   `hits` are baked at insert time. If the catalog or its
--   embeddings change materially, truncate this table so stale
--   rankings don't linger. The label-icons → embed-icons pipeline
--   is the only thing that should trigger that.
--
-- Access shape:
--   Reads + writes go through the service-role client inside the
--   API route (lib/supabase/server.ts createServiceClient). Browser
--   clients never touch this table directly, so we don't need a
--   policy — RLS stays on as a safety net.

create table if not exists tracker.icon_search_cache (
    query        text primary key,
    hits         jsonb       not null,
    model        text        not null,
    created_at   timestamptz not null default now(),
    last_used_at timestamptz not null default now(),
    hit_count    int         not null default 1
);

-- Cheap LRU support — pick this column when we ever want to evict
-- the bottom of the table.
create index if not exists icon_search_cache_last_used_idx
    on tracker.icon_search_cache(last_used_at);

alter table tracker.icon_search_cache enable row level security;
grant all on tracker.icon_search_cache to service_role;
