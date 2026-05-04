-- Fix permission denied on project_layer_tags / project_feature_tags
-- when the AUTHENTICATED side reads them (via find_similar_projects).
--
-- 0001 grants `all on all tables in schema tracker` to authenticated +
-- service_role, but Postgres' GRANT ON ALL TABLES is a one-shot
-- snapshot — tables created afterwards (here: 0021's tag tables)
-- don't inherit. The fix in 0022 added grants for service_role only,
-- so the analyser write path works, but the tracker read path through
-- find_similar_projects (security invoker → runs as authenticated)
-- still hits "permission denied" before RLS is even evaluated.
--
-- Grant authenticated the same SELECT-level access it has on every
-- other tracker table. RLS policies (created in 0021) still gate
-- which rows a user actually sees — owner-only — so this doesn't
-- widen anyone's view, it just lets the policy run.
--
-- Also re-issuing the service_role grants from 0022 in the same
-- migration so a fresh database (running 0001..0024 in order)
-- doesn't need 0022 to have succeeded.

grant select on tracker.project_layer_tags   to authenticated;
grant select on tracker.project_feature_tags to authenticated;

grant select, insert, update, delete on tracker.project_layer_tags   to service_role;
grant select, insert, update, delete on tracker.project_feature_tags to service_role;
