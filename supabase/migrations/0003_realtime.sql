-- Enable Supabase Realtime for the tables the tracker subscribes to live:
--   - tracker.project_analyser  → analyser-panel reacts to status flips
--                                   (indexing → ready / failed) without
--                                   the user refreshing.
--   - tracker.issue_suggestions → suggestions panel picks up new rows
--                                   inserted by /api/issues/[id]/suggest
--                                   even if the request happened in
--                                   another tab.
--
-- RLS still applies to realtime — clients only receive rows they're
-- allowed to read by the existing policies. No data leaks.

alter publication supabase_realtime add table tracker.project_analyser;
alter publication supabase_realtime add table tracker.issue_suggestions;
