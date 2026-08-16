-- 0069_last_owner_allows_team_delete.sql — let a team actually be deleted.
--
-- protect_last_owner() (0052) stops the last owner being removed or demoted,
-- which is right for "remove a member": a team with no owner can never be
-- administered again, and there is no cron to repair it.
--
-- But it has no exception for the team ITSELF being deleted. `delete from teams`
-- cascades to team_members, the owner's row is removed, the guard fires, and the
-- whole transaction aborts with "cannot remove or demote the last owner of a
-- team". Team deletion has therefore never worked — the error names membership,
-- so it reads like a permissions problem rather than a trigger refusing a
-- cascade it was never taught about.
--
-- The fix is to ask whether the team still exists. Inside a cascade from the
-- team's own deletion it does not, and protecting the last owner of a team that
-- is going away is meaningless. Every other path — removing a member, demoting
-- an owner — still has its team present, so the guard is unchanged there.

create or replace function tracker.protect_last_owner()
returns trigger language plpgsql security definer set search_path = tracker, pg_temp as $$
declare v_team uuid; v_others int;
begin
    if tg_op = 'DELETE' then
        if old.role <> 'owner' then return old; end if;
        -- Cascade from `delete from tracker.teams`: the parent is already gone,
        -- so this membership is going with it. Nothing to protect.
        if not exists (select 1 from tracker.teams where id = old.team_id) then
            return old;
        end if;
        v_team := old.team_id;
    else -- UPDATE
        if old.role <> 'owner' or new.role = 'owner' then return new; end if;
        v_team := old.team_id;
    end if;
    select count(*) into v_others from tracker.team_members
     where team_id = v_team and role = 'owner' and user_id <> old.user_id;
    if v_others = 0 then
        raise exception 'cannot remove or demote the last owner of a team' using errcode = '23514';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
end $$;
