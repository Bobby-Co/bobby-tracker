-- 0068_issue_suggestions_soft_issue_ref.sql — the last cross-plane foreign key.
--
-- `issue_suggestions` is CONTROL plane: it is one of the three tables in the
-- supabase_realtime publication, so the browser subscribes to it directly and it
-- has to live where the browser's JWT is valid. `issues` is DATA plane and moves
-- with the region.
--
-- That makes issue_suggestions.issue_id → issues a constraint spanning two
-- databases, which Postgres cannot express. Left in place, the first suggestion
-- written for a Bangkok issue is rejected: the central database looks for that
-- issue id in its own `issues` table and does not find it. Analysis would run,
-- cost money, and fail at the last step with a foreign-key violation.
--
-- The column stays. `issue_id` still identifies the issue; it is simply resolved
-- by the application against whichever region holds it.
--
-- WHAT THIS COSTS, stated plainly: the constraint carried ON DELETE CASCADE, so
-- deleting an issue used to remove its cached suggestions for free. That is now
-- the application's job — see ProjectContentPurge, which clears regional content
-- and the central suggestions that point at it as one operation.
--
-- This is the ONLY central→regional foreign key. Everything else the control
-- plane references (projects, teams, users) stays central, which is why the
-- earlier `projects`-regional cut was abandoned: it put four of these in the way,
-- including one on team deletion.

alter table tracker.issue_suggestions
    drop constraint if exists issue_suggestions_issue_id_fkey;

comment on column tracker.issue_suggestions.issue_id is
    'The issue this suggestion is for. SOFT reference since 0068 — the issue row lives in its team''s region while this table is central, so no FK can span the two. Cleanup on issue/project deletion is done by ProjectContentPurge.';
