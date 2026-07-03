-- 0036_mind_context_grants.sql
--
-- Fixes an omission in 0035: tracker.mind_context enabled RLS but never granted
-- table privileges to service_role. RLS bypass (service_role) is ROW-level only;
-- Postgres still enforces table-level GRANTs, so the analyser's service-role
-- writes/reads failed with `42501 permission denied for table mind_context`.
--
-- Every other service-role table in this schema grants itself explicitly
-- (0009/0019/0027/0028/0029/…) because 0001's `grant all on all tables` only
-- covered tables that existed at that point. This is that missing grant.
--
-- service_role only, on purpose: the store is internal analyser plumbing. The
-- tracker UI (anon/authenticated) never touches it, and RLS with no policies
-- keeps it that way.

grant all on table tracker.mind_context to service_role;
