-- Restructure public sessions from per-project to standalone, with a
-- many-to-many "covers these projects" relationship. A session is now
-- owned by a user; the public link presents the covered projects and
-- the submitter picks which one their issue is for.
--
-- We keep the existing tokens / submission_counts / time-windows by
-- copying every project_public_sessions row into the new table with
-- a one-project junction row, then dropping the old table.

-- ─── tracker.public_sessions ───────────────────────────────────────────────
create table if not exists tracker.public_sessions (
    id                  uuid        primary key default gen_random_uuid(),
    user_id             uuid        not null references auth.users(id) on delete cascade,
    token               text        not null unique,
    enabled             boolean     not null default true,
    -- Internal name shown in the owner's session list. Distinct from
    -- `title`, which is what the public page renders to submitters.
    name                text        not null,
    title               text,
    description         text,
    start_at            timestamptz,
    end_at              timestamptz,
    submission_count    int         not null default 0,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    constraint public_sessions_token_len    check (length(token) >= 16),
    constraint public_sessions_window_order check (start_at is null or end_at is null or start_at < end_at),
    constraint public_sessions_name_not_empty check (length(trim(name)) > 0)
);

create index if not exists public_sessions_user_idx
    on tracker.public_sessions(user_id);
create index if not exists public_sessions_token_idx
    on tracker.public_sessions(token) where enabled;

drop trigger if exists touch_public_sessions_v2 on tracker.public_sessions;
create trigger touch_public_sessions_v2
    before update on tracker.public_sessions
    for each row execute function tracker.touch_updated_at();

-- ─── tracker.public_session_projects (junction) ────────────────────────────
create table if not exists tracker.public_session_projects (
    session_id  uuid not null references tracker.public_sessions(id) on delete cascade,
    project_id  uuid not null references tracker.projects(id)        on delete cascade,
    created_at  timestamptz not null default now(),
    primary key (session_id, project_id)
);

create index if not exists public_session_projects_project_idx
    on tracker.public_session_projects(project_id);

-- ─── backfill from v1 ──────────────────────────────────────────────────────
-- One row per old session. We use the project's name as the new
-- session's internal name to give owners a recognisable label.
do $$
begin
    if to_regclass('tracker.project_public_sessions') is not null then
        insert into tracker.public_sessions (
            user_id, token, enabled, name, title, description,
            start_at, end_at, submission_count, created_at, updated_at
        )
        select
            p.user_id, pps.token, pps.enabled, p.name, pps.title, pps.description,
            pps.start_at, pps.end_at, pps.submission_count, pps.created_at, pps.updated_at
        from tracker.project_public_sessions pps
        join tracker.projects p on p.id = pps.project_id
        on conflict (token) do nothing;

        insert into tracker.public_session_projects (session_id, project_id)
        select ps.id, pps.project_id
        from tracker.project_public_sessions pps
        join tracker.public_sessions ps on ps.token = pps.token
        on conflict do nothing;

        drop table tracker.project_public_sessions cascade;
    end if;
end $$;

-- ─── RLS ───────────────────────────────────────────────────────────────────
alter table tracker.public_sessions          enable row level security;
alter table tracker.public_session_projects  enable row level security;

drop policy if exists public_sessions_owner_all on tracker.public_sessions;
create policy public_sessions_owner_all on tracker.public_sessions
    for all
    using      (user_id = auth.uid())
    with check (user_id = auth.uid());

-- The junction is gated through the session: only the session's owner
-- can read or mutate its membership. The project must also belong to
-- the same owner so a session can't reach into someone else's repo.
drop policy if exists public_session_projects_owner_all on tracker.public_session_projects;
create policy public_session_projects_owner_all on tracker.public_session_projects
    for all
    using      (exists (
        select 1 from tracker.public_sessions s
        where s.id = session_id and s.user_id = auth.uid()
    ))
    with check (exists (
        select 1 from tracker.public_sessions s
            join tracker.projects p on p.id = project_id
        where s.id = session_id and s.user_id = auth.uid() and p.user_id = auth.uid()
    ));

grant all on tracker.public_sessions         to authenticated, service_role;
grant all on tracker.public_session_projects to authenticated, service_role;
