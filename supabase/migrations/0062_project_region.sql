-- 0062_project_region.sql — pin each project to a region and a cell.
--
-- Two levels, because they answer different questions:
--
--   region  'south-east-asia'  coarse geography. What the CUSTOMER picks, what a
--                              data-residency question is answered in, what the
--                              UI shows. Stable for the life of the project.
--   cell    'bangkok-0'        one deployment unit with one analyser behind it.
--                              What the app ROUTES on. Internal — never shown to
--                              a customer, and assigned by the app (see
--                              RegionRegistry.assignCell) rather than chosen.
--
-- Splitting them is what lets capacity grow: a second Bangkok cell is added by
-- config alone, and every project already in south-east-asia keeps its region
-- while new ones can land on either cell. Rebalancing a project between cells in
-- the SAME region is a graph rebuild but not a jurisdiction change — a materially
-- cheaper operation than moving it between regions.
--
-- Placement is routing, not access control: authorization stays entirely on
-- team_id. Existing rows take the home cell.
--
-- NOTE: the values below must match BOBBY_HOME_CELL / its declared region in the
-- environment (defaults: ashburn-0 / north-america). They are the only two
-- literals here; everything else is validated by FORMAT, so adding a region or a
-- cell later needs no migration at all.

alter table tracker.projects
    add column if not exists region text not null default 'north-america',
    add column if not exists cell   text not null default 'ashburn-0';

-- Deliberately a SLUG FORMAT check, not an enum of known values. An enum would
-- make every new cell a migration + deploy, which defeats the point of adding
-- capacity by config; the registry decides what actually exists, and an id it
-- doesn't know fails loudly at routing time rather than silently at insert time.
-- `add constraint` has no `if not exists`, so both are guarded — migrations get
-- replayed from empty as well as applied forward.
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'projects_region_slug') then
        alter table tracker.projects
            add constraint projects_region_slug
            check (region ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(region) <= 64);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'projects_cell_slug') then
        alter table tracker.projects
            add constraint projects_cell_slug
            check (cell ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(cell) <= 64);
    end if;
end $$;

comment on column tracker.projects.region is
    'User-facing geography this project was placed in (e.g. south-east-asia). Mirrors RegionId in modules/regions. Routing only — access is scoped by team_id.';
comment on column tracker.projects.cell is
    'Deployment unit holding this project''s analyser and knowledge graph (e.g. bangkok-0). Mirrors CellId in modules/regions. Assigned by the app, never chosen by the user.';

-- The PK already answers "where is this project". These serve the inverse scans:
-- "everything in this cell" for a drain/rebalance job, "everything in this
-- region" for a residency report.
create index if not exists projects_cell_idx   on tracker.projects (cell);
create index if not exists projects_region_idx on tracker.projects (region);
