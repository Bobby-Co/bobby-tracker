-- bobby-tracker schema. Lives alongside Bobby/service's `public` schema in
-- the same Supabase project so auth.users is shared. Apply with the Supabase
-- CLI (`supabase db push`) or paste into the SQL editor.
--
-- Remember to add `tracker` to API → Exposed schemas in Supabase dashboard.

create schema if not exists tracker;

-- ─── projects ───────────────────────────────────────────────────────────────
-- One project = one git repo URL. user_id is the owner; collaborators come
-- later via a project_members table.
create table if not exists tracker.projects (
    id                      uuid        primary key default gen_random_uuid(),
    user_id                 uuid        not null references auth.users(id) on delete cascade,
    name                    text        not null,
    repo_url                text        not null,
    repo_full_name          text,
    description             text,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    constraint projects_repo_url_per_user unique (user_id, repo_url),
    constraint projects_name_not_empty   check (length(trim(name)) > 0),
    constraint projects_repo_url_https   check (repo_url ~ '^https?://')
);

create index if not exists projects_user_idx on tracker.projects(user_id);

-- ─── issues ─────────────────────────────────────────────────────────────────
-- Smart-tracker core. `priority` is text (low|medium|high|urgent) so we can
-- sort lexicographically with no extra plumbing — DB is the source of truth.
create type tracker.issue_status   as enum ('open', 'in_progress', 'blocked', 'done', 'archived');
create type tracker.issue_priority as enum ('low', 'medium', 'high', 'urgent');

create table if not exists tracker.issues (
    id                      uuid        primary key default gen_random_uuid(),
    project_id              uuid        not null references tracker.projects(id) on delete cascade,
    user_id                 uuid        not null references auth.users(id),
    title                   text        not null,
    body                    text        default '',
    status                  tracker.issue_status   not null default 'open',
    priority                tracker.issue_priority not null default 'medium',
    labels                  text[]      not null default '{}',
    -- GitHub sync (Phase 3): null until a sync runs.
    github_issue_number     int,
    github_node_id          text,
    -- Sequential per-project number, populated by trigger so URLs read like #42.
    issue_number            int         not null,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    constraint issues_title_not_empty check (length(trim(title)) > 0),
    constraint issues_unique_number   unique (project_id, issue_number)
);

create index if not exists issues_project_idx        on tracker.issues(project_id);
create index if not exists issues_project_status_idx on tracker.issues(project_id, status);
create index if not exists issues_updated_idx        on tracker.issues(project_id, updated_at desc);

-- Auto-assign issue_number per project (atomic, gap-allowing).
create or replace function tracker.assign_issue_number()
returns trigger language plpgsql as $$
begin
    if new.issue_number is null or new.issue_number = 0 then
        select coalesce(max(issue_number), 0) + 1
        into   new.issue_number
        from   tracker.issues
        where  project_id = new.project_id;
    end if;
    return new;
end $$;

drop trigger if exists assign_issue_number on tracker.issues;
create trigger assign_issue_number
    before insert on tracker.issues
    for each row execute function tracker.assign_issue_number();

-- updated_at maintenance.
create or replace function tracker.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists touch_issues   on tracker.issues;
create trigger touch_issues   before update on tracker.issues   for each row execute function tracker.touch_updated_at();
drop trigger if exists touch_projects on tracker.projects;
create trigger touch_projects before update on tracker.projects for each row execute function tracker.touch_updated_at();

-- ─── project_analyser ──────────────────────────────────────────────────────
-- Per-project state of the bobby-analyser integration. graph_id is the
-- repo-id slug returned by the analyser; null until the first index finishes.
create type tracker.analyser_status as enum ('disabled', 'pending', 'indexing', 'ready', 'failed');

create table if not exists tracker.project_analyser (
    project_id              uuid        primary key references tracker.projects(id) on delete cascade,
    enabled                 boolean     not null default false,
    status                  tracker.analyser_status not null default 'disabled',
    graph_id                text,
    last_indexed_at         timestamptz,
    last_indexed_sha        text,
    last_index_cost_usd     numeric(10, 4),
    last_error              text,
    updated_at              timestamptz not null default now()
);

drop trigger if exists touch_project_analyser on tracker.project_analyser;
create trigger touch_project_analyser
    before update on tracker.project_analyser
    for each row execute function tracker.touch_updated_at();

-- ─── issue_suggestions ─────────────────────────────────────────────────────
-- Cached analyser /query response per issue. Rebuilt on demand or when the
-- graph re-indexes. code_cites is jsonb [{file, line}].
create table if not exists tracker.issue_suggestions (
    id                      uuid        primary key default gen_random_uuid(),
    issue_id                uuid        not null references tracker.issues(id) on delete cascade,
    markdown                text        not null,
    code_cites              jsonb       not null default '[]'::jsonb,
    graph_cites             text[]      not null default '{}',
    confidence              text,
    cost_usd                numeric(10, 4),
    duration_ms             int,
    graph_id                text,
    created_at              timestamptz not null default now()
);

create index if not exists suggestions_issue_idx on tracker.issue_suggestions(issue_id, created_at desc);

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Owner-only access. Phase 3 will add project_members for collab.
alter table tracker.projects          enable row level security;
alter table tracker.issues            enable row level security;
alter table tracker.project_analyser  enable row level security;
alter table tracker.issue_suggestions enable row level security;

-- projects
drop policy if exists projects_owner_select on tracker.projects;
create policy projects_owner_select on tracker.projects
    for select using (user_id = auth.uid());
drop policy if exists projects_owner_insert on tracker.projects;
create policy projects_owner_insert on tracker.projects
    for insert with check (user_id = auth.uid());
drop policy if exists projects_owner_update on tracker.projects;
create policy projects_owner_update on tracker.projects
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists projects_owner_delete on tracker.projects;
create policy projects_owner_delete on tracker.projects
    for delete using (user_id = auth.uid());

-- issues — gated through project ownership.
drop policy if exists issues_owner_all on tracker.issues;
create policy issues_owner_all on tracker.issues
    for all
    using      (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()))
    with check (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()));

-- project_analyser — same project-ownership gate.
drop policy if exists project_analyser_owner_all on tracker.project_analyser;
create policy project_analyser_owner_all on tracker.project_analyser
    for all
    using      (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()))
    with check (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()));

-- issue_suggestions — gated through issue → project.
drop policy if exists issue_suggestions_owner_all on tracker.issue_suggestions;
create policy issue_suggestions_owner_all on tracker.issue_suggestions
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

-- ─── grants for the API roles ───────────────────────────────────────────────
grant usage on schema tracker to anon, authenticated, service_role;
grant all   on all tables    in schema tracker to authenticated, service_role;
grant all   on all sequences in schema tracker to authenticated, service_role;
grant       execute  on all functions in schema tracker to authenticated, service_role;
