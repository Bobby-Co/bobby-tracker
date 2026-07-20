-- Collaboration foundation: teams, people-groups, team-owned resources.
--
-- Moves resource ownership from a single user to a TEAM. Every account gets a
-- personal team (backfilled below for existing users; created lazily for new
-- ones via tracker.ensure_personal_team). Resources (projects, public sessions,
-- project_groups a.k.a. "Collections") gain a team_id; all their child tables
-- keep deriving access through the project as before.
--
-- AUTHORISATION MODEL — HYBRID (see plan):
--   • RLS is a COARSE tenant-isolation backstop only: "you may touch a row iff
--     you are a member of the team that owns it" (tracker.is_team_member). This
--     makes a cross-TEAM data leak impossible-by-construction even if an app
--     handler is buggy.
--   • The RICH logic — admins-see-all vs members-see-only-their-groups'-projects,
--     role-gated mutations, member management, invites — lives in the app layer
--     (lib/auth/team-access.ts), NOT in these policies. A bug there can at worst
--     leak a SAME-team project to a SAME-team member, never across teams.
--   • Escalation-sensitive tables (team_members, access_group_*, team_invites)
--     additionally keep an is_team_admin DB backstop.
--
-- Recursion note: membership/role checks run through SECURITY DEFINER helpers
-- owned by the migration role (which bypasses RLS), so a policy that needs to
-- read team_members does NOT re-trigger team_members' own policy → no infinite
-- recursion. The only non-helper predicates in policies are flat same-row column
-- checks (user_id = auth.uid()).
--
-- Realtime note: only project_analyser, issue_suggestions and notifications are
-- realtime-published. notifications stays user-scoped (0049). The other two gain
-- a denormalised team_id and keep `user_id = auth.uid()` in their SELECT gate so
-- the owner's live updates never regress; the `or is_team_member(team_id)` arm
-- extends visibility to teammates (best-effort under realtime, reliable for
-- normal API reads).

-- ─── role enum ──────────────────────────────────────────────────────────────
do $$ begin
    if not exists (
        select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'team_role' and n.nspname = 'tracker'
    ) then
        create type tracker.team_role as enum ('owner', 'admin', 'member');
    end if;
end $$;

-- ─── teams ──────────────────────────────────────────────────────────────────
create table if not exists tracker.teams (
    id          uuid        primary key default gen_random_uuid(),
    name        text        not null,
    is_personal boolean     not null default false,
    -- Creator. SET NULL (not cascade): a team is now shared, so deleting the
    -- creator's (shared) auth.users row must NOT delete the team its members
    -- still depend on.
    created_by  uuid        references auth.users(id) on delete set null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    constraint teams_name_not_empty check (length(trim(name)) > 0),
    -- lets access_group_projects / access_group_members target (id, …) composite FKs
    constraint teams_id_uniq unique (id)
);
-- Exactly one personal team per user → makes ensure_personal_team idempotent and
-- is the arbiter for `on conflict (created_by) where is_personal`.
create unique index if not exists teams_one_personal_per_user
    on tracker.teams(created_by) where is_personal;

drop trigger if exists touch_teams on tracker.teams;
create trigger touch_teams before update on tracker.teams
    for each row execute function tracker.touch_updated_at();

-- ─── team_members ───────────────────────────────────────────────────────────
create table if not exists tracker.team_members (
    team_id    uuid              not null references tracker.teams(id) on delete cascade,
    user_id    uuid              not null references auth.users(id)    on delete cascade,
    role       tracker.team_role not null default 'member',
    created_at timestamptz       not null default now(),
    updated_at timestamptz       not null default now(),
    primary key (team_id, user_id)
);
create index if not exists team_members_user_idx on tracker.team_members(user_id);

drop trigger if exists touch_team_members on tracker.team_members;
create trigger touch_team_members before update on tracker.team_members
    for each row execute function tracker.touch_updated_at();

-- ─── access_groups (a group = a set of PEOPLE) ──────────────────────────────
-- Named access_groups to avoid colliding with the existing project_groups
-- ("Collections") — a group of PROJECTS for AI routing (migration 0019).
create table if not exists tracker.access_groups (
    id          uuid        primary key default gen_random_uuid(),
    team_id     uuid        not null references tracker.teams(id) on delete cascade,
    name        text        not null,
    description text,
    created_by  uuid        references auth.users(id) on delete set null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    constraint access_groups_name_not_empty check (length(trim(name)) > 0),
    -- composite-FK anchor so member/project junctions can prove same-team
    constraint access_groups_id_team_uniq unique (id, team_id)
);
create index if not exists access_groups_team_idx on tracker.access_groups(team_id);

drop trigger if exists touch_access_groups on tracker.access_groups;
create trigger touch_access_groups before update on tracker.access_groups
    for each row execute function tracker.touch_updated_at();

-- ─── access_group_members (person ↔ group) ──────────────────────────────────
-- Denormalised team_id + double composite FK declaratively enforces "the person
-- is a member of the group's team" without a trigger (there is no cron to repair
-- drift in this stack).
create table if not exists tracker.access_group_members (
    group_id   uuid        not null,
    team_id    uuid        not null,
    user_id    uuid        not null,
    created_at timestamptz not null default now(),
    primary key (group_id, user_id),
    foreign key (group_id, team_id) references tracker.access_groups(id, team_id)      on delete cascade,
    foreign key (team_id, user_id)  references tracker.team_members(team_id, user_id)  on delete cascade
);
create index if not exists access_group_members_user_idx  on tracker.access_group_members(user_id);
create index if not exists access_group_members_team_idx  on tracker.access_group_members(team_id, user_id);

-- projects gains team_id up-front (its full treatment — created_by relax, dup
-- guard — is in the attach/backfill sections below) so access_group_projects'
-- composite FK can target (id, team_id).
alter table tracker.projects add column if not exists team_id uuid references tracker.teams(id) on delete cascade;
create index if not exists projects_team_idx on tracker.projects(team_id);
-- add-if-absent (NOT drop-then-add): access_group_projects' composite FK depends
-- on this unique index, so dropping it on a re-run would fail.
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'projects_id_team_uniq' and conrelid = 'tracker.projects'::regclass) then
        alter table tracker.projects add constraint projects_id_team_uniq unique (id, team_id);
    end if;
end $$;

-- ─── access_group_projects (group ↔ project) ────────────────────────────────
-- Same double-FK trick guarantees the project belongs to the group's team.
create table if not exists tracker.access_group_projects (
    group_id   uuid        not null,
    team_id    uuid        not null,
    project_id uuid        not null,
    created_at timestamptz not null default now(),
    primary key (group_id, project_id),
    foreign key (group_id, team_id)   references tracker.access_groups(id, team_id) on delete cascade,
    -- column order matters: (project_id, team_id) → projects(id, team_id)
    foreign key (project_id, team_id) references tracker.projects(id, team_id)      on delete cascade
);
create index if not exists access_group_projects_project_idx on tracker.access_group_projects(project_id);
create index if not exists access_group_projects_team_idx    on tracker.access_group_projects(team_id);

-- ─── team_invites (pending email invitations) ───────────────────────────────
create table if not exists tracker.team_invites (
    id          uuid              primary key default gen_random_uuid(),
    team_id     uuid              not null references tracker.teams(id) on delete cascade,
    email       text              not null,
    role        tracker.team_role not null default 'member',
    token       text              not null unique,
    invited_by  uuid              references auth.users(id) on delete set null,
    created_at  timestamptz       not null default now(),
    accepted_at timestamptz,
    expires_at  timestamptz,
    constraint team_invites_email_not_empty check (length(trim(email)) > 0),
    constraint team_invites_token_len       check (length(token) >= 16)
);
create index if not exists team_invites_team_idx on tracker.team_invites(team_id);
-- one live (unaccepted) invite per email per team; case-insensitive
create unique index if not exists team_invites_one_pending
    on tracker.team_invites(team_id, lower(email)) where accepted_at is null;

-- ════════════════════════════════════════════════════════════════════════════
--  Attach team_id to the three ownership anchors. Children derive via project.
-- ════════════════════════════════════════════════════════════════════════════
-- projects.team_id + its unique(id, team_id) were added up-front (above).
alter table tracker.public_sessions add column if not exists team_id uuid references tracker.teams(id) on delete cascade;
alter table tracker.project_groups  add column if not exists team_id uuid references tracker.teams(id) on delete cascade;

create index if not exists public_sessions_team_idx on tracker.public_sessions(team_id);
create index if not exists project_groups_team_idx  on tracker.project_groups(team_id);

-- Denormalised team_id on the two realtime-published child tables (see header).
alter table tracker.project_analyser  add column if not exists team_id uuid references tracker.teams(id) on delete cascade;
alter table tracker.issue_suggestions add column if not exists team_id uuid references tracker.teams(id) on delete cascade;

-- user_id becomes "created_by": relax its FK from CASCADE to SET NULL and make it
-- nullable, so deleting a creator (possibly by the sibling service on the shared
-- auth.users) can't delete team resources. Drop any existing user_id FK by
-- discovering its (auto-generated) name, then re-add. Robust to auto-generated
-- constraint names.
do $$
declare v_name text;
begin
    for v_name in
        select con.conname
        from pg_constraint con
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
        where con.conrelid = 'tracker.projects'::regclass and con.contype = 'f' and a.attname = 'user_id'
    loop execute format('alter table tracker.projects drop constraint %I', v_name); end loop;

    for v_name in
        select con.conname
        from pg_constraint con
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
        where con.conrelid = 'tracker.public_sessions'::regclass and con.contype = 'f' and a.attname = 'user_id'
    loop execute format('alter table tracker.public_sessions drop constraint %I', v_name); end loop;

    for v_name in
        select con.conname
        from pg_constraint con
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
        where con.conrelid = 'tracker.project_groups'::regclass and con.contype = 'f' and a.attname = 'user_id'
    loop execute format('alter table tracker.project_groups drop constraint %I', v_name); end loop;
end $$;

alter table tracker.projects        alter column user_id drop not null;
alter table tracker.public_sessions alter column user_id drop not null;
alter table tracker.project_groups  alter column user_id drop not null;

alter table tracker.projects        add constraint projects_created_by_fk        foreign key (user_id) references auth.users(id) on delete set null;
alter table tracker.public_sessions add constraint public_sessions_created_by_fk foreign key (user_id) references auth.users(id) on delete set null;
alter table tracker.project_groups  add constraint project_groups_created_by_fk  foreign key (user_id) references auth.users(id) on delete set null;

-- A repo now belongs to a TEAM, not a person: drop the per-user dup-guard. The
-- team-scoped replacement is added after backfill (once every project has a team).
alter table tracker.projects drop constraint if exists projects_repo_url_per_user;

-- ════════════════════════════════════════════════════════════════════════════
--  RLS helper functions (SECURITY DEFINER → bypass RLS internally → no recursion)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function tracker.is_team_member(p_team uuid)
returns boolean language sql stable security definer set search_path = tracker, pg_temp as $$
    select exists (select 1 from tracker.team_members m
                   where m.team_id = p_team and m.user_id = auth.uid());
$$;

create or replace function tracker.is_team_admin(p_team uuid)
returns boolean language sql stable security definer set search_path = tracker, pg_temp as $$
    select exists (select 1 from tracker.team_members m
                   where m.team_id = p_team and m.user_id = auth.uid()
                     and m.role in ('owner', 'admin'));
$$;

create or replace function tracker.team_role(p_team uuid)
returns tracker.team_role language sql stable security definer set search_path = tracker, pg_temp as $$
    select m.role from tracker.team_members m
     where m.team_id = p_team and m.user_id = auth.uid();
$$;

create or replace function tracker.member_of_project_team(p_project uuid)
returns boolean language sql stable security definer set search_path = tracker, pg_temp as $$
    select tracker.is_team_member((select team_id from tracker.projects where id = p_project));
$$;

create or replace function tracker.member_of_issue_team(p_issue uuid)
returns boolean language sql stable security definer set search_path = tracker, pg_temp as $$
    select tracker.member_of_project_team((select project_id from tracker.issues where id = p_issue));
$$;

create or replace function tracker.member_of_session_team(p_session uuid)
returns boolean language sql stable security definer set search_path = tracker, pg_temp as $$
    select tracker.is_team_member((select team_id from tracker.public_sessions where id = p_session));
$$;

create or replace function tracker.member_of_group_team(p_group uuid)
returns boolean language sql stable security definer set search_path = tracker, pg_temp as $$
    select tracker.is_team_member((select team_id from tracker.project_groups where id = p_group));
$$;

create or replace function tracker.is_group_admin(p_group uuid)
returns boolean language sql stable security definer set search_path = tracker, pg_temp as $$
    select tracker.is_team_admin((select team_id from tracker.access_groups where id = p_group));
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  Bootstrap functions (no auth.users trigger allowed — auth.users is shared)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function tracker.ensure_personal_team(p_user uuid, p_name text default null)
returns uuid language plpgsql security definer set search_path = tracker, pg_temp as $$
declare v_team uuid;
begin
    -- A caller may only bootstrap THEIR OWN team; service-role (auth.uid() null)
    -- is trusted and may bootstrap for anyone.
    if auth.uid() is not null and auth.uid() <> p_user then
        raise exception 'cannot create a personal team for another user' using errcode = '42501';
    end if;

    select id into v_team from tracker.teams where is_personal and created_by = p_user;
    if v_team is not null then return v_team; end if;

    insert into tracker.teams (name, is_personal, created_by)
    values (coalesce(nullif(trim(p_name), ''), 'Personal Team'), true, p_user)
    on conflict (created_by) where is_personal do nothing
    returning id into v_team;

    if v_team is null then  -- lost a race: another call just created it
        select id into v_team from tracker.teams where is_personal and created_by = p_user;
    end if;

    insert into tracker.team_members (team_id, user_id, role)
    values (v_team, p_user, 'owner')
    on conflict (team_id, user_id) do nothing;

    return v_team;
end $$;

-- Atomic team + owner-membership creation (sidesteps the chicken-and-egg where
-- you can't insert your own first membership row under the admin-gated policy).
create or replace function tracker.create_team(p_name text)
returns uuid language plpgsql security definer set search_path = tracker, pg_temp as $$
declare v_team uuid;
begin
    if auth.uid() is null then raise exception 'auth required' using errcode = '42501'; end if;
    if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'name required' using errcode = '22000'; end if;
    insert into tracker.teams (name, is_personal, created_by) values (trim(p_name), false, auth.uid())
        returning id into v_team;
    insert into tracker.team_members (team_id, user_id, role) values (v_team, auth.uid(), 'owner');
    return v_team;
end $$;

-- Protect the last owner: a team must always have ≥1 owner (no cron to repair).
create or replace function tracker.protect_last_owner()
returns trigger language plpgsql security definer set search_path = tracker, pg_temp as $$
declare v_team uuid; v_others int;
begin
    if tg_op = 'DELETE' then
        if old.role <> 'owner' then return old; end if;
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

drop trigger if exists protect_last_owner on tracker.team_members;
create trigger protect_last_owner
    before update or delete on tracker.team_members
    for each row execute function tracker.protect_last_owner();

-- Keep the realtime child tables' denormalised columns populated. Extends the
-- existing user_id fill triggers (0005) to also fill team_id from the project.
create or replace function tracker.fill_project_analyser_user_id()
returns trigger language plpgsql security definer set search_path = tracker, pg_temp as $$
begin
    if new.user_id is null then
        select p.user_id into new.user_id from tracker.projects p where p.id = new.project_id;
    end if;
    if new.team_id is null then
        select p.team_id into new.team_id from tracker.projects p where p.id = new.project_id;
    end if;
    return new;
end $$;

create or replace function tracker.fill_issue_suggestion_user_id()
returns trigger language plpgsql security definer set search_path = tracker, pg_temp as $$
begin
    if new.user_id is null then
        select p.user_id into new.user_id
        from tracker.issues i join tracker.projects p on p.id = i.project_id
        where i.id = new.issue_id;
    end if;
    if new.team_id is null then
        select p.team_id into new.team_id
        from tracker.issues i join tracker.projects p on p.id = i.project_id
        where i.id = new.issue_id;
    end if;
    return new;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  BACKFILL (idempotent; anchor columns were added NULLABLE above)
-- ════════════════════════════════════════════════════════════════════════════
-- One personal team per distinct owner of a team-ownable resource. Name it
-- "<Display>'s Personal Team" from auth metadata when available.
insert into tracker.teams (name, is_personal, created_by)
select coalesce(
           nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
           split_part(u.email, '@', 1),
           'My'
       ) || '''s Personal Team',
       true, o.user_id
from (
    select user_id from tracker.projects        where user_id is not null
    union select user_id from tracker.public_sessions where user_id is not null
    union select user_id from tracker.project_groups   where user_id is not null
) o
join auth.users u on u.id = o.user_id
on conflict (created_by) where is_personal do nothing;

-- Owner membership for every personal team.
insert into tracker.team_members (team_id, user_id, role)
select t.id, t.created_by, 'owner'
from tracker.teams t
where t.is_personal and t.created_by is not null
on conflict (team_id, user_id) do nothing;

-- Stamp team_id on the anchors from each row's creator's personal team.
update tracker.projects p set team_id = t.id
    from tracker.teams t
    where t.is_personal and t.created_by = p.user_id and p.team_id is null;
update tracker.public_sessions s set team_id = t.id
    from tracker.teams t
    where t.is_personal and t.created_by = s.user_id and s.team_id is null;
update tracker.project_groups g set team_id = t.id
    from tracker.teams t
    where t.is_personal and t.created_by = g.user_id and g.team_id is null;

-- Backfill the realtime child tables' denormalised team_id.
update tracker.project_analyser pa set team_id = p.team_id
    from tracker.projects p where pa.project_id = p.id and pa.team_id is null;
update tracker.issue_suggestions su set team_id = p.team_id
    from tracker.issues i join tracker.projects p on p.id = i.project_id
    where su.issue_id = i.id and su.team_id is null;

-- Lock the anchors down. If any anchor row still has a NULL team_id this fails
-- loudly (correct: it means a resource had no resolvable owner) — investigate
-- rather than force it.
alter table tracker.projects        alter column team_id set not null;
alter table tracker.public_sessions alter column team_id set not null;
alter table tracker.project_groups  alter column team_id set not null;

-- Now that every project has a team, enforce the team-scoped repo dup-guard.
-- add-if-absent so a re-run after a partial apply doesn't hit "already exists".
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'projects_repo_url_per_team' and conrelid = 'tracker.projects'::regclass) then
        alter table tracker.projects add constraint projects_repo_url_per_team unique (team_id, repo_url);
    end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  RLS — new tables
-- ════════════════════════════════════════════════════════════════════════════
alter table tracker.teams                 enable row level security;
alter table tracker.team_members          enable row level security;
alter table tracker.access_groups         enable row level security;
alter table tracker.access_group_members  enable row level security;
alter table tracker.access_group_projects enable row level security;
alter table tracker.team_invites          enable row level security;

-- teams: members read; admins rename; owner deletes (never a personal team).
-- No INSERT policy — creation is bootstrap-only via the SECURITY DEFINER funcs.
drop policy if exists teams_member_select on tracker.teams;
create policy teams_member_select on tracker.teams
    for select using (tracker.is_team_member(id));
drop policy if exists teams_admin_update on tracker.teams;
create policy teams_admin_update on tracker.teams
    for update using (tracker.is_team_admin(id)) with check (tracker.is_team_admin(id));
drop policy if exists teams_owner_delete on tracker.teams;
create policy teams_owner_delete on tracker.teams
    for delete using (tracker.team_role(id) = 'owner' and not is_personal);

-- team_members: self-select is a flat column check (no recursion); seeing other
-- members + all writes route through the definer helpers. Direct writes are
-- admin-gated (the app still funnels through role guards; this is the backstop).
drop policy if exists team_members_select on tracker.team_members;
create policy team_members_select on tracker.team_members
    for select using (user_id = auth.uid() or tracker.is_team_member(team_id));
drop policy if exists team_members_admin_write on tracker.team_members;
create policy team_members_admin_write on tracker.team_members
    for all using (tracker.is_team_admin(team_id)) with check (tracker.is_team_admin(team_id));

-- access_groups: members read; admins manage.
drop policy if exists access_groups_member_select on tracker.access_groups;
create policy access_groups_member_select on tracker.access_groups
    for select using (tracker.is_team_member(team_id));
drop policy if exists access_groups_admin_write on tracker.access_groups;
create policy access_groups_admin_write on tracker.access_groups
    for all using (tracker.is_team_admin(team_id)) with check (tracker.is_team_admin(team_id));

-- access_group_members: you see your own membership; admins see/manage all.
drop policy if exists agm_select on tracker.access_group_members;
create policy agm_select on tracker.access_group_members
    for select using (user_id = auth.uid() or tracker.is_group_admin(group_id));
drop policy if exists agm_admin_write on tracker.access_group_members;
create policy agm_admin_write on tracker.access_group_members
    for all using (tracker.is_group_admin(group_id)) with check (tracker.is_group_admin(group_id));

-- access_group_projects: team members may read which projects a group covers;
-- admins manage the grants.
drop policy if exists agp_member_select on tracker.access_group_projects;
create policy agp_member_select on tracker.access_group_projects
    for select using (tracker.is_team_member(team_id));
drop policy if exists agp_admin_write on tracker.access_group_projects;
create policy agp_admin_write on tracker.access_group_projects
    for all using (tracker.is_group_admin(group_id)) with check (tracker.is_group_admin(group_id));

-- team_invites: admins manage. (Invitee lookup by token is server-side via the
-- service-role client, which bypasses RLS.)
drop policy if exists team_invites_admin_all on tracker.team_invites;
create policy team_invites_admin_all on tracker.team_invites
    for all using (tracker.is_team_admin(team_id)) with check (tracker.is_team_admin(team_id));

-- ════════════════════════════════════════════════════════════════════════════
--  RLS — swap existing owner policies to the coarse team gate
-- ════════════════════════════════════════════════════════════════════════════
-- Every swap is wrapped in `if to_regclass('tracker.X') is not null` so a table
-- that this (drifted) DB never got — e.g. pr_review_index, if migration 0045 was
-- never applied here — is SKIPPED instead of aborting the whole migration. Each
-- also drops the NEW policy name before creating it, so this section is safe to
-- re-run after a partial apply. PL/pgSQL runs the DDL directly (no EXECUTE).
do $$
begin
    -- ── anchors: for-all on team membership ─────────────────────────────────
    if to_regclass('tracker.projects') is not null then
        drop policy if exists projects_owner_select on tracker.projects;
        drop policy if exists projects_owner_insert on tracker.projects;
        drop policy if exists projects_owner_update on tracker.projects;
        drop policy if exists projects_owner_delete on tracker.projects;
        drop policy if exists projects_team_all     on tracker.projects;
        create policy projects_team_all on tracker.projects
            for all using (tracker.is_team_member(team_id)) with check (tracker.is_team_member(team_id));
    end if;

    if to_regclass('tracker.public_sessions') is not null then
        drop policy if exists public_sessions_owner_all on tracker.public_sessions;
        drop policy if exists public_sessions_team_all  on tracker.public_sessions;
        create policy public_sessions_team_all on tracker.public_sessions
            for all using (tracker.is_team_member(team_id)) with check (tracker.is_team_member(team_id));
    end if;

    if to_regclass('tracker.project_groups') is not null then
        drop policy if exists project_groups_owner_all on tracker.project_groups;
        drop policy if exists project_groups_team_all  on tracker.project_groups;
        create policy project_groups_team_all on tracker.project_groups
            for all using (tracker.is_team_member(team_id)) with check (tracker.is_team_member(team_id));
    end if;

    -- ── realtime children: keep the owner's single-column arm ───────────────
    if to_regclass('tracker.project_analyser') is not null then
        drop policy if exists project_analyser_owner_all on tracker.project_analyser;
        drop policy if exists project_analyser_team_all  on tracker.project_analyser;
        create policy project_analyser_team_all on tracker.project_analyser
            for all using (user_id = auth.uid() or tracker.is_team_member(team_id))
                with check (tracker.is_team_member(team_id) or user_id = auth.uid());
    end if;

    if to_regclass('tracker.issue_suggestions') is not null then
        drop policy if exists issue_suggestions_owner_all on tracker.issue_suggestions;
        drop policy if exists issue_suggestions_team_all  on tracker.issue_suggestions;
        create policy issue_suggestions_team_all on tracker.issue_suggestions
            for all using (user_id = auth.uid() or tracker.is_team_member(team_id))
                with check (tracker.is_team_member(team_id) or user_id = auth.uid());
    end if;

    -- ── project-gated children (via project_id) ─────────────────────────────
    if to_regclass('tracker.issues') is not null then
        drop policy if exists issues_owner_all on tracker.issues;
        drop policy if exists issues_team_all  on tracker.issues;
        create policy issues_team_all on tracker.issues
            for all using (tracker.member_of_project_team(project_id))
                with check (tracker.member_of_project_team(project_id));
    end if;

    if to_regclass('tracker.project_status_colors') is not null then
        drop policy if exists project_status_colors_owner_all on tracker.project_status_colors;
        drop policy if exists project_status_colors_team_all  on tracker.project_status_colors;
        create policy project_status_colors_team_all on tracker.project_status_colors
            for all using (tracker.member_of_project_team(project_id))
                with check (tracker.member_of_project_team(project_id));
    end if;

    if to_regclass('tracker.project_label_icons') is not null then
        drop policy if exists project_label_icons_owner_all on tracker.project_label_icons;
        drop policy if exists project_label_icons_team_all  on tracker.project_label_icons;
        create policy project_label_icons_team_all on tracker.project_label_icons
            for all using (tracker.member_of_project_team(project_id))
                with check (tracker.member_of_project_team(project_id));
    end if;

    if to_regclass('tracker.project_public_integration') is not null then
        drop policy if exists project_public_integration_owner_all on tracker.project_public_integration;
        drop policy if exists project_public_integration_team_all  on tracker.project_public_integration;
        create policy project_public_integration_team_all on tracker.project_public_integration
            for all using (tracker.member_of_project_team(project_id))
                with check (tracker.member_of_project_team(project_id));
    end if;

    if to_regclass('tracker.pull_requests') is not null then
        drop policy if exists pull_requests_owner_select on tracker.pull_requests;
        drop policy if exists pull_requests_team_select  on tracker.pull_requests;
        create policy pull_requests_team_select on tracker.pull_requests
            for select using (tracker.member_of_project_team(project_id));
    end if;

    if to_regclass('tracker.pr_comments') is not null then
        drop policy if exists pr_comments_owner_select on tracker.pr_comments;
        drop policy if exists pr_comments_team_select  on tracker.pr_comments;
        create policy pr_comments_team_select on tracker.pr_comments
            for select using (tracker.member_of_project_team(project_id));
    end if;

    if to_regclass('tracker.issue_comments') is not null then
        drop policy if exists issue_comments_owner_select on tracker.issue_comments;
        drop policy if exists issue_comments_team_select  on tracker.issue_comments;
        create policy issue_comments_team_select on tracker.issue_comments
            for select using (tracker.member_of_project_team(project_id));
    end if;

    if to_regclass('tracker.pull_request_analyses') is not null then
        drop policy if exists pull_request_analyses_owner_select on tracker.pull_request_analyses;
        drop policy if exists pull_request_analyses_team_select  on tracker.pull_request_analyses;
        create policy pull_request_analyses_team_select on tracker.pull_request_analyses
            for select using (tracker.member_of_project_team(project_id));
    end if;

    -- pr_review_index has no project_id — it keys on repo_id (= project_analyser.graph_id).
    -- Often absent (migration 0045) — the guard makes that a no-op.
    if to_regclass('tracker.pr_review_index') is not null then
        drop policy if exists pr_review_index_owner_select on tracker.pr_review_index;
        drop policy if exists pr_review_index_team_select  on tracker.pr_review_index;
        create policy pr_review_index_team_select on tracker.pr_review_index
            for select using (
                exists (
                    select 1 from tracker.project_analyser pa
                    join tracker.projects p on p.id = pa.project_id
                    where pa.graph_id = pr_review_index.repo_id and tracker.is_team_member(p.team_id)
                )
            );
    end if;

    if to_regclass('tracker.project_insight') is not null then
        drop policy if exists project_insight_owner_select on tracker.project_insight;
        drop policy if exists project_insight_team_select  on tracker.project_insight;
        create policy project_insight_team_select on tracker.project_insight
            for select using (tracker.member_of_project_team(project_id));
    end if;

    if to_regclass('tracker.project_layer_tags') is not null then
        drop policy if exists project_layer_tags_owner_read on tracker.project_layer_tags;
        drop policy if exists project_layer_tags_team_read  on tracker.project_layer_tags;
        create policy project_layer_tags_team_read on tracker.project_layer_tags
            for select to authenticated using (tracker.member_of_project_team(project_id));
    end if;

    if to_regclass('tracker.project_feature_tags') is not null then
        drop policy if exists project_feature_tags_owner_read on tracker.project_feature_tags;
        drop policy if exists project_feature_tags_team_read  on tracker.project_feature_tags;
        create policy project_feature_tags_team_read on tracker.project_feature_tags
            for select to authenticated using (tracker.member_of_project_team(project_id));
    end if;

    -- ── children reached through issue_id ───────────────────────────────────
    if to_regclass('tracker.public_issue_reporters') is not null then
        drop policy if exists public_issue_reporters_owner_all on tracker.public_issue_reporters;
        drop policy if exists public_issue_reporters_team_all  on tracker.public_issue_reporters;
        create policy public_issue_reporters_team_all on tracker.public_issue_reporters
            for all using (tracker.member_of_issue_team(issue_id))
                with check (tracker.member_of_issue_team(issue_id));
    end if;

    if to_regclass('tracker.issue_embeddings') is not null then
        drop policy if exists issue_embeddings_owner_all on tracker.issue_embeddings;
        drop policy if exists issue_embeddings_team_all  on tracker.issue_embeddings;
        create policy issue_embeddings_team_all on tracker.issue_embeddings
            for all using (tracker.member_of_issue_team(issue_id))
                with check (tracker.member_of_issue_team(issue_id));
    end if;

    -- ── session / collection junctions ──────────────────────────────────────
    if to_regclass('tracker.public_session_projects') is not null then
        drop policy if exists public_session_projects_owner_all on tracker.public_session_projects;
        drop policy if exists public_session_projects_team_all  on tracker.public_session_projects;
        create policy public_session_projects_team_all on tracker.public_session_projects
            for all using (tracker.member_of_session_team(session_id))
                with check (tracker.member_of_session_team(session_id) and tracker.member_of_project_team(project_id));
    end if;

    if to_regclass('tracker.public_session_invites') is not null then
        drop policy if exists public_session_invites_owner_all on tracker.public_session_invites;
        drop policy if exists public_session_invites_team_all  on tracker.public_session_invites;
        create policy public_session_invites_team_all on tracker.public_session_invites
            for all using (tracker.member_of_session_team(session_id))
                with check (tracker.member_of_session_team(session_id));
    end if;

    if to_regclass('tracker.project_group_members') is not null then
        drop policy if exists project_group_members_owner_all on tracker.project_group_members;
        drop policy if exists project_group_members_team_all  on tracker.project_group_members;
        create policy project_group_members_team_all on tracker.project_group_members
            for all using (tracker.member_of_group_team(group_id))
                with check (tracker.member_of_group_team(group_id) and tracker.member_of_project_team(project_id));
    end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  Grants (0001's blanket grant predates these tables/functions)
-- ════════════════════════════════════════════════════════════════════════════
grant all on tracker.teams                 to authenticated, service_role;
grant all on tracker.team_members          to authenticated, service_role;
grant all on tracker.access_groups         to authenticated, service_role;
grant all on tracker.access_group_members  to authenticated, service_role;
grant all on tracker.access_group_projects to authenticated, service_role;
grant all on tracker.team_invites          to authenticated, service_role;

revoke execute on function
    tracker.is_team_member(uuid), tracker.is_team_admin(uuid), tracker.team_role(uuid),
    tracker.member_of_project_team(uuid), tracker.member_of_issue_team(uuid),
    tracker.member_of_session_team(uuid), tracker.member_of_group_team(uuid),
    tracker.is_group_admin(uuid),
    tracker.ensure_personal_team(uuid, text), tracker.create_team(text)
    from public, anon;
grant execute on function
    tracker.is_team_member(uuid), tracker.is_team_admin(uuid), tracker.team_role(uuid),
    tracker.member_of_project_team(uuid), tracker.member_of_issue_team(uuid),
    tracker.member_of_session_team(uuid), tracker.member_of_group_team(uuid),
    tracker.is_group_admin(uuid),
    tracker.ensure_personal_team(uuid, text), tracker.create_team(text)
    to authenticated, service_role;
