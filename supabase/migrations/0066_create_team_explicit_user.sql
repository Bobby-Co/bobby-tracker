-- 0066_create_team_explicit_user.sql — create_team takes the caller explicitly.
--
-- The server is moving from a per-request RLS client to a service-role client:
-- authorization is decided by AccessService before any query runs, and the
-- database is no longer asked to re-derive it. Under service-role `auth.uid()` is
-- NULL, so `create_team` — which used it both as a gate and as `created_by` —
-- would raise 'auth required' on every call.
--
-- ensure_personal_team already solved this: it takes `p_user` and asserts it
-- matches the session when there IS one. This copies that shape exactly, so both
-- team-creation paths behave the same way under both kinds of client.
--
-- The assertion is the important part. With an RLS client (a browser-issued JWT)
-- `auth.uid()` is set, and passing someone else's id is rejected — so this does
-- not become a way to create teams as another user. With a service-role client
-- there is no session to check against, and the caller is the server, which has
-- already established who is asking.

drop function if exists tracker.create_team(text, text, text);

create or replace function tracker.create_team(p_name text, p_region text, p_cell text, p_user uuid)
returns uuid language plpgsql security definer set search_path = tracker, pg_temp as $$
declare v_team uuid;
begin
    if p_user is null then
        raise exception 'user required' using errcode = '42501';
    end if;
    -- Mirrors ensure_personal_team: when a session exists it must be the same
    -- user. Null (service-role) means the server is calling on someone's behalf
    -- and has already authorised it.
    if auth.uid() is not null and auth.uid() <> p_user then
        raise exception 'cannot create a team as another user' using errcode = '42501';
    end if;
    if length(trim(coalesce(p_name, ''))) = 0 then
        raise exception 'name required' using errcode = '22000';
    end if;
    if length(trim(coalesce(p_region, ''))) = 0 or length(trim(coalesce(p_cell, ''))) = 0 then
        raise exception 'placement required' using errcode = '22000';
    end if;

    insert into tracker.teams (name, is_personal, created_by, region, cell)
    values (trim(p_name), false, p_user, trim(p_region), trim(p_cell))
    returning id into v_team;

    insert into tracker.team_members (team_id, user_id, role)
    values (v_team, p_user, 'owner');

    return v_team;
end $$;

grant execute on function tracker.create_team(text, text, text, uuid) to authenticated, service_role;
revoke execute on function tracker.create_team(text, text, text, uuid) from public, anon;
