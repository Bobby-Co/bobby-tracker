-- 0064_team_placement.sql — move placement from the project to the TEAM.
--
-- 0062 pinned each project to a region + cell. That turned out to be the wrong
-- grain, for one concrete reason: a request cannot discover a project's region
-- without first reading the project, and under the split the project's content
-- lives in the region you are trying to identify. Every `/api/issues/[id]/*`
-- route hit that circularity — the issue knows its project, but you need the
-- region to read the issue at all.
--
-- Pinning the TEAM removes it. Every request already resolves an active team from
-- the `x-team-id` header (or the `team_id` cookie) before touching any data, so
-- the cell is known at the very start of a request, from the control plane, with
-- no regional read. One hop, no circularity, no fan-out.
--
-- It also collapses a second problem: with a team's projects guaranteed to share
-- a cell, every team-scoped listing — the sidebar, the create-time duplicate
-- check, the collections picker, MCP's knowledge-base roster — reads one place
-- and gets the whole answer. Project-grained placement made each of those return
-- a silent subset.
--
-- THE TRADE, made deliberately: a team cannot hold an American repo and a Thai
-- one. A customer who needs both needs two teams — which is usually what they
-- want anyway, since they are separating billing and access along the same line.
--
-- Placement is still routing only. Access is scoped by team membership, never by
-- region; nothing here touches authorization.

alter table tracker.teams
    add column if not exists region text not null default 'north-america',
    add column if not exists cell   text not null default 'ashburn-0';

-- Slug FORMAT checks rather than an enum, so adding a region or a cell stays a
-- config change. The registry in modules/regions decides what actually exists;
-- an id it does not know fails loudly at routing time.
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'teams_region_slug') then
        alter table tracker.teams
            add constraint teams_region_slug
            check (region ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(region) <= 64);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'teams_cell_slug') then
        alter table tracker.teams
            add constraint teams_cell_slug
            check (cell ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(cell) <= 64);
    end if;
end $$;

comment on column tracker.teams.region is
    'User-facing geography this team was placed in (e.g. south-east-asia). Every project the team owns is served from here. Mirrors RegionId in modules/regions.';
comment on column tracker.teams.cell is
    'Deployment unit holding this team''s analyser and regional content (e.g. bangkok-0). Assigned by the app at team creation, never chosen by the user. Mirrors CellId in modules/regions.';

-- "Everything living in this cell" — what a drain or rebalance job scans.
create index if not exists teams_cell_idx on tracker.teams (cell);

-- Carry any placement 0062 recorded on projects up to the owning team, so a
-- database that already ran 0062 keeps whatever it had. Every project is on the
-- home cell today, so in practice this is a no-op; it exists so the migration is
-- correct rather than merely convenient. `min` picks deterministically if a team
-- somehow has projects on two cells — an impossible state going forward, and one
-- the team-grained model is designed to prevent.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'tracker' and table_name = 'projects' and column_name = 'cell'
    ) then
        update tracker.teams t
        set region = p.region, cell = p.cell
        from (
            select team_id, min(region) as region, min(cell) as cell
            from tracker.projects
            group by team_id
        ) p
        where p.team_id = t.id;
    end if;
end $$;

-- The project columns are now redundant: a project's placement is its team's.
-- Keeping them would invite exactly the drift this migration exists to remove —
-- two answers to one question, diverging the first time one is updated alone.
alter table tracker.projects drop constraint if exists projects_region_slug;
alter table tracker.projects drop constraint if exists projects_cell_slug;
drop index if exists tracker.projects_region_idx;
drop index if exists tracker.projects_cell_idx;
alter table tracker.projects drop column if exists region;
alter table tracker.projects drop column if exists cell;
