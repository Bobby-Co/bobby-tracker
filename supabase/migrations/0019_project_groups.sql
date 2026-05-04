-- Project groups: a user-defined collection of related projects so
-- the AI compose flow can route an inbound issue to the right
-- project (or fan it across several) inside a multi-repo product.
--
-- Routing reads the four facet embeddings populated by the
-- summariser on each project_analyser row (migration 0018) and
-- returns a weighted similarity score per project — see
-- find_similar_projects.

create table if not exists tracker.project_groups (
    id          uuid        primary key default gen_random_uuid(),
    user_id     uuid        not null references auth.users(id) on delete cascade,
    name        text        not null,
    description text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    constraint project_groups_name_not_empty check (length(trim(name)) > 0)
);

create index if not exists project_groups_user_idx on tracker.project_groups(user_id);

drop trigger if exists touch_project_groups on tracker.project_groups;
create trigger touch_project_groups
    before update on tracker.project_groups
    for each row execute function tracker.touch_updated_at();

alter table tracker.project_groups enable row level security;

drop policy if exists project_groups_owner_all on tracker.project_groups;
create policy project_groups_owner_all on tracker.project_groups
    for all
    using      (user_id = auth.uid())
    with check (user_id = auth.uid());

grant all on tracker.project_groups to authenticated, service_role;

-- Many-to-many membership. The same project can sit in multiple
-- groups (e.g. "Bobby suite" and "Indexing infra" might both
-- include bobby-analyser).
create table if not exists tracker.project_group_members (
    group_id   uuid not null references tracker.project_groups(id) on delete cascade,
    project_id uuid not null references tracker.projects(id)        on delete cascade,
    created_at timestamptz not null default now(),
    primary key (group_id, project_id)
);

create index if not exists project_group_members_project_idx
    on tracker.project_group_members(project_id);

alter table tracker.project_group_members enable row level security;

-- Membership rows are gated through the group: only the group's
-- owner can read or mutate, and the linked project must also belong
-- to them so a group can't pull in someone else's repo.
drop policy if exists project_group_members_owner_all on tracker.project_group_members;
create policy project_group_members_owner_all on tracker.project_group_members
    for all
    using      (exists (
        select 1 from tracker.project_groups g
        where g.id = group_id and g.user_id = auth.uid()
    ))
    with check (exists (
        select 1 from tracker.project_groups g
            join tracker.projects p on p.id = project_id
        where g.id = group_id and g.user_id = auth.uid() and p.user_id = auth.uid()
    ));

grant all on tracker.project_group_members to authenticated, service_role;
