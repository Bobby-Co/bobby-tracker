-- Add a 'duplicated' value to the tracker.issue_status enum.
--
-- An issue marked as a duplicate of another (via
-- duplicate_of_issue_id) is now also stamped with status='duplicated'
-- by the API layer (see app/api/issues/[id]/duplicate-of/route.ts).
-- That gives the UI a single state to filter on without needing to
-- join through the duplicate_of column for every list query, and
-- makes "duplicated" appear in the same status pill / dropdown UI
-- as the rest of the lifecycle states.
--
-- ALTER TYPE … ADD VALUE is not transactional in older Postgres
-- versions, but Supabase's planner handles the IF NOT EXISTS guard,
-- so re-running this migration is safe.

alter type tracker.issue_status add value if not exists 'duplicated';
