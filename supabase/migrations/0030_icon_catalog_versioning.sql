-- Catalog/index version stamp + per-row cache versioning so a
-- re-embed run automatically invalidates downstream caches.
--
-- Why this exists:
--   icon_search_cache stores baked similarity rankings per query.
--   When scripts/embed-icons.ts re-embeds the catalog, those
--   rankings are stale but there's no per-row signal saying so —
--   today the operator has to TRUNCATE the table by hand. We
--   instead stamp a `version` on every cache row + read the
--   currently-active version at request time, so old rows fall
--   out of consideration on their own. Same value travels in the
--   API response so browsers can drop their in-memory cache too.
--
-- Lifecycle:
--   - Single-row meta table holds the active version.
--   - The embed script bumps it (new uuid) at the end of a run.
--   - The search route filters cache lookups by that version and
--     writes the current version on insert.

create table if not exists tracker.icon_catalog_meta (
    id          int primary key default 1,
    version     text not null default gen_random_uuid()::text,
    updated_at  timestamptz not null default now(),
    constraint icon_catalog_meta_singleton check (id = 1)
);

-- Ensure exactly one row exists.
insert into tracker.icon_catalog_meta (id) values (1)
on conflict (id) do nothing;

alter table tracker.icon_catalog_meta enable row level security;

drop policy if exists icon_catalog_meta_read_all on tracker.icon_catalog_meta;
create policy icon_catalog_meta_read_all on tracker.icon_catalog_meta
    for select to authenticated, anon
    using (true);

grant select on tracker.icon_catalog_meta to authenticated, anon;
grant all    on tracker.icon_catalog_meta to service_role;

-- Per-row version on the existing cache table. Pre-migration rows
-- get NULL — the route treats those as stale (will re-embed and
-- overwrite on next access).
alter table tracker.icon_search_cache
    add column if not exists version text;

create index if not exists icon_search_cache_version_idx
    on tracker.icon_search_cache(version);
