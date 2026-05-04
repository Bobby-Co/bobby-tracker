-- Adjust the find_similar_projects blend from 70/30 main+max(tag) to
-- additive 40/30/30 main+layer+feature.
--
-- The 70/30 max(tag) shape gave a project credit for the BEST of its
-- two refinement signals. Now that the rollup is producing
-- contextualised tags reliably (per the analyser fixes in 0022/0024
-- + the json-mode summarise call), we want a project that matches on
-- BOTH dimensions to score higher than one matching on only one.
--
--   similarity = 0.40 * main_sim
--              + 0.30 * layer_sim
--              + 0.30 * feature_sim
--
-- Empty tag pools still contribute 0 (via coalesce), so projects
-- that haven't been re-indexed against the new tag system rank on
-- main_sim alone — same incentive as before.
--
-- We also drop tag_sim from the return shape since it was never
-- surfaced in the UI and stops being meaningful when the dimensions
-- combine additively.

drop function if exists tracker.find_similar_projects(
    vector(1536), uuid[], int, float, float
);

create or replace function tracker.find_similar_projects(
    p_query_embedding vector(1536),
    p_project_ids     uuid[],
    p_limit           int   default 5,
    p_weight_main     float default 0.40,
    p_weight_layer    float default 0.30,
    p_weight_feature  float default 0.30
)
returns table (
    project_id  uuid,
    similarity  float,
    main_sim    float,
    layer_sim   float,
    feature_sim float
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
        coalesce(p_weight_main    * ms.main_sim,    0)
            + coalesce(p_weight_layer   * ls.layer_sim,   0)
            + coalesce(p_weight_feature * fs.feature_sim, 0)
            as similarity,
        ms.main_sim,
        ls.layer_sim,
        fs.feature_sim
    from bases b
    left join main_scores    ms on ms.project_id = b.project_id
    left join layer_scores   ls on ls.project_id = b.project_id
    left join feature_scores fs on fs.project_id = b.project_id
    order by similarity desc
    limit p_limit;
$$;

grant execute on function tracker.find_similar_projects(
    vector(1536), uuid[], int, float, float, float
) to authenticated, service_role;
