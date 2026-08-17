-- 0034_issue_search_service.sql
--
-- Trusted, service-role issue similarity search for bobby-analyser's chat
-- "mind" endpoint (analyser ADR-0048).
--
-- The analyser's /chat thinker can choose an "issues" action: it embeds the
-- user's question via /embeddings and needs to nearest-neighbor it against this
-- project's issue vectors. It calls the analyser -> Supabase over PostgREST with
-- the SERVICE-ROLE key (the same trust level already used to upsert
-- issue_embeddings in lib/issue-embedding.ts).
--
-- Why a new function instead of reusing tracker.find_similar_issues (0015):
-- that one is security-definer and gated on `p.user_id = auth.uid()`. A
-- service-role call carries no user JWT, so auth.uid() is null and the guard
-- raises. This function is security-INVOKER and EXECUTE is granted only to
-- service_role, so:
--   * the trusted backend can run it (service_role bypasses table RLS and sees
--     all rows), scoped explicitly by p_project_id;
--   * anon / authenticated callers cannot invoke it at all (no EXECUTE grant),
--     so it can't be used to read another user's issues from the browser.
-- The tracker's mind route (app/api/projects/[id]/mind/route.ts) authenticates
-- the user and confirms project ownership before ever asking the analyser to
-- search, so the project scope passed here is already authorized.
--
-- Returns `body` too (unlike find_similar_issues) so the analyser's finaliser
-- has enough context to judge relevance and summarize. Excludes issues marked as
-- duplicates so they don't dominate results.

create or replace function tracker.match_project_issues(
    p_project_id uuid,
    p_embedding  vector(1536),
    p_limit      int default 5
)
returns table (
    id           uuid,
    issue_number int,
    title        text,
    body         text,
    status       text,
    similarity   float
)
language sql
stable
security invoker
set search_path = tracker, public
as $$
    select
        i.id,
        i.issue_number,
        i.title,
        i.body,
        i.status::text,
        1 - (e.embedding <=> p_embedding) as similarity
    from tracker.issues i
        join tracker.issue_embeddings e on e.issue_id = i.id
    where i.project_id = p_project_id
      and i.duplicate_of_issue_id is null
    order by e.embedding <=> p_embedding
    limit p_limit;
$$;

-- Lock the function down to the trusted backend only.
revoke execute on function tracker.match_project_issues(uuid, vector, int) from public;
revoke execute on function tracker.match_project_issues(uuid, vector, int) from anon, authenticated;
grant  execute on function tracker.match_project_issues(uuid, vector, int) to service_role;
