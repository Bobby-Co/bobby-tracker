-- Add a structured `data` column to tracker.issue_suggestions so the
-- tracker can persist the new /issues/analyse JSON output verbatim
-- (summary, suggestions[], investigation_plan, confidence). The legacy
-- markdown / code_cites / graph_cites columns stay populated for
-- backward compatibility with rows produced by the old /query path.

alter table tracker.issue_suggestions
    add column if not exists data jsonb;

comment on column tracker.issue_suggestions.data is
    'Structured /issues/analyse response: {summary, suggestions[], investigation_plan, confidence, …}. Null for legacy rows.';
