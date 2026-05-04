-- Per-tag confidence (0..1) so the routing score reflects how
-- DOMINANT a layer or feature actually is in the project, not just
-- whether the analyser detected any trace of it.
--
-- Without this, a backend-heavy monolith with a tiny admin UI got
-- the same "frontend" match strength as a pure React app — the
-- cosine to "frontend" was ~the same in both vectors, and a single
-- close embedding was enough to win the layer dimension.
--
-- With confidence:
--
--   layer_sim   = max(confidence × cosine)
--   feature_sim = max(confidence × cosine)
--
-- A project with frontend confidence 0.3 caps its frontend layer_sim
-- at 0.3 even on a perfect cosine match. A confidence-1.0 frontend
-- repo can score up to the full cosine. Backwards compatible: NULL
-- confidence (analyser predates this migration) defaults to 1.0 so
-- existing rows still match at full strength.

alter table tracker.project_layer_tags
    add column if not exists confidence float not null default 1.0
    check (confidence >= 0 and confidence <= 1);

alter table tracker.project_feature_tags
    add column if not exists confidence float not null default 1.0
    check (confidence >= 0 and confidence <= 1);

-- replace_project_tags now reads "confidence" from the per-tag JSON
-- payload. Missing / out-of-range values clamp to [0,1] with 1.0 as
-- the default — never null, so the column constraint stays happy.
create or replace function tracker.replace_project_tags(
    p_project_id   uuid,
    p_layer_tags   jsonb,
    p_feature_tags jsonb
)
returns void
language plpgsql
security invoker
set search_path = tracker, public
as $$
begin
    delete from tracker.project_layer_tags   where project_id = p_project_id;
    delete from tracker.project_feature_tags where project_id = p_project_id;

    insert into tracker.project_layer_tags(project_id, tag, embedding, confidence)
    select
        p_project_id,
        nullif(t->>'tag', ''),
        ((t->'embedding')::text)::vector(1536),
        greatest(0, least(1, coalesce((t->>'confidence')::float, 1.0)))
    from jsonb_array_elements(coalesce(p_layer_tags, '[]'::jsonb)) as t
    where coalesce(t->>'tag', '') <> ''
      and jsonb_typeof(t->'embedding') = 'array'
    on conflict (project_id, tag) do update
        set embedding  = excluded.embedding,
            confidence = excluded.confidence;

    insert into tracker.project_feature_tags(project_id, tag, embedding, confidence)
    select
        p_project_id,
        nullif(t->>'tag', ''),
        ((t->'embedding')::text)::vector(1536),
        greatest(0, least(1, coalesce((t->>'confidence')::float, 1.0)))
    from jsonb_array_elements(coalesce(p_feature_tags, '[]'::jsonb)) as t
    where coalesce(t->>'tag', '') <> ''
      and jsonb_typeof(t->'embedding') = 'array'
    on conflict (project_id, tag) do update
        set embedding  = excluded.embedding,
            confidence = excluded.confidence;
end;
$$;

revoke all on function tracker.replace_project_tags(uuid, jsonb, jsonb) from public;
grant execute on function tracker.replace_project_tags(uuid, jsonb, jsonb) to service_role;

-- find_similar_projects now multiplies the cosine by the per-tag
-- confidence inside the MAX, so a low-confidence match can't carry
-- the dimension. Function signature unchanged — same call sites work.
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
               max(coalesce(lt.confidence, 1.0) * (1 - (lt.embedding <=> p_query_embedding))) as layer_sim
        from bases b
        left join tracker.project_layer_tags lt on lt.project_id = b.project_id
        group by b.project_id
    ),
    feature_scores as (
        select b.project_id,
               max(coalesce(ft.confidence, 1.0) * (1 - (ft.embedding <=> p_query_embedding))) as feature_sim
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
