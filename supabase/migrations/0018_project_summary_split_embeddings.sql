-- Split the single summary_embedding into four facet embeddings so
-- project-routing can weigh signals separately.
--
-- Why: a project's "stack" tells you almost nothing about whether a
-- given issue belongs to it (lots of projects share Next.js + Postgres),
-- whereas its "modules" list is the single most predictive signal
-- (an issue mentioning a module name almost always belongs to its
-- owning project). One blended embedding can't express that — the
-- module token gets diluted by overview prose. Four facets let us
-- weigh them as the AI compose flow needs.
--
-- Weights (set by the caller of find_similar_projects):
--   - overview  25%   high-level "what is this product"
--   - features  20%   feature-level / cluster-note signals
--   - stack     15%   technology fingerprint, deliberately low
--   - modules   40%   structural fingerprint, deliberately high
--
-- bobby-analyser computes these on every successful bootstrap /
-- incremental update via internal/summariser. Each chunk runs through
-- text-embedding-3-small independently.

-- Drop the old single-vector column + index. summary_markdown stays
-- (human-readable display) along with summary_model + summary_updated_at.
drop index if exists tracker.project_analyser_summary_hnsw_idx;

alter table tracker.project_analyser
    drop column if exists summary_embedding;

-- Four new vector columns, one per facet.
alter table tracker.project_analyser
    add column if not exists summary_overview_embedding vector(1536),
    add column if not exists summary_features_embedding vector(1536),
    add column if not exists summary_stack_embedding    vector(1536),
    add column if not exists summary_modules_embedding  vector(1536);

create index if not exists project_analyser_summary_overview_idx
    on tracker.project_analyser using hnsw (summary_overview_embedding vector_cosine_ops)
    where summary_overview_embedding is not null;

create index if not exists project_analyser_summary_features_idx
    on tracker.project_analyser using hnsw (summary_features_embedding vector_cosine_ops)
    where summary_features_embedding is not null;

create index if not exists project_analyser_summary_stack_idx
    on tracker.project_analyser using hnsw (summary_stack_embedding vector_cosine_ops)
    where summary_stack_embedding is not null;

create index if not exists project_analyser_summary_modules_idx
    on tracker.project_analyser using hnsw (summary_modules_embedding vector_cosine_ops)
    where summary_modules_embedding is not null;

-- Recreate find_similar_projects with the weighted-facet model. The
-- caller passes ONE issue-draft embedding and the four weights; the
-- function compares it against each facet vector independently and
-- returns the weighted sum.
--
-- A facet that's missing on a row contributes 0 instead of NULL, so
-- partially-summarised projects still rank — they just rank lower
-- than fully-summarised ones, which is the right incentive.
--
-- We keep the old function signature alive too: replacing the
-- existing function in place (CREATE OR REPLACE) requires the same
-- argument list, but Postgres doesn't support that for changed
-- argument lists. Drop-then-create both shapes.
drop function if exists tracker.find_similar_projects(vector(1536), uuid[], int);

create or replace function tracker.find_similar_projects(
    p_embedding       vector(1536),
    p_project_ids     uuid[],
    p_limit           int   default 5,
    p_weight_overview float default 0.25,
    p_weight_features float default 0.20,
    p_weight_stack    float default 0.15,
    p_weight_modules  float default 0.40
)
returns table (
    project_id uuid,
    similarity float,
    /* per-facet breakdown so callers can show how the score was
       composed — useful for debugging routing decisions in the UI. */
    overview_sim float,
    features_sim float,
    stack_sim    float,
    modules_sim  float
)
language sql
security invoker
set search_path = tracker, public
as $$
    select
        a.project_id,
        coalesce(p_weight_overview * (1 - (a.summary_overview_embedding <=> p_embedding)), 0)
            + coalesce(p_weight_features * (1 - (a.summary_features_embedding <=> p_embedding)), 0)
            + coalesce(p_weight_stack    * (1 - (a.summary_stack_embedding    <=> p_embedding)), 0)
            + coalesce(p_weight_modules  * (1 - (a.summary_modules_embedding  <=> p_embedding)), 0)
            as similarity,
        case when a.summary_overview_embedding is not null
             then 1 - (a.summary_overview_embedding <=> p_embedding) end as overview_sim,
        case when a.summary_features_embedding is not null
             then 1 - (a.summary_features_embedding <=> p_embedding) end as features_sim,
        case when a.summary_stack_embedding is not null
             then 1 - (a.summary_stack_embedding <=> p_embedding) end as stack_sim,
        case when a.summary_modules_embedding is not null
             then 1 - (a.summary_modules_embedding <=> p_embedding) end as modules_sim
    from tracker.project_analyser a
    where a.project_id = any(p_project_ids)
      and (a.summary_overview_embedding is not null
           or a.summary_features_embedding is not null
           or a.summary_stack_embedding is not null
           or a.summary_modules_embedding is not null)
    order by similarity desc
    limit p_limit;
$$;

grant execute on function tracker.find_similar_projects(
    vector(1536), uuid[], int, float, float, float, float
) to authenticated, service_role;
