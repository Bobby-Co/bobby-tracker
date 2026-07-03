-- 0037_reembed_reset.sql
--
-- Switch the embedding model to qwen3-embedding-8b (Fireworks), MRL-truncated to
-- 1536 dims. The DIMENSION is unchanged (1536), so there are NO schema, function,
-- or index changes — every vector(1536) column, find_similar_* function, and HNSW
-- index stays exactly as-is.
--
-- BUT the model changed, and you cannot compare vectors from two different models
-- in one space. So every stored embedding (produced by text-embedding-3-small)
-- is now stale and must be regenerated with the new model. This migration clears
-- the old vectors and forces a re-bootstrap so the whole corpus gets re-embedded:
--
--   * issue_embeddings          → cleared; re-embed with scripts/reembed-issues.ts
--   * project_analyser summaries → nulled; regenerated when each project re-bootstraps
--   * project layer/feature tags → cleared; regenerated when each project re-bootstraps
--   * icon_catalog vectors       → nulled; re-embed with scripts/embed-icons.ts
--   * project_analyser state     → 'ready' → 'pending', graph_id dropped (FalkorDB is
--                                  wiped separately), so clients re-index.
--
-- Until re-embedded, similarity search / routing return nothing for the affected
-- rows (honest empty) rather than cross-model garbage.

-- Old-model issue vectors (re-embed via scripts/reembed-issues.ts).
delete from tracker.issue_embeddings;

-- Old-model project routing data (regenerated when each project re-bootstraps).
delete from tracker.project_layer_tags;
delete from tracker.project_feature_tags;

-- Null every vector column on project_analyser (old-model summary facets),
-- discovered dynamically so this is robust to the exact facet set in your schema.
do $$
declare r record;
begin
  for r in
    select column_name
    from information_schema.columns
    where table_schema = 'tracker' and table_name = 'project_analyser' and udt_name = 'vector'
  loop
    execute format('update tracker.project_analyser set %I = null', r.column_name);
  end loop;
end $$;

-- Old-model icon vectors (re-embed via scripts/embed-icons.ts).
update tracker.icon_catalog set embedding = null, model = null;

-- Force a re-bootstrap: any 'ready' project drops to 'pending' and loses its
-- graph_id (its FalkorDB graph is wiped). Disabled / failed projects are left
-- alone so re-enabling stays the operator's choice.
update tracker.project_analyser
   set status   = case when status = 'ready' then 'pending'::tracker.analyser_status else status end,
       graph_id = null;
