-- GitHub sync settings: direction + delete propagation.
--
--   * github_sync_direction — which way issues flow:
--       'inbound'  = GitHub → ucelot only (issues created in ucelot are NOT
--                    pushed to GitHub)
--       'outbound' = ucelot → GitHub only (issues created on GitHub are NOT
--                    pulled into ucelot)
--       'both'     = full two-way (default).
--   * github_sync_deletes — when true AND the direction allows it, deleting an
--       issue on one side deletes/closes it on the other. Off by default because
--       it's destructive; must be opted into explicitly.
--
-- Both only matter when github_sync_enabled is true.

alter table tracker.projects
    add column if not exists github_sync_direction text    not null default 'both',
    add column if not exists github_sync_deletes   boolean not null default false;

alter table tracker.projects
    drop constraint if exists projects_github_sync_direction_valid;
alter table tracker.projects
    add constraint projects_github_sync_direction_valid
    check (github_sync_direction in ('inbound', 'outbound', 'both'));
