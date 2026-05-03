-- Treat "accepts public submissions" as a per-project integration
-- (mirrors project_analyser) and lift reporter identity off the
-- generic issues table into a dedicated linking table so the public
-- pipeline doesn't pollute the rest of the issue model.
--
-- Two structural changes:
--
--   1. tracker.project_public_integration — owner-toggleable flag.
--      Projects default to disabled; a project that hasn't enabled
--      the integration cannot be added to a public session (enforced
--      by trigger on public_session_projects so service-role inserts
--      can't sneak around it).
--
--   2. tracker.public_issue_reporters — issue_id-keyed extension
--      table holding reporter_id, reporter_name, and the session that
--      minted the submission. Owner-filed issues simply have no row
--      here. The public_reporter_* columns added by 0010 are copied
--      in and then dropped.

-- ─── tracker.project_public_integration ─────────────────────────────────────
create table if not exists tracker.project_public_integration (
    project_id  uuid primary key references tracker.projects(id) on delete cascade,
    enabled     boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

drop trigger if exists touch_project_public_integration on tracker.project_public_integration;
create trigger touch_project_public_integration
    before update on tracker.project_public_integration
    for each row execute function tracker.touch_updated_at();

alter table tracker.project_public_integration enable row level security;

drop policy if exists project_public_integration_owner_all on tracker.project_public_integration;
create policy project_public_integration_owner_all on tracker.project_public_integration
    for all
    using      (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()))
    with check (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()));

grant all on tracker.project_public_integration to authenticated, service_role;

-- Backfill: any project already covered by a session is treated as
-- already-enabled, since the owner clearly opted in earlier.
insert into tracker.project_public_integration (project_id, enabled)
select distinct project_id, true
from tracker.public_session_projects
on conflict (project_id) do update set enabled = true;

-- ─── tracker.public_issue_reporters ─────────────────────────────────────────
create table if not exists tracker.public_issue_reporters (
    issue_id        uuid primary key references tracker.issues(id) on delete cascade,
    -- Stable per-browser id (UUID from localStorage). Null tolerated
    -- for legacy rows or clients that didn't send one.
    reporter_id     text,
    -- Display name the submitter typed; null for anonymous.
    reporter_name   text,
    -- Which session minted this submission. on delete set null so
    -- attribution survives session deletion.
    session_id      uuid references tracker.public_sessions(id) on delete set null,
    created_at      timestamptz not null default now()
);

create index if not exists public_issue_reporters_reporter_idx
    on tracker.public_issue_reporters(reporter_id) where reporter_id is not null;
create index if not exists public_issue_reporters_session_idx
    on tracker.public_issue_reporters(session_id);

-- Backfill from the columns added in 0010, only if they still exist.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'tracker' and table_name = 'issues'
          and column_name = 'public_reporter_id'
    ) then
        insert into tracker.public_issue_reporters (issue_id, reporter_id, reporter_name)
        select id, public_reporter_id, public_reporter_name
        from tracker.issues
        where public_reporter_id is not null or public_reporter_name is not null
        on conflict (issue_id) do nothing;
    end if;
end $$;

alter table tracker.issues
    drop column if exists public_reporter_id,
    drop column if exists public_reporter_name;

alter table tracker.public_issue_reporters enable row level security;

drop policy if exists public_issue_reporters_owner_all on tracker.public_issue_reporters;
create policy public_issue_reporters_owner_all on tracker.public_issue_reporters
    for all
    using      (exists (
        select 1 from tracker.issues i
            join tracker.projects p on p.id = i.project_id
        where i.id = issue_id and p.user_id = auth.uid()
    ))
    with check (exists (
        select 1 from tracker.issues i
            join tracker.projects p on p.id = i.project_id
        where i.id = issue_id and p.user_id = auth.uid()
    ));

grant all on tracker.public_issue_reporters to authenticated, service_role;

-- ─── enforcement: session membership requires enabled integration ───────────
create or replace function tracker.assert_public_integration_enabled()
returns trigger language plpgsql as $$
declare
    is_enabled boolean;
begin
    select enabled into is_enabled
    from tracker.project_public_integration
    where project_id = new.project_id;

    if not coalesce(is_enabled, false) then
        raise exception
            'public submissions integration is not enabled for this project'
            using errcode = '23514';
    end if;
    return new;
end $$;

drop trigger if exists check_public_integration on tracker.public_session_projects;
create trigger check_public_integration
    before insert or update on tracker.public_session_projects
    for each row execute function tracker.assert_public_integration_enabled();
