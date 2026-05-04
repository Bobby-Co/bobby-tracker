-- Fix permission denied on project_layer_tags / project_feature_tags
-- when the analyser calls replace_project_tags.
--
-- 0021 created the RPC as `security definer`, which makes it run as
-- the function owner instead of the caller. In our setup that owner
-- doesn't carry BYPASSRLS, so even though the analyser uses
-- service_role to invoke the RPC, the writes inside the function hit
-- RLS on tables that only have a SELECT policy — hence the "permission
-- denied" the user is seeing.
--
-- The grant on this RPC is service_role-only, and service_role does
-- bypass RLS, so flipping the function to `security invoker` removes
-- the problem cleanly: the deletes + inserts inherit the caller's
-- BYPASSRLS attribute and go through. We also grant explicit DML on
-- the tag tables to service_role as a belt-and-braces guarantee.

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

    insert into tracker.project_layer_tags(project_id, tag, embedding)
    select
        p_project_id,
        nullif(t->>'tag', ''),
        ((t->'embedding')::text)::vector(1536)
    from jsonb_array_elements(coalesce(p_layer_tags, '[]'::jsonb)) as t
    where coalesce(t->>'tag', '') <> ''
      and jsonb_typeof(t->'embedding') = 'array'
    on conflict (project_id, tag) do update set embedding = excluded.embedding;

    insert into tracker.project_feature_tags(project_id, tag, embedding)
    select
        p_project_id,
        nullif(t->>'tag', ''),
        ((t->'embedding')::text)::vector(1536)
    from jsonb_array_elements(coalesce(p_feature_tags, '[]'::jsonb)) as t
    where coalesce(t->>'tag', '') <> ''
      and jsonb_typeof(t->'embedding') = 'array'
    on conflict (project_id, tag) do update set embedding = excluded.embedding;
end;
$$;

revoke all on function tracker.replace_project_tags(uuid, jsonb, jsonb) from public;
grant execute on function tracker.replace_project_tags(uuid, jsonb, jsonb) to service_role;

-- Explicit DML grants. service_role normally inherits these via
-- Supabase's default ALL-PRIVILEGES grant on the tracker schema, but
-- being explicit means future schema-grant changes can't silently
-- break the analyser write path.
grant select, insert, update, delete on tracker.project_layer_tags   to service_role;
grant select, insert, update, delete on tracker.project_feature_tags to service_role;
