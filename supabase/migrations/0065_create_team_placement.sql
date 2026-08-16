-- 0065_create_team_placement.sql — a team chooses its placement when it is born.
--
-- 0064 put `region`/`cell` on tracker.teams, defaulted to the home cell. This
-- teaches create_team to accept them, so a new team lands where the user asked
-- rather than always at home.
--
-- The signature changes rather than gaining defaulted parameters: overloading
-- would leave `create_team(text)` and `create_team(text, text, text)` both
-- callable with one argument, and Postgres rejects that call as ambiguous. So the
-- old one is dropped outright — nothing else calls it, and the repository is
-- updated in the same change.
--
-- Placement is required, not optional. A caller that does not care must resolve
-- the home cell explicitly through the registry; silently defaulting here would
-- put teams on the home cell in a way no one could see or debug from the app.
--
-- NOTE on personal teams: ensure_personal_team is deliberately left alone. A
-- personal team is bootstrapped on first sight of a user, before any UI could ask
-- where they want it, so it takes the column default (the home cell). Moving a
-- personal team is the same migration job as moving any other team.

drop function if exists tracker.create_team(text);

create or replace function tracker.create_team(p_name text, p_region text, p_cell text)
returns uuid language plpgsql security definer set search_path = tracker, pg_temp as $$
declare v_team uuid;
begin
    if auth.uid() is null then
        raise exception 'auth required' using errcode = '42501';
    end if;
    if length(trim(coalesce(p_name, ''))) = 0 then
        raise exception 'name required' using errcode = '22000';
    end if;
    -- The app resolves these from modules/regions before calling. Rejecting empty
    -- values here keeps a bug in that resolution from silently creating teams at
    -- home; the slug format itself is enforced by the 0064 check constraints.
    if length(trim(coalesce(p_region, ''))) = 0 or length(trim(coalesce(p_cell, ''))) = 0 then
        raise exception 'placement required' using errcode = '22000';
    end if;

    insert into tracker.teams (name, is_personal, created_by, region, cell)
    values (trim(p_name), false, auth.uid(), trim(p_region), trim(p_cell))
    returning id into v_team;

    insert into tracker.team_members (team_id, user_id, role)
    values (v_team, auth.uid(), 'owner');

    return v_team;
end $$;

-- Mirror the grants 0052 set on the old signature: callable by a signed-in user,
-- never anonymously.
grant execute on function tracker.create_team(text, text, text) to authenticated, service_role;
revoke execute on function tracker.create_team(text, text, text) from public, anon;
