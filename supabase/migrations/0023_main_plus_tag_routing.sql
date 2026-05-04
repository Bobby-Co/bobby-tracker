-- Reshape project routing into best-practice "main + tag refinement":
--
--   final = 0.70 * cosine(issue_query, main_project_embedding)
--         + 0.30 * max(cosine(issue_query, project_tag_embedding))
--
-- This replaces the four-prose-facet + bare-tag system from 0021.
-- The reasons we're moving:
--
--   1. Bare-slug tag embeddings ("frontend", "auth") have too little
--      context to discriminate between projects — every web repo
--      embeds "frontend" the same way. Tags should be embedded as
--      contextualised phrases ("MyApp — frontend layer: React UI,
--      design system, dashboards") that carry project + role signal.
--
--   2. Splitting overview/stack/modules into three vectors fragments
--      the primary "what is this project" signal. Folding them into
--      one rich main embedding (name + summary + layers + features +
--      stack + modules) makes the dominant routing dimension
--      stronger AND simpler.
--
--   3. The issue side only needs ONE query vector — its
--      routing_summary embedding. Running it against the project's
--      main vector + the project's tag pool and taking
--      0.7*main + 0.3*max(tag) gives strong global context PLUS
--      precision boost on specific concepts.
--
-- Stack + modules columns are dropped: their content is recreated
-- inside the main overview text on the next analyser update, so
-- nothing's lost.

-- ─── drop legacy columns + indexes ──────────────────────────────────────────
drop index if exists tracker.project_analyser_summary_stack_idx;
drop index if exists tracker.project_analyser_summary_modules_idx;

alter table tracker.project_analyser
    drop column if exists summary_stack_embedding,
    drop column if exists summary_modules_embedding;

-- ─── replace the 0021 multi-vector RPC with the single-vector one ──────────
drop function if exists tracker.find_similar_projects(
    vector(1536), vector(1536), vector(1536),
    uuid[], int,
    float, float, float, float, float
);

-- New shape: one query vector + 5 args. Caller passes the issue's
-- routing_summary embedding; we score it against the project's main
-- vector AND the layer + feature tag pools, then blend.
create or replace function tracker.find_similar_projects(
    p_query_embedding vector(1536),
    p_project_ids     uuid[],
    p_limit           int   default 5,
    p_weight_main     float default 0.70,
    p_weight_tag      float default 0.30
)
returns table (
    project_id  uuid,
    similarity  float,
    main_sim    float,
    layer_sim   float,
    feature_sim float,
    tag_sim     float
)
language sql
security invoker
set search_path = tracker, public
as $$
    with bases as (
        select pid as project_id from unnest(p_project_ids) as pid
    ),
    main_scores as (
        select b.project_id,
               case when a.summary_overview_embedding is not null
                    then 1 - (a.summary_overview_embedding <=> p_query_embedding) end as main_sim
        from bases b
        left join tracker.project_analyser a on a.project_id = b.project_id
    ),
    layer_scores as (
        select b.project_id,
               max(1 - (lt.embedding <=> p_query_embedding)) as layer_sim
        from bases b
        left join tracker.project_layer_tags lt on lt.project_id = b.project_id
        group by b.project_id
    ),
    feature_scores as (
        select b.project_id,
               max(1 - (ft.embedding <=> p_query_embedding)) as feature_sim
        from bases b
        left join tracker.project_feature_tags ft on ft.project_id = b.project_id
        group by b.project_id
    )
    select
        b.project_id,
        coalesce(p_weight_main * ms.main_sim, 0)
            + coalesce(p_weight_tag * greatest(coalesce(ls.layer_sim, 0),
                                               coalesce(fs.feature_sim, 0)), 0)
            as similarity,
        ms.main_sim,
        ls.layer_sim,
        fs.feature_sim,
        greatest(coalesce(ls.layer_sim, 0), coalesce(fs.feature_sim, 0)) as tag_sim
    from bases b
    left join main_scores    ms on ms.project_id = b.project_id
    left join layer_scores   ls on ls.project_id = b.project_id
    left join feature_scores fs on fs.project_id = b.project_id
    order by similarity desc
    limit p_limit;
$$;

grant execute on function tracker.find_similar_projects(
    vector(1536), uuid[], int, float, float
) to authenticated, service_role;
