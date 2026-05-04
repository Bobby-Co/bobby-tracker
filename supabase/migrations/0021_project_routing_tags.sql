-- Tag-based routing. The single `summary_features_embedding` facet is
-- replaced by two tag pools per project — layer (frontend / backend /
-- api / database / infra / mobile / shared) and hierarchical feature
-- (domain/subdomain). Each tag carries its own embedding so issue
-- compose can score "does this project's tag pool contain anything
-- similar to this issue's layer / feature?" via max-cosine, instead of
-- folding everything into one prose vector.
--
-- The other three facets (overview / stack / modules) stay as-is. The
-- new RPC blends:
--
--   layer_sim    30%   — max cosine over project's layer tag pool
--   feature_sim  30%   — max cosine over project's feature tag pool
--   modules_sim  20%   — existing modules facet
--   overview_sim 10%   — existing overview facet (fuzzy fallback)
--   stack_sim    10%   — existing stack facet (fingerprint, low signal)
--
-- Layer + feature dominate (60%) because they encode the cross-repo
-- dimension that one-blob embeddings kept washing out.

-- ─── drop the old features facet ────────────────────────────────────────────
drop index if exists tracker.project_analyser_summary_features_idx;

alter table tracker.project_analyser
    drop column if exists summary_features_embedding;

-- Drop both signatures of the prior RPC (the original from 0017 may
-- linger in some envs alongside the 0018 one). Postgres needs the full
-- signature to drop a function.
drop function if exists tracker.find_similar_projects(vector(1536), uuid[], int);
drop function if exists tracker.find_similar_projects(vector(1536), uuid[], int, float, float, float, float);

-- ─── per-project tag pools ──────────────────────────────────────────────────

-- Layer tags. Controlled vocabulary — analyser is expected to emit
-- values from {frontend, backend, api, database, infra, mobile, shared}
-- but we don't enforce it in SQL: the embedding handles drift, and
-- locking the vocab in the schema would make it painful to evolve.
create table if not exists tracker.project_layer_tags (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid not null references tracker.projects(id) on delete cascade,
    tag          text not null,
    embedding    vector(1536) not null,
    created_at   timestamptz not null default now(),
    unique (project_id, tag)
);

create index if not exists project_layer_tags_project_idx
    on tracker.project_layer_tags(project_id);

-- Hierarchical feature tags ("domain/subdomain", e.g. "auth/login").
-- Free-form so the analyser can name what it actually finds.
create table if not exists tracker.project_feature_tags (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid not null references tracker.projects(id) on delete cascade,
    tag          text not null,
    embedding    vector(1536) not null,
    created_at   timestamptz not null default now(),
    unique (project_id, tag)
);

create index if not exists project_feature_tags_project_idx
    on tracker.project_feature_tags(project_id);

alter table tracker.project_layer_tags   enable row level security;
alter table tracker.project_feature_tags enable row level security;

-- Owners read their own tags. Mirrors project_analyser policy: scoped
-- by project ownership rather than user_id, since tags are 1-N to a
-- project.
drop policy if exists project_layer_tags_owner_read on tracker.project_layer_tags;
create policy project_layer_tags_owner_read on tracker.project_layer_tags
    for select to authenticated
    using (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()));

drop policy if exists project_feature_tags_owner_read on tracker.project_feature_tags;
create policy project_feature_tags_owner_read on tracker.project_feature_tags
    for select to authenticated
    using (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()));

-- Writes go through service-role (analyser) only — no INSERT/UPDATE
-- policy for authenticated. Service role bypasses RLS.

-- ─── replace_project_tags(project_id, layers, features) ─────────────────────
--
-- Atomic refresh helper for the analyser. Body shape:
--
--   layers   = [{ "tag": "frontend",         "embedding": [0.1, ...] }, …]
--   features = [{ "tag": "auth/login",        "embedding": [0.1, ...] }, …]
--
-- Old rows are deleted then re-inserted in one statement so a race
-- between two index runs can't leave a project with half its tags.
-- security definer because we're only callable by service-role anyway
-- and want a single grant point.
create or replace function tracker.replace_project_tags(
    p_project_id   uuid,
    p_layer_tags   jsonb,
    p_feature_tags jsonb
)
returns void
language plpgsql
security definer
set search_path = tracker, public
as $$
begin
    delete from tracker.project_layer_tags   where project_id = p_project_id;
    delete from tracker.project_feature_tags where project_id = p_project_id;

    insert into tracker.project_layer_tags(project_id, tag, embedding)
    select
        p_project_id,
        nullif(t->>'tag', ''),
        ((t->'embedding')::text)::vector(1536)
    from jsonb_array_elements(coalesce(p_layer_tags, '[]'::jsonb)) as t
    where coalesce(t->>'tag', '') <> ''
      and jsonb_typeof(t->'embedding') = 'array'
    on conflict (project_id, tag) do update set embedding = excluded.embedding;

    insert into tracker.project_feature_tags(project_id, tag, embedding)
    select
        p_project_id,
        nullif(t->>'tag', ''),
        ((t->'embedding')::text)::vector(1536)
    from jsonb_array_elements(coalesce(p_feature_tags, '[]'::jsonb)) as t
    where coalesce(t->>'tag', '') <> ''
      and jsonb_typeof(t->'embedding') = 'array'
    on conflict (project_id, tag) do update set embedding = excluded.embedding;
end;
$$;

revoke all on function tracker.replace_project_tags(uuid, jsonb, jsonb) from public;
grant execute on function tracker.replace_project_tags(uuid, jsonb, jsonb) to service_role;

-- ─── new find_similar_projects ──────────────────────────────────────────────
--
-- Three query vectors:
--
--   p_routing_embedding   embedding of the issue's routing_summary, used
--                         as the query for overview / stack / modules
--                         (the prose facets, where one query vector
--                         remains the right shape).
--   p_layer_embedding     embedding of the issue's layer text (e.g.
--                         "frontend"). Compared via max cosine against
--                         the project's project_layer_tags pool.
--   p_feature_embedding   embedding of the issue's feature text (joined
--                         when the issue has multiple). Compared the
--                         same way against project_feature_tags.
--
-- Missing facets contribute 0 (not NULL) so a partially-tagged project
-- still ranks but loses points proportional to what it's missing —
-- correct incentive: index your project, get better routing.

create or replace function tracker.find_similar_projects(
    p_routing_embedding vector(1536),
    p_layer_embedding   vector(1536),
    p_feature_embedding vector(1536),
    p_project_ids       uuid[],
    p_limit             int   default 5,
    p_weight_layer      float default 0.30,
    p_weight_feature    float default 0.30,
    p_weight_modules    float default 0.20,
    p_weight_overview   float default 0.10,
    p_weight_stack      float default 0.10
)
returns table (
    project_id   uuid,
    similarity   float,
    layer_sim    float,
    feature_sim  float,
    overview_sim float,
    stack_sim    float,
    modules_sim  float
)
language sql
security invoker
set search_path = tracker, public
as $$
    with bases as (
        select pid as project_id from unnest(p_project_ids) as pid
    ),
    layer_scores as (
        select b.project_id,
               max(1 - (lt.embedding <=> p_layer_embedding)) as layer_sim
        from bases b
        left join tracker.project_layer_tags lt on lt.project_id = b.project_id
        group by b.project_id
    ),
    feature_scores as (
        select b.project_id,
               max(1 - (ft.embedding <=> p_feature_embedding)) as feature_sim
        from bases b
        left join tracker.project_feature_tags ft on ft.project_id = b.project_id
        group by b.project_id
    ),
    facet_scores as (
        select b.project_id,
               case when a.summary_overview_embedding is not null
                    then 1 - (a.summary_overview_embedding <=> p_routing_embedding) end as overview_sim,
               case when a.summary_stack_embedding is not null
                    then 1 - (a.summary_stack_embedding <=> p_routing_embedding) end as stack_sim,
               case when a.summary_modules_embedding is not null
                    then 1 - (a.summary_modules_embedding <=> p_routing_embedding) end as modules_sim
        from bases b
        left join tracker.project_analyser a on a.project_id = b.project_id
    )
    select
        b.project_id,
        coalesce(p_weight_layer    * ls.layer_sim,   0)
            + coalesce(p_weight_feature  * fs.feature_sim, 0)
            + coalesce(p_weight_overview * gs.overview_sim,0)
            + coalesce(p_weight_stack    * gs.stack_sim,   0)
            + coalesce(p_weight_modules  * gs.modules_sim, 0) as similarity,
        ls.layer_sim,
        fs.feature_sim,
        gs.overview_sim,
        gs.stack_sim,
        gs.modules_sim
    from bases b
    left join layer_scores   ls on ls.project_id = b.project_id
    left join feature_scores fs on fs.project_id = b.project_id
    left join facet_scores   gs on gs.project_id = b.project_id
    order by similarity desc
    limit p_limit;
$$;

grant execute on function tracker.find_similar_projects(
    vector(1536), vector(1536), vector(1536),
    uuid[], int,
    float, float, float, float, float
) to authenticated, service_role;
