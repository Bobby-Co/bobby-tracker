-- asia-full-schema.sql — the ENTIRE tracker migration chain, concatenated in
-- order, for bootstrapping a NEW Supabase project as a regional data plane.
--
-- GENERATED FILE — do not edit. Regenerate with:
--   scripts/migration-replay/generate-asia-schema.sh
--
-- HOW TO USE: paste into the new project's SQL Editor and run once. It is the
-- same chain applied to the primary, so the regional database starts
-- structurally identical. Run regional-node-setup.sql afterwards — that is the
-- one that severs the constraints which cannot span two databases.
--
-- WHY THE FULL CHAIN, including control-plane tables the region will never use:
-- one migration chain is worth far more than a lean schema. Two chains means
-- every future migration needs a judgement call about where it belongs, and the
-- replay harness could only verify one of them. The unused tables cost nothing
-- but disk.
--
-- PLACEMENT IS PER TEAM (0064). A team lives in exactly one cell and everything
-- it owns is served from there, so a request resolves its region once — from the
-- team it already loaded out of the control plane — and never has to read
-- regional data to find out where regional data lives.
--
-- A useful side effect: because `team_members` is EMPTY in a regional database,
-- every inherited RLS policy there already evaluates to false — is_team_member()
-- can never find a row. The regional data plane is deny-all to
-- `authenticated`/`anon` and reachable only by service_role, which bypasses RLS.
-- Exactly the posture we want, with no extra policy migration.


-- ═══ MIGRATION: 0001_tracker_schema.sql ═══

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


-- ═══ MIGRATION: 0002_issue_suggestion_data.sql ═══

-- Add a structured `data` column to tracker.issue_suggestions so the
-- tracker can persist the new /issues/analyse JSON output verbatim
-- (summary, suggestions[], investigation_plan, confidence). The legacy
-- markdown / code_cites / graph_cites columns stay populated for
-- backward compatibility with rows produced by the old /query path.

alter table tracker.issue_suggestions
    add column if not exists data jsonb;

comment on column tracker.issue_suggestions.data is
    'Structured /issues/analyse response: {summary, suggestions[], investigation_plan, confidence, …}. Null for legacy rows.';


-- ═══ MIGRATION: 0003_realtime.sql ═══

-- Enable Supabase Realtime for the tables the tracker subscribes to live:
--   - tracker.project_analyser  → analyser-panel reacts to status flips
--                                   (indexing → ready / failed) without
--                                   the user refreshing.
--   - tracker.issue_suggestions → suggestions panel picks up new rows
--                                   inserted by /api/issues/[id]/suggest
--                                   even if the request happened in
--                                   another tab.
--
-- RLS still applies to realtime — clients only receive rows they're
-- allowed to read by the existing policies. No data leaks.

alter publication supabase_realtime add table tracker.project_analyser;
alter publication supabase_realtime add table tracker.issue_suggestions;


-- ═══ MIGRATION: 0004_analyser_progress.sql ═══

-- Live progress snapshot for an in-flight analyser indexing job. The
-- tracker route writes here ~once per second while a job runs; the
-- AnalyserPanel reads it (via the realtime subscription added in 0003)
-- and renders the progress bar.
--
-- Persisting progress in the DB means a client doesn't need to keep
-- the indexing HTTP stream open to see progress — refresh, switch
-- tabs, or join from another device and the latest snapshot is right
-- there. The stream-died-but-server-still-working case (caddy idle
-- timeout, fetch interruption, etc.) becomes a non-issue.
--
-- Schema is forward-compatible: clients tolerate missing keys, so we
-- can add fields later without a migration.

alter table tracker.project_analyser
    add column if not exists progress jsonb default '{}'::jsonb;

comment on column tracker.project_analyser.progress is
    'Live progress snapshot during status=indexing: {phase, slug, step_idx, step_total, cost_usd, started_at, message}. Stale once status flips to ready/failed.';


-- ═══ MIGRATION: 0005_realtime_rls_userid.sql ═══

-- Denormalise user_id onto realtime-published tables so RLS evaluation
-- doesn't have to JOIN out to tracker.projects. Supabase Realtime can
-- evaluate single-table policies directly from WAL records, but a
-- cross-table EXISTS check is silently dropped in many setups, so
-- subscribers never receive UPDATE events even though the row updated
-- on disk.
--
-- After this migration the policies on project_analyser and
-- issue_suggestions become `user_id = auth.uid()` — Realtime-friendly,
-- equivalent semantically (since user_id is auto-populated from the
-- parent project on insert and never changes).

-- ─── project_analyser ──────────────────────────────────────────────────────

alter table tracker.project_analyser
    add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Backfill from the parent project for any existing rows.
update tracker.project_analyser pa
set user_id = p.user_id
from tracker.projects p
where pa.project_id = p.id
  and pa.user_id is null;

-- Auto-populate on insert so the tracker route doesn't have to know
-- about it. Triggered BEFORE INSERT, only when caller didn't supply it.
create or replace function tracker.fill_project_analyser_user_id()
returns trigger language plpgsql security definer as $$
begin
    if new.user_id is null then
        select user_id into new.user_id from tracker.projects where id = new.project_id;
    end if;
    return new;
end $$;

drop trigger if exists fill_user_id on tracker.project_analyser;
create trigger fill_user_id
    before insert on tracker.project_analyser
    for each row execute function tracker.fill_project_analyser_user_id();

-- Simplify the policy. The cross-table version is dropped; replaced
-- with a single-column check Realtime can evaluate.
drop policy if exists project_analyser_owner_all on tracker.project_analyser;
create policy project_analyser_owner_all on tracker.project_analyser
    for all
    using      (user_id = auth.uid())
    with check (user_id = auth.uid());

alter table tracker.project_analyser
    alter column user_id set not null;

-- ─── issue_suggestions ─────────────────────────────────────────────────────

alter table tracker.issue_suggestions
    add column if not exists user_id uuid references auth.users(id) on delete cascade;

update tracker.issue_suggestions s
set user_id = p.user_id
from tracker.issues i
join tracker.projects p on p.id = i.project_id
where s.issue_id = i.id
  and s.user_id is null;

create or replace function tracker.fill_issue_suggestion_user_id()
returns trigger language plpgsql security definer as $$
begin
    if new.user_id is null then
        select p.user_id
        into new.user_id
        from tracker.issues i
        join tracker.projects p on p.id = i.project_id
        where i.id = new.issue_id;
    end if;
    return new;
end $$;

drop trigger if exists fill_user_id on tracker.issue_suggestions;
create trigger fill_user_id
    before insert on tracker.issue_suggestions
    for each row execute function tracker.fill_issue_suggestion_user_id();

drop policy if exists issue_suggestions_owner_all on tracker.issue_suggestions;
create policy issue_suggestions_owner_all on tracker.issue_suggestions
    for all
    using      (user_id = auth.uid())
    with check (user_id = auth.uid());

alter table tracker.issue_suggestions
    alter column user_id set not null;


-- ═══ MIGRATION: 0006_health_report.sql ═══

-- Persisted "graph health" report. Every verify run — manual UI
-- button, post-update QC pass, post-bootstrap QC pass — writes here
-- so the tracker UI always renders the latest report on load (no
-- "click verify to see results" empty state) and so realtime
-- subscribers see updates as soon as a server-side run finishes.
--
-- Schema mirrors internal/verify.Report on the analyser side. Stored
-- as jsonb so we can extend without a migration; the tracker reads
-- with a TypeScript interface (lib/analyser.ts:VerifyReport) and
-- tolerates missing keys.
--
-- last_health_check_at separates "have we ever run verify" from
-- "is the report current" — the column is null until the first
-- successful verify completes.

alter table tracker.project_analyser
    add column if not exists last_health_report   jsonb,
    add column if not exists last_health_check_at timestamptz;

comment on column tracker.project_analyser.last_health_report is
    'Latest verify.Report for this graph (citation hit rate, drift, coverage, content-stale, broken cites). Updated on every verify run — manual UI button, post-update QC, post-bootstrap QC. Null until first verify.';

comment on column tracker.project_analyser.last_health_check_at is
    'Timestamp of the last successful verify run that wrote last_health_report. Null when never run.';


-- ═══ MIGRATION: 0007_public_session.sql ═══

-- Public issue sessions. Lets a project owner mint a shareable URL
-- (`/p/<token>`) where anyone — no login — can file an issue against
-- the project. Sessions are owner-managed (toggle enabled, regenerate
-- token, edit the public title/description shown to submitters).
--
-- Anonymous submissions hit a server route that validates the token
-- with the service role and inserts the issue under the owner's
-- user_id, so the existing owner-only RLS on `issues` keeps reads
-- locked down. We never expose this table directly to anon — the
-- public page reads it through the same service-role path.

create table if not exists tracker.project_public_sessions (
    project_id     uuid        primary key references tracker.projects(id) on delete cascade,
    token          text        not null unique,
    enabled        boolean     not null default true,
    title          text,
    description    text,
    submission_count int       not null default 0,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    constraint public_sessions_token_len check (length(token) >= 16)
);

create index if not exists public_sessions_token_idx
    on tracker.project_public_sessions(token) where enabled;

drop trigger if exists touch_public_sessions on tracker.project_public_sessions;
create trigger touch_public_sessions
    before update on tracker.project_public_sessions
    for each row execute function tracker.touch_updated_at();

alter table tracker.project_public_sessions enable row level security;

-- Owner-only management. Anonymous submissions go through the service
-- role (server-only), so anon never needs SELECT/INSERT here.
drop policy if exists public_sessions_owner_all on tracker.project_public_sessions;
create policy public_sessions_owner_all on tracker.project_public_sessions
    for all
    using      (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()))
    with check (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()));

grant all on tracker.project_public_sessions to authenticated, service_role;


-- ═══ MIGRATION: 0008_public_session_window.sql ═══

-- Optional active-window for public issue sessions. Owners can pin a
-- start_at / end_at; outside the window the public page renders a
-- "not yet open" / "closed" state and the submission API rejects
-- with `window_closed`. Both columns are nullable — null on either
-- side means open-ended on that end.
--
-- The check constraint forbids inverted windows but tolerates
-- single-sided ones (only start_at, only end_at, or neither).

alter table tracker.project_public_sessions
    add column if not exists start_at timestamptz,
    add column if not exists end_at   timestamptz;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'public_sessions_window_order'
    ) then
        alter table tracker.project_public_sessions
            add constraint public_sessions_window_order
            check (start_at is null or end_at is null or start_at < end_at);
    end if;
end $$;


-- ═══ MIGRATION: 0009_public_sessions_v2.sql ═══

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


-- ═══ MIGRATION: 0010_public_issue_reporter.sql ═══

-- Reporter identity for public-session issues.
--
-- Anonymous submitters get a stable client-generated id (UUID written
-- to localStorage on first visit) so multiple anonymous reporters
-- don't all collapse into one bucket on the public listing. Named
-- submitters also send a display name. Both columns are nullable —
-- owner-filed issues never set them.
--
-- We persist the structured values *in addition to* the existing
-- markdown stamp on the body, since the maintainer's authenticated
-- views still read the body verbatim.

alter table tracker.issues
    add column if not exists public_reporter_id   text,
    add column if not exists public_reporter_name text;

create index if not exists issues_public_reporter_idx
    on tracker.issues(project_id, public_reporter_id)
    where public_reporter_id is not null;


-- ═══ MIGRATION: 0011_public_integration_and_reporters.sql ═══

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


-- ═══ MIGRATION: 0012_public_session_invite_only.sql ═══

-- Per-session access mode: 'link' (anyone with the URL — current
-- behaviour) or 'invite' (only authenticated users whose email is on
-- the session's whitelist). Existing sessions stay 'link' so behaviour
-- doesn't silently change for live links.
--
-- Whitelisted emails live in tracker.public_session_invites and are
-- consulted by every public route (page render, submission, suggest).
-- We compare against the authenticated user's email; the row is keyed
-- by the lowercased email so case differences between Supabase auth
-- and what the owner pasted in don't lock out legitimate users.

alter table tracker.public_sessions
    add column if not exists access_mode text not null default 'link';

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'public_sessions_access_mode_chk'
    ) then
        alter table tracker.public_sessions
            add constraint public_sessions_access_mode_chk
            check (access_mode in ('link', 'invite'));
    end if;
end $$;

create table if not exists tracker.public_session_invites (
    session_id  uuid not null references tracker.public_sessions(id) on delete cascade,
    -- Stored already-lowercased; we never accept a mixed-case write.
    email       text not null,
    created_at  timestamptz not null default now(),
    primary key (session_id, email),
    constraint public_session_invites_email_lower check (email = lower(email)),
    -- Cheap shape check — full RFC validation lives in the API layer.
    constraint public_session_invites_email_shape check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create index if not exists public_session_invites_email_idx
    on tracker.public_session_invites(email);

alter table tracker.public_session_invites enable row level security;

-- Owner-only management. Anonymous / non-owner users never see invite
-- rows directly; the public routes consult them through the
-- service-role client after independently verifying the auth user's
-- email.
drop policy if exists public_session_invites_owner_all on tracker.public_session_invites;
create policy public_session_invites_owner_all on tracker.public_session_invites
    for all
    using      (exists (
        select 1 from tracker.public_sessions s
        where s.id = session_id and s.user_id = auth.uid()
    ))
    with check (exists (
        select 1 from tracker.public_sessions s
        where s.id = session_id and s.user_id = auth.uid()
    ));

grant all on tracker.public_session_invites to authenticated, service_role;


-- ═══ MIGRATION: 0013_public_session_visibility.sql ═══

-- Per-session toggle for whether submitters can see each other's
-- submissions:
--
--   'all' (default, preserves current behaviour) — anyone with access
--     to the link sees every reporter's submissions on the index.
--
--   'own' — submitters only see their own. Enforced server-side when
--     the visitor is authenticated (invite mode, or link-mode with a
--     signed-in user); for anonymous link-mode visitors the listing
--     is filtered client-side by their localStorage reporter id —
--     "own"-mode in link sessions is a privacy preference, not a hard
--     boundary, since reporter ids are client-supplied.
--
-- public_issue_reporters.auth_user_id captures the auth.uid() of the
-- submitter when they were authenticated at submission time. That
-- gives us the stable identity needed to enforce the 'own' filter
-- across browsers / devices.

alter table tracker.public_sessions
    add column if not exists submissions_visibility text not null default 'all';

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'public_sessions_visibility_chk'
    ) then
        alter table tracker.public_sessions
            add constraint public_sessions_visibility_chk
            check (submissions_visibility in ('all', 'own'));
    end if;
end $$;

alter table tracker.public_issue_reporters
    add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create index if not exists public_issue_reporters_auth_user_idx
    on tracker.public_issue_reporters(auth_user_id) where auth_user_id is not null;


-- ═══ MIGRATION: 0014_ai_issues.sql ═══

-- AI issue composer + duplicate detection.
--
-- Two structural pieces:
--
--   1. tracker.issues.embedding — 1536-dim vector from OpenAI's
--      text-embedding-3-small. Generated server-side after each
--      issue insert (best-effort, async). Used to surface similar
--      already-filed issues when someone composes a new one.
--
--   2. tracker.issues.duplicate_of_issue_id — when a submitter
--      flags their new issue as a duplicate of an existing one,
--      this column captures the link. The issue is still persisted
--      so the report isn't lost, but UIs treat it as a satellite
--      of its parent (no AI suggestion run, hidden from default lists).
--
--   3. ai_proposed flag — distinguishes AI-composed drafts from
--      hand-typed ones for analytics + display badges.
--
-- pgvector is required. Install once at the database level; the
-- extension is harmless on subsequent runs.

create extension if not exists vector;

alter table tracker.issues
    add column if not exists embedding              vector(1536),
    add column if not exists duplicate_of_issue_id  uuid references tracker.issues(id) on delete set null,
    add column if not exists ai_proposed            boolean not null default false;

-- HNSW is the sweet spot for our scale (thousands of issues per
-- project, not millions): fast inserts, sub-ms cosine queries, no
-- training step. cosine_ops because text-embedding-3-small is
-- normalized — cosine distance equals dot product.
create index if not exists issues_embedding_hnsw_idx
    on tracker.issues
    using hnsw (embedding vector_cosine_ops)
    where embedding is not null;

create index if not exists issues_duplicate_of_idx
    on tracker.issues(duplicate_of_issue_id)
    where duplicate_of_issue_id is not null;

-- RPC: similarity search scoped to one project.
--
-- We expose this as a security-definer function so the tracker can
-- call it through the regular supabase-js client without round-
-- tripping every embedding through the RLS planner. The function
-- itself only ever returns rows from a project the caller already
-- owns — we re-check ownership via auth.uid() to be safe.
create or replace function tracker.find_similar_issues(
    p_project_id uuid,
    p_embedding  vector(1536),
    p_limit      int default 5,
    p_exclude_id uuid default null
)
returns table (
    id           uuid,
    issue_number int,
    title        text,
    status       text,
    similarity   float
)
language plpgsql
security definer
set search_path = tracker, public
as $$
begin
    if not exists (
        select 1 from tracker.projects p
        where p.id = p_project_id and p.user_id = auth.uid()
    ) then
        raise exception 'project not owned by caller' using errcode = '42501';
    end if;

    return query
    select
        i.id,
        i.issue_number,
        i.title,
        i.status::text,
        1 - (i.embedding <=> p_embedding) as similarity
    from tracker.issues i
    where i.project_id = p_project_id
      and i.embedding is not null
      and (p_exclude_id is null or i.id <> p_exclude_id)
      and i.duplicate_of_issue_id is null
    order by i.embedding <=> p_embedding
    limit p_limit;
end $$;

grant execute on function tracker.find_similar_issues(uuid, vector(1536), int, uuid)
    to authenticated, service_role;


-- ═══ MIGRATION: 0015_issue_embeddings_table.sql ═══

-- Move issue embeddings out of tracker.issues into a dedicated
-- tracker.issue_embeddings table.
--
-- Why: vectors are heavy (1536 floats ≈ 6 KB per row), they don't
-- belong on the hot path that selects/updates plain issue metadata,
-- and a separate table lets us stamp the model name + regen
-- timestamp per embedding so future re-embed sweeps know what's
-- stale. It also keeps the RLS surface for embeddings independent
-- of the issue row itself.
--
-- Backfill copies any existing vectors over before the column is
-- dropped, so no embeddings are lost.

create table if not exists tracker.issue_embeddings (
    issue_id    uuid primary key references tracker.issues(id) on delete cascade,
    embedding   vector(1536) not null,
    -- Which model produced the vector. Lets a re-embed sweep target
    -- only rows from older/different models.
    model       text not null default 'text-embedding-3-small',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

drop trigger if exists touch_issue_embeddings on tracker.issue_embeddings;
create trigger touch_issue_embeddings
    before update on tracker.issue_embeddings
    for each row execute function tracker.touch_updated_at();

-- HNSW cosine index on the new column. Same shape as the one we had
-- on issues.embedding — sub-ms nearest-neighbor lookups for the
-- per-project similarity panel.
create index if not exists issue_embeddings_hnsw_idx
    on tracker.issue_embeddings
    using hnsw (embedding vector_cosine_ops);

alter table tracker.issue_embeddings enable row level security;

-- Owner-only access. Mirror of the issues policy: a user can read /
-- write the embedding row iff they own the parent issue's project.
drop policy if exists issue_embeddings_owner_all on tracker.issue_embeddings;
create policy issue_embeddings_owner_all on tracker.issue_embeddings
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

grant all on tracker.issue_embeddings to authenticated, service_role;

-- Backfill from the column we're dropping. Idempotent — re-running
-- the migration after the column is gone is fine because the column
-- check guards against missing-column errors.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'tracker'
          and table_name = 'issues'
          and column_name = 'embedding'
    ) then
        insert into tracker.issue_embeddings (issue_id, embedding)
        select id, embedding
        from tracker.issues
        where embedding is not null
        on conflict (issue_id) do nothing;
    end if;
end $$;

-- Drop the old index + column. The find_similar_issues RPC is
-- recreated below to JOIN through the new table.
drop index if exists tracker.issues_embedding_hnsw_idx;

alter table tracker.issues
    drop column if exists embedding;

-- Replace the RPC. Same signature so existing callers keep working
-- — only the join target changes. We continue to exclude rows that
-- have been marked as duplicates so they don't dominate the
-- "similar" suggestions on a fresh issue.
create or replace function tracker.find_similar_issues(
    p_project_id uuid,
    p_embedding  vector(1536),
    p_limit      int default 5,
    p_exclude_id uuid default null
)
returns table (
    id           uuid,
    issue_number int,
    title        text,
    status       text,
    similarity   float
)
language plpgsql
security definer
set search_path = tracker, public
as $$
begin
    if not exists (
        select 1 from tracker.projects p
        where p.id = p_project_id and p.user_id = auth.uid()
    ) then
        raise exception 'project not owned by caller' using errcode = '42501';
    end if;

    return query
    select
        i.id,
        i.issue_number,
        i.title,
        i.status::text,
        1 - (e.embedding <=> p_embedding) as similarity
    from tracker.issues i
        join tracker.issue_embeddings e on e.issue_id = i.id
    where i.project_id = p_project_id
      and (p_exclude_id is null or i.id <> p_exclude_id)
      and i.duplicate_of_issue_id is null
    order by e.embedding <=> p_embedding
    limit p_limit;
end $$;

-- Sister RPC: find issues similar to an *existing* one. Takes the
-- issue id, looks up its stored embedding, then runs the same
-- nearest-neighbor query (excluding the source issue itself). Used
-- by the post-create similarity card on the issue detail page so
-- the tracker doesn't have to fetch the vector + round-trip.
--
-- security_invoker so the caller's RLS still applies: a user can
-- only run this for an issue they own, and they only see neighbors
-- in projects they own.
create or replace function tracker.find_similar_to_issue(
    p_issue_id uuid,
    p_limit    int default 5
)
returns table (
    id           uuid,
    issue_number int,
    title        text,
    status       text,
    similarity   float
)
language plpgsql
security invoker
set search_path = tracker, public
as $$
declare
    v_embedding vector(1536);
    v_project   uuid;
begin
    select e.embedding, i.project_id
        into v_embedding, v_project
        from tracker.issues i
            join tracker.issue_embeddings e on e.issue_id = i.id
        where i.id = p_issue_id;

    if v_embedding is null then
        return; -- no embedding yet → empty result
    end if;

    return query
    select
        i.id,
        i.issue_number,
        i.title,
        i.status::text,
        1 - (e.embedding <=> v_embedding) as similarity
    from tracker.issues i
        join tracker.issue_embeddings e on e.issue_id = i.id
    where i.project_id = v_project
      and i.id <> p_issue_id
      and i.duplicate_of_issue_id is null
    order by e.embedding <=> v_embedding
    limit p_limit;
end $$;

grant execute on function tracker.find_similar_issues(uuid, vector(1536), int, uuid)
    to authenticated, service_role;
grant execute on function tracker.find_similar_to_issue(uuid, int)
    to authenticated, service_role;


-- ═══ MIGRATION: 0016_issue_status_duplicated.sql ═══

-- Add a 'duplicated' value to the tracker.issue_status enum.
--
-- An issue marked as a duplicate of another (via
-- duplicate_of_issue_id) is now also stamped with status='duplicated'
-- by the API layer (see app/api/issues/[id]/duplicate-of/route.ts).
-- That gives the UI a single state to filter on without needing to
-- join through the duplicate_of column for every list query, and
-- makes "duplicated" appear in the same status pill / dropdown UI
-- as the rest of the lifecycle states.
--
-- ALTER TYPE … ADD VALUE is not transactional in older Postgres
-- versions, but Supabase's planner handles the IF NOT EXISTS guard,
-- so re-running this migration is safe.

alter type tracker.issue_status add value if not exists 'duplicated';


-- ═══ MIGRATION: 0017_project_summary_embedding.sql ═══

-- Project-level summary + embedding, refreshed on every successful
-- bootstrap or incremental update by bobby-analyser.
--
-- Why on project_analyser instead of a new table:
--   The summary's lifecycle matches the analyser's lifecycle exactly
--   — created when indexing finishes, replaced on every reindex, and
--   gone if the project's analyser row is deleted. A separate table
--   would only add a join with no extra flexibility.
--
-- Columns:
--   summary_markdown      — human-readable snapshot of what the
--                           project is, what it's built with, and
--                           which modules / surfaces it exposes.
--                           Powers the future project-groups UI
--                           ("which project does this issue belong
--                           to?") and is a great context block for
--                           the AI compose flow when an org has
--                           multiple repos in one group.
--   summary_embedding     — 1536-dim vector from
--                           text-embedding-3-small over the markdown.
--                           Used by similarity lookups against
--                           issue-draft embeddings to route an issue
--                           to the right project in a group.
--   summary_model         — name of the embedding model that produced
--                           the vector. Lets a future re-embed sweep
--                           target old rows.
--   summary_updated_at    — when the markdown + vector were last
--                           refreshed.

alter table tracker.project_analyser
    add column if not exists summary_markdown   text,
    add column if not exists summary_embedding  vector(1536),
    add column if not exists summary_model      text,
    add column if not exists summary_updated_at timestamptz;

create index if not exists project_analyser_summary_hnsw_idx
    on tracker.project_analyser
    using hnsw (summary_embedding vector_cosine_ops)
    where summary_embedding is not null;

-- Similarity RPC: given a query vector (typically an issue-draft
-- embedding) + a candidate set of project IDs, return the projects
-- ranked by cosine similarity to the query. The caller scopes the
-- candidate set so we don't need a global "see all projects" check
-- — passing an empty array returns nothing.
--
-- security_invoker so the caller's RLS still applies: a user can
-- only see projects they own (existing project_analyser RLS does
-- the join through tracker.projects).
create or replace function tracker.find_similar_projects(
    p_embedding   vector(1536),
    p_project_ids uuid[],
    p_limit       int default 5
)
returns table (
    project_id uuid,
    similarity float
)
language sql
security invoker
set search_path = tracker, public
as $$
    select
        a.project_id,
        1 - (a.summary_embedding <=> p_embedding) as similarity
    from tracker.project_analyser a
    where a.summary_embedding is not null
      and a.project_id = any(p_project_ids)
    order by a.summary_embedding <=> p_embedding
    limit p_limit;
$$;

grant execute on function tracker.find_similar_projects(vector(1536), uuid[], int)
    to authenticated, service_role;


-- ═══ MIGRATION: 0018_project_summary_split_embeddings.sql ═══

-- Split the single summary_embedding into four facet embeddings so
-- project-routing can weigh signals separately.
--
-- Why: a project's "stack" tells you almost nothing about whether a
-- given issue belongs to it (lots of projects share Next.js + Postgres),
-- whereas its "modules" list is the single most predictive signal
-- (an issue mentioning a module name almost always belongs to its
-- owning project). One blended embedding can't express that — the
-- module token gets diluted by overview prose. Four facets let us
-- weigh them as the AI compose flow needs.
--
-- Weights (set by the caller of find_similar_projects):
--   - overview  25%   high-level "what is this product"
--   - features  20%   feature-level / cluster-note signals
--   - stack     15%   technology fingerprint, deliberately low
--   - modules   40%   structural fingerprint, deliberately high
--
-- bobby-analyser computes these on every successful bootstrap /
-- incremental update via internal/summariser. Each chunk runs through
-- text-embedding-3-small independently.

-- Drop the old single-vector column + index. summary_markdown stays
-- (human-readable display) along with summary_model + summary_updated_at.
drop index if exists tracker.project_analyser_summary_hnsw_idx;

alter table tracker.project_analyser
    drop column if exists summary_embedding;

-- Four new vector columns, one per facet.
alter table tracker.project_analyser
    add column if not exists summary_overview_embedding vector(1536),
    add column if not exists summary_features_embedding vector(1536),
    add column if not exists summary_stack_embedding    vector(1536),
    add column if not exists summary_modules_embedding  vector(1536);

create index if not exists project_analyser_summary_overview_idx
    on tracker.project_analyser using hnsw (summary_overview_embedding vector_cosine_ops)
    where summary_overview_embedding is not null;

create index if not exists project_analyser_summary_features_idx
    on tracker.project_analyser using hnsw (summary_features_embedding vector_cosine_ops)
    where summary_features_embedding is not null;

create index if not exists project_analyser_summary_stack_idx
    on tracker.project_analyser using hnsw (summary_stack_embedding vector_cosine_ops)
    where summary_stack_embedding is not null;

create index if not exists project_analyser_summary_modules_idx
    on tracker.project_analyser using hnsw (summary_modules_embedding vector_cosine_ops)
    where summary_modules_embedding is not null;

-- Recreate find_similar_projects with the weighted-facet model. The
-- caller passes ONE issue-draft embedding and the four weights; the
-- function compares it against each facet vector independently and
-- returns the weighted sum.
--
-- A facet that's missing on a row contributes 0 instead of NULL, so
-- partially-summarised projects still rank — they just rank lower
-- than fully-summarised ones, which is the right incentive.
--
-- We keep the old function signature alive too: replacing the
-- existing function in place (CREATE OR REPLACE) requires the same
-- argument list, but Postgres doesn't support that for changed
-- argument lists. Drop-then-create both shapes.
drop function if exists tracker.find_similar_projects(vector(1536), uuid[], int);

create or replace function tracker.find_similar_projects(
    p_embedding       vector(1536),
    p_project_ids     uuid[],
    p_limit           int   default 5,
    p_weight_overview float default 0.25,
    p_weight_features float default 0.20,
    p_weight_stack    float default 0.15,
    p_weight_modules  float default 0.40
)
returns table (
    project_id uuid,
    similarity float,
    /* per-facet breakdown so callers can show how the score was
       composed — useful for debugging routing decisions in the UI. */
    overview_sim float,
    features_sim float,
    stack_sim    float,
    modules_sim  float
)
language sql
security invoker
set search_path = tracker, public
as $$
    select
        a.project_id,
        coalesce(p_weight_overview * (1 - (a.summary_overview_embedding <=> p_embedding)), 0)
            + coalesce(p_weight_features * (1 - (a.summary_features_embedding <=> p_embedding)), 0)
            + coalesce(p_weight_stack    * (1 - (a.summary_stack_embedding    <=> p_embedding)), 0)
            + coalesce(p_weight_modules  * (1 - (a.summary_modules_embedding  <=> p_embedding)), 0)
            as similarity,
        case when a.summary_overview_embedding is not null
             then 1 - (a.summary_overview_embedding <=> p_embedding) end as overview_sim,
        case when a.summary_features_embedding is not null
             then 1 - (a.summary_features_embedding <=> p_embedding) end as features_sim,
        case when a.summary_stack_embedding is not null
             then 1 - (a.summary_stack_embedding <=> p_embedding) end as stack_sim,
        case when a.summary_modules_embedding is not null
             then 1 - (a.summary_modules_embedding <=> p_embedding) end as modules_sim
    from tracker.project_analyser a
    where a.project_id = any(p_project_ids)
      and (a.summary_overview_embedding is not null
           or a.summary_features_embedding is not null
           or a.summary_stack_embedding is not null
           or a.summary_modules_embedding is not null)
    order by similarity desc
    limit p_limit;
$$;

grant execute on function tracker.find_similar_projects(
    vector(1536), uuid[], int, float, float, float, float
) to authenticated, service_role;


-- ═══ MIGRATION: 0019_project_groups.sql ═══

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


-- ═══ MIGRATION: 0020_public_session_group_source.sql ═══

-- Public sessions can now optionally be backed by a project group
-- instead of (or in addition to) a manual project list. When
-- group_id is set, the session's effective coverage is the group's
-- current membership filtered to projects that have the public-
-- submissions integration enabled — adding a project to the group
-- expands the session automatically, removing one shrinks it.
--
-- This is the data model change that lets the public AI compose
-- flow do the same project routing the authenticated group page
-- already does: caller hits the public ai-compose endpoint with
-- token + paragraph, the server pulls the group, runs compose +
-- embed + find_similar_projects, and the public form gets back a
-- ranking so the submitter (or the form on their behalf) can route
-- the issue to the most-relevant project(s).
--
-- group_id is nullable. When null, the session uses the existing
-- public_session_projects junction. Both can be present — the
-- group takes precedence at resolve time, but the junction is
-- preserved as a fallback / migration path.

alter table tracker.public_sessions
    add column if not exists group_id uuid references tracker.project_groups(id) on delete set null;

-- on delete set null instead of cascade: deleting a group shouldn't
-- delete the sessions that referenced it. They drop back to manual-
-- project mode and the owner can repoint them.

create index if not exists public_sessions_group_idx
    on tracker.public_sessions(group_id) where group_id is not null;


-- ═══ MIGRATION: 0021_project_routing_tags.sql ═══

-- Tag-based routing. The single `summary_features_embedding` facet is
-- replaced by two tag pools per project — layer (frontend / backend /
-- api / database / infra / mobile / shared) and hierarchical feature
-- (domain/subdomain). Each tag carries its own embedding so issue
-- compose can score "does this project's tag pool contain anything
-- similar to this issue's layer / feature?" via max-cosine, instead of
-- folding everything into one prose vector.
--
-- The other three facets (overview / stack / modules) stay as-is. The
-- new RPC blends:
--
--   layer_sim    30%   — max cosine over project's layer tag pool
--   feature_sim  30%   — max cosine over project's feature tag pool
--   modules_sim  20%   — existing modules facet
--   overview_sim 10%   — existing overview facet (fuzzy fallback)
--   stack_sim    10%   — existing stack facet (fingerprint, low signal)
--
-- Layer + feature dominate (60%) because they encode the cross-repo
-- dimension that one-blob embeddings kept washing out.

-- ─── drop the old features facet ────────────────────────────────────────────
drop index if exists tracker.project_analyser_summary_features_idx;

alter table tracker.project_analyser
    drop column if exists summary_features_embedding;

-- Drop both signatures of the prior RPC (the original from 0017 may
-- linger in some envs alongside the 0018 one). Postgres needs the full
-- signature to drop a function.
drop function if exists tracker.find_similar_projects(vector(1536), uuid[], int);
drop function if exists tracker.find_similar_projects(vector(1536), uuid[], int, float, float, float, float);

-- ─── per-project tag pools ──────────────────────────────────────────────────

-- Layer tags. Controlled vocabulary — analyser is expected to emit
-- values from {frontend, backend, api, database, infra, mobile, shared}
-- but we don't enforce it in SQL: the embedding handles drift, and
-- locking the vocab in the schema would make it painful to evolve.
create table if not exists tracker.project_layer_tags (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid not null references tracker.projects(id) on delete cascade,
    tag          text not null,
    embedding    vector(1536) not null,
    created_at   timestamptz not null default now(),
    unique (project_id, tag)
);

create index if not exists project_layer_tags_project_idx
    on tracker.project_layer_tags(project_id);

-- Hierarchical feature tags ("domain/subdomain", e.g. "auth/login").
-- Free-form so the analyser can name what it actually finds.
create table if not exists tracker.project_feature_tags (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid not null references tracker.projects(id) on delete cascade,
    tag          text not null,
    embedding    vector(1536) not null,
    created_at   timestamptz not null default now(),
    unique (project_id, tag)
);

create index if not exists project_feature_tags_project_idx
    on tracker.project_feature_tags(project_id);

alter table tracker.project_layer_tags   enable row level security;
alter table tracker.project_feature_tags enable row level security;

-- Owners read their own tags. Mirrors project_analyser policy: scoped
-- by project ownership rather than user_id, since tags are 1-N to a
-- project.
drop policy if exists project_layer_tags_owner_read on tracker.project_layer_tags;
create policy project_layer_tags_owner_read on tracker.project_layer_tags
    for select to authenticated
    using (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()));

drop policy if exists project_feature_tags_owner_read on tracker.project_feature_tags;
create policy project_feature_tags_owner_read on tracker.project_feature_tags
    for select to authenticated
    using (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()));

-- Writes go through service-role (analyser) only — no INSERT/UPDATE
-- policy for authenticated. Service role bypasses RLS.

-- ─── replace_project_tags(project_id, layers, features) ─────────────────────
--
-- Atomic refresh helper for the analyser. Body shape:
--
--   layers   = [{ "tag": "frontend",         "embedding": [0.1, ...] }, …]
--   features = [{ "tag": "auth/login",        "embedding": [0.1, ...] }, …]
--
-- Old rows are deleted then re-inserted in one statement so a race
-- between two index runs can't leave a project with half its tags.
-- security definer because we're only callable by service-role anyway
-- and want a single grant point.
create or replace function tracker.replace_project_tags(
    p_project_id   uuid,
    p_layer_tags   jsonb,
    p_feature_tags jsonb
)
returns void
language plpgsql
security definer
set search_path = tracker, public
as $$
begin
    delete from tracker.project_layer_tags   where project_id = p_project_id;
    delete from tracker.project_feature_tags where project_id = p_project_id;

    insert into tracker.project_layer_tags(project_id, tag, embedding)
    select
        p_project_id,
        nullif(t->>'tag', ''),
        ((t->'embedding')::text)::vector(1536)
    from jsonb_array_elements(coalesce(p_layer_tags, '[]'::jsonb)) as t
    where coalesce(t->>'tag', '') <> ''
      and jsonb_typeof(t->'embedding') = 'array'
    on conflict (project_id, tag) do update set embedding = excluded.embedding;

    insert into tracker.project_feature_tags(project_id, tag, embedding)
    select
        p_project_id,
        nullif(t->>'tag', ''),
        ((t->'embedding')::text)::vector(1536)
    from jsonb_array_elements(coalesce(p_feature_tags, '[]'::jsonb)) as t
    where coalesce(t->>'tag', '') <> ''
      and jsonb_typeof(t->'embedding') = 'array'
    on conflict (project_id, tag) do update set embedding = excluded.embedding;
end;
$$;

revoke all on function tracker.replace_project_tags(uuid, jsonb, jsonb) from public;
grant execute on function tracker.replace_project_tags(uuid, jsonb, jsonb) to service_role;

-- ─── new find_similar_projects ──────────────────────────────────────────────
--
-- Three query vectors:
--
--   p_routing_embedding   embedding of the issue's routing_summary, used
--                         as the query for overview / stack / modules
--                         (the prose facets, where one query vector
--                         remains the right shape).
--   p_layer_embedding     embedding of the issue's layer text (e.g.
--                         "frontend"). Compared via max cosine against
--                         the project's project_layer_tags pool.
--   p_feature_embedding   embedding of the issue's feature text (joined
--                         when the issue has multiple). Compared the
--                         same way against project_feature_tags.
--
-- Missing facets contribute 0 (not NULL) so a partially-tagged project
-- still ranks but loses points proportional to what it's missing —
-- correct incentive: index your project, get better routing.

create or replace function tracker.find_similar_projects(
    p_routing_embedding vector(1536),
    p_layer_embedding   vector(1536),
    p_feature_embedding vector(1536),
    p_project_ids       uuid[],
    p_limit             int   default 5,
    p_weight_layer      float default 0.30,
    p_weight_feature    float default 0.30,
    p_weight_modules    float default 0.20,
    p_weight_overview   float default 0.10,
    p_weight_stack      float default 0.10
)
returns table (
    project_id   uuid,
    similarity   float,
    layer_sim    float,
    feature_sim  float,
    overview_sim float,
    stack_sim    float,
    modules_sim  float
)
language sql
security invoker
set search_path = tracker, public
as $$
    with bases as (
        select pid as project_id from unnest(p_project_ids) as pid
    ),
    layer_scores as (
        select b.project_id,
               max(1 - (lt.embedding <=> p_layer_embedding)) as layer_sim
        from bases b
        left join tracker.project_layer_tags lt on lt.project_id = b.project_id
        group by b.project_id
    ),
    feature_scores as (
        select b.project_id,
               max(1 - (ft.embedding <=> p_feature_embedding)) as feature_sim
        from bases b
        left join tracker.project_feature_tags ft on ft.project_id = b.project_id
        group by b.project_id
    ),
    facet_scores as (
        select b.project_id,
               case when a.summary_overview_embedding is not null
                    then 1 - (a.summary_overview_embedding <=> p_routing_embedding) end as overview_sim,
               case when a.summary_stack_embedding is not null
                    then 1 - (a.summary_stack_embedding <=> p_routing_embedding) end as stack_sim,
               case when a.summary_modules_embedding is not null
                    then 1 - (a.summary_modules_embedding <=> p_routing_embedding) end as modules_sim
        from bases b
        left join tracker.project_analyser a on a.project_id = b.project_id
    )
    select
        b.project_id,
        coalesce(p_weight_layer    * ls.layer_sim,   0)
            + coalesce(p_weight_feature  * fs.feature_sim, 0)
            + coalesce(p_weight_overview * gs.overview_sim,0)
            + coalesce(p_weight_stack    * gs.stack_sim,   0)
            + coalesce(p_weight_modules  * gs.modules_sim, 0) as similarity,
        ls.layer_sim,
        fs.feature_sim,
        gs.overview_sim,
        gs.stack_sim,
        gs.modules_sim
    from bases b
    left join layer_scores   ls on ls.project_id = b.project_id
    left join feature_scores fs on fs.project_id = b.project_id
    left join facet_scores   gs on gs.project_id = b.project_id
    order by similarity desc
    limit p_limit;
$$;

grant execute on function tracker.find_similar_projects(
    vector(1536), vector(1536), vector(1536),
    uuid[], int,
    float, float, float, float, float
) to authenticated, service_role;


-- ═══ MIGRATION: 0022_replace_project_tags_security_invoker.sql ═══

-- Fix permission denied on project_layer_tags / project_feature_tags
-- when the analyser calls replace_project_tags.
--
-- 0021 created the RPC as `security definer`, which makes it run as
-- the function owner instead of the caller. In our setup that owner
-- doesn't carry BYPASSRLS, so even though the analyser uses
-- service_role to invoke the RPC, the writes inside the function hit
-- RLS on tables that only have a SELECT policy — hence the "permission
-- denied" the user is seeing.
--
-- The grant on this RPC is service_role-only, and service_role does
-- bypass RLS, so flipping the function to `security invoker` removes
-- the problem cleanly: the deletes + inserts inherit the caller's
-- BYPASSRLS attribute and go through. We also grant explicit DML on
-- the tag tables to service_role as a belt-and-braces guarantee.

create or replace function tracker.replace_project_tags(
    p_project_id   uuid,
    p_layer_tags   jsonb,
    p_feature_tags jsonb
)
returns void
language plpgsql
security invoker
set search_path = tracker, public
as $$
begin
    delete from tracker.project_layer_tags   where project_id = p_project_id;
    delete from tracker.project_feature_tags where project_id = p_project_id;

    insert into tracker.project_layer_tags(project_id, tag, embedding)
    select
        p_project_id,
        nullif(t->>'tag', ''),
        ((t->'embedding')::text)::vector(1536)
    from jsonb_array_elements(coalesce(p_layer_tags, '[]'::jsonb)) as t
    where coalesce(t->>'tag', '') <> ''
      and jsonb_typeof(t->'embedding') = 'array'
    on conflict (project_id, tag) do update set embedding = excluded.embedding;

    insert into tracker.project_feature_tags(project_id, tag, embedding)
    select
        p_project_id,
        nullif(t->>'tag', ''),
        ((t->'embedding')::text)::vector(1536)
    from jsonb_array_elements(coalesce(p_feature_tags, '[]'::jsonb)) as t
    where coalesce(t->>'tag', '') <> ''
      and jsonb_typeof(t->'embedding') = 'array'
    on conflict (project_id, tag) do update set embedding = excluded.embedding;
end;
$$;

revoke all on function tracker.replace_project_tags(uuid, jsonb, jsonb) from public;
grant execute on function tracker.replace_project_tags(uuid, jsonb, jsonb) to service_role;

-- Explicit DML grants. service_role normally inherits these via
-- Supabase's default ALL-PRIVILEGES grant on the tracker schema, but
-- being explicit means future schema-grant changes can't silently
-- break the analyser write path.
grant select, insert, update, delete on tracker.project_layer_tags   to service_role;
grant select, insert, update, delete on tracker.project_feature_tags to service_role;


-- ═══ MIGRATION: 0023_main_plus_tag_routing.sql ═══

-- Reshape project routing into best-practice "main + tag refinement":
--
--   final = 0.70 * cosine(issue_query, main_project_embedding)
--         + 0.30 * max(cosine(issue_query, project_tag_embedding))
--
-- This replaces the four-prose-facet + bare-tag system from 0021.
-- The reasons we're moving:
--
--   1. Bare-slug tag embeddings ("frontend", "auth") have too little
--      context to discriminate between projects — every web repo
--      embeds "frontend" the same way. Tags should be embedded as
--      contextualised phrases ("MyApp — frontend layer: React UI,
--      design system, dashboards") that carry project + role signal.
--
--   2. Splitting overview/stack/modules into three vectors fragments
--      the primary "what is this project" signal. Folding them into
--      one rich main embedding (name + summary + layers + features +
--      stack + modules) makes the dominant routing dimension
--      stronger AND simpler.
--
--   3. The issue side only needs ONE query vector — its
--      routing_summary embedding. Running it against the project's
--      main vector + the project's tag pool and taking
--      0.7*main + 0.3*max(tag) gives strong global context PLUS
--      precision boost on specific concepts.
--
-- Stack + modules columns are dropped: their content is recreated
-- inside the main overview text on the next analyser update, so
-- nothing's lost.

-- ─── drop legacy columns + indexes ──────────────────────────────────────────
drop index if exists tracker.project_analyser_summary_stack_idx;
drop index if exists tracker.project_analyser_summary_modules_idx;

alter table tracker.project_analyser
    drop column if exists summary_stack_embedding,
    drop column if exists summary_modules_embedding;

-- ─── replace the 0021 multi-vector RPC with the single-vector one ──────────
drop function if exists tracker.find_similar_projects(
    vector(1536), vector(1536), vector(1536),
    uuid[], int,
    float, float, float, float, float
);

-- New shape: one query vector + 5 args. Caller passes the issue's
-- routing_summary embedding; we score it against the project's main
-- vector AND the layer + feature tag pools, then blend.
create or replace function tracker.find_similar_projects(
    p_query_embedding vector(1536),
    p_project_ids     uuid[],
    p_limit           int   default 5,
    p_weight_main     float default 0.70,
    p_weight_tag      float default 0.30
)
returns table (
    project_id  uuid,
    similarity  float,
    main_sim    float,
    layer_sim   float,
    feature_sim float,
    tag_sim     float
)
language sql
security invoker
set search_path = tracker, public
as $$
    with bases as (
        select pid as project_id from unnest(p_project_ids) as pid
    ),
    main_scores as (
        select b.project_id,
               case when a.summary_overview_embedding is not null
                    then 1 - (a.summary_overview_embedding <=> p_query_embedding) end as main_sim
        from bases b
        left join tracker.project_analyser a on a.project_id = b.project_id
    ),
    layer_scores as (
        select b.project_id,
               max(1 - (lt.embedding <=> p_query_embedding)) as layer_sim
        from bases b
        left join tracker.project_layer_tags lt on lt.project_id = b.project_id
        group by b.project_id
    ),
    feature_scores as (
        select b.project_id,
               max(1 - (ft.embedding <=> p_query_embedding)) as feature_sim
        from bases b
        left join tracker.project_feature_tags ft on ft.project_id = b.project_id
        group by b.project_id
    )
    select
        b.project_id,
        coalesce(p_weight_main * ms.main_sim, 0)
            + coalesce(p_weight_tag * greatest(coalesce(ls.layer_sim, 0),
                                               coalesce(fs.feature_sim, 0)), 0)
            as similarity,
        ms.main_sim,
        ls.layer_sim,
        fs.feature_sim,
        greatest(coalesce(ls.layer_sim, 0), coalesce(fs.feature_sim, 0)) as tag_sim
    from bases b
    left join main_scores    ms on ms.project_id = b.project_id
    left join layer_scores   ls on ls.project_id = b.project_id
    left join feature_scores fs on fs.project_id = b.project_id
    order by similarity desc
    limit p_limit;
$$;

grant execute on function tracker.find_similar_projects(
    vector(1536), uuid[], int, float, float
) to authenticated, service_role;


-- ═══ MIGRATION: 0024_grant_project_tag_tables.sql ═══

-- Fix permission denied on project_layer_tags / project_feature_tags
-- when the AUTHENTICATED side reads them (via find_similar_projects).
--
-- 0001 grants `all on all tables in schema tracker` to authenticated +
-- service_role, but Postgres' GRANT ON ALL TABLES is a one-shot
-- snapshot — tables created afterwards (here: 0021's tag tables)
-- don't inherit. The fix in 0022 added grants for service_role only,
-- so the analyser write path works, but the tracker read path through
-- find_similar_projects (security invoker → runs as authenticated)
-- still hits "permission denied" before RLS is even evaluated.
--
-- Grant authenticated the same SELECT-level access it has on every
-- other tracker table. RLS policies (created in 0021) still gate
-- which rows a user actually sees — owner-only — so this doesn't
-- widen anyone's view, it just lets the policy run.
--
-- Also re-issuing the service_role grants from 0022 in the same
-- migration so a fresh database (running 0001..0024 in order)
-- doesn't need 0022 to have succeeded.

grant select on tracker.project_layer_tags   to authenticated;
grant select on tracker.project_feature_tags to authenticated;

grant select, insert, update, delete on tracker.project_layer_tags   to service_role;
grant select, insert, update, delete on tracker.project_feature_tags to service_role;


-- ═══ MIGRATION: 0025_routing_weights_40_30_30.sql ═══

-- Adjust the find_similar_projects blend from 70/30 main+max(tag) to
-- additive 40/30/30 main+layer+feature.
--
-- The 70/30 max(tag) shape gave a project credit for the BEST of its
-- two refinement signals. Now that the rollup is producing
-- contextualised tags reliably (per the analyser fixes in 0022/0024
-- + the json-mode summarise call), we want a project that matches on
-- BOTH dimensions to score higher than one matching on only one.
--
--   similarity = 0.40 * main_sim
--              + 0.30 * layer_sim
--              + 0.30 * feature_sim
--
-- Empty tag pools still contribute 0 (via coalesce), so projects
-- that haven't been re-indexed against the new tag system rank on
-- main_sim alone — same incentive as before.
--
-- We also drop tag_sim from the return shape since it was never
-- surfaced in the UI and stops being meaningful when the dimensions
-- combine additively.

drop function if exists tracker.find_similar_projects(
    vector(1536), uuid[], int, float, float
);

create or replace function tracker.find_similar_projects(
    p_query_embedding vector(1536),
    p_project_ids     uuid[],
    p_limit           int   default 5,
    p_weight_main     float default 0.40,
    p_weight_layer    float default 0.30,
    p_weight_feature  float default 0.30
)
returns table (
    project_id  uuid,
    similarity  float,
    main_sim    float,
    layer_sim   float,
    feature_sim float
)
language sql
security invoker
set search_path = tracker, public
as $$
    with bases as (
        select pid as project_id from unnest(p_project_ids) as pid
    ),
    main_scores as (
        select b.project_id,
               case when a.summary_overview_embedding is not null
                    then 1 - (a.summary_overview_embedding <=> p_query_embedding) end as main_sim
        from bases b
        left join tracker.project_analyser a on a.project_id = b.project_id
    ),
    layer_scores as (
        select b.project_id,
               max(1 - (lt.embedding <=> p_query_embedding)) as layer_sim
        from bases b
        left join tracker.project_layer_tags lt on lt.project_id = b.project_id
        group by b.project_id
    ),
    feature_scores as (
        select b.project_id,
               max(1 - (ft.embedding <=> p_query_embedding)) as feature_sim
        from bases b
        left join tracker.project_feature_tags ft on ft.project_id = b.project_id
        group by b.project_id
    )
    select
        b.project_id,
        coalesce(p_weight_main    * ms.main_sim,    0)
            + coalesce(p_weight_layer   * ls.layer_sim,   0)
            + coalesce(p_weight_feature * fs.feature_sim, 0)
            as similarity,
        ms.main_sim,
        ls.layer_sim,
        fs.feature_sim
    from bases b
    left join main_scores    ms on ms.project_id = b.project_id
    left join layer_scores   ls on ls.project_id = b.project_id
    left join feature_scores fs on fs.project_id = b.project_id
    order by similarity desc
    limit p_limit;
$$;

grant execute on function tracker.find_similar_projects(
    vector(1536), uuid[], int, float, float, float
) to authenticated, service_role;


-- ═══ MIGRATION: 0026_tag_confidence.sql ═══

-- Per-tag confidence (0..1) so the routing score reflects how
-- DOMINANT a layer or feature actually is in the project, not just
-- whether the analyser detected any trace of it.
--
-- Without this, a backend-heavy monolith with a tiny admin UI got
-- the same "frontend" match strength as a pure React app — the
-- cosine to "frontend" was ~the same in both vectors, and a single
-- close embedding was enough to win the layer dimension.
--
-- With confidence:
--
--   layer_sim   = max(confidence × cosine)
--   feature_sim = max(confidence × cosine)
--
-- A project with frontend confidence 0.3 caps its frontend layer_sim
-- at 0.3 even on a perfect cosine match. A confidence-1.0 frontend
-- repo can score up to the full cosine. Backwards compatible: NULL
-- confidence (analyser predates this migration) defaults to 1.0 so
-- existing rows still match at full strength.

alter table tracker.project_layer_tags
    add column if not exists confidence float not null default 1.0
    check (confidence >= 0 and confidence <= 1);

alter table tracker.project_feature_tags
    add column if not exists confidence float not null default 1.0
    check (confidence >= 0 and confidence <= 1);

-- replace_project_tags now reads "confidence" from the per-tag JSON
-- payload. Missing / out-of-range values clamp to [0,1] with 1.0 as
-- the default — never null, so the column constraint stays happy.
create or replace function tracker.replace_project_tags(
    p_project_id   uuid,
    p_layer_tags   jsonb,
    p_feature_tags jsonb
)
returns void
language plpgsql
security invoker
set search_path = tracker, public
as $$
begin
    delete from tracker.project_layer_tags   where project_id = p_project_id;
    delete from tracker.project_feature_tags where project_id = p_project_id;

    insert into tracker.project_layer_tags(project_id, tag, embedding, confidence)
    select
        p_project_id,
        nullif(t->>'tag', ''),
        ((t->'embedding')::text)::vector(1536),
        greatest(0, least(1, coalesce((t->>'confidence')::float, 1.0)))
    from jsonb_array_elements(coalesce(p_layer_tags, '[]'::jsonb)) as t
    where coalesce(t->>'tag', '') <> ''
      and jsonb_typeof(t->'embedding') = 'array'
    on conflict (project_id, tag) do update
        set embedding  = excluded.embedding,
            confidence = excluded.confidence;

    insert into tracker.project_feature_tags(project_id, tag, embedding, confidence)
    select
        p_project_id,
        nullif(t->>'tag', ''),
        ((t->'embedding')::text)::vector(1536),
        greatest(0, least(1, coalesce((t->>'confidence')::float, 1.0)))
    from jsonb_array_elements(coalesce(p_feature_tags, '[]'::jsonb)) as t
    where coalesce(t->>'tag', '') <> ''
      and jsonb_typeof(t->'embedding') = 'array'
    on conflict (project_id, tag) do update
        set embedding  = excluded.embedding,
            confidence = excluded.confidence;
end;
$$;

revoke all on function tracker.replace_project_tags(uuid, jsonb, jsonb) from public;
grant execute on function tracker.replace_project_tags(uuid, jsonb, jsonb) to service_role;

-- find_similar_projects now multiplies the cosine by the per-tag
-- confidence inside the MAX, so a low-confidence match can't carry
-- the dimension. Function signature unchanged — same call sites work.
create or replace function tracker.find_similar_projects(
    p_query_embedding vector(1536),
    p_project_ids     uuid[],
    p_limit           int   default 5,
    p_weight_main     float default 0.40,
    p_weight_layer    float default 0.30,
    p_weight_feature  float default 0.30
)
returns table (
    project_id  uuid,
    similarity  float,
    main_sim    float,
    layer_sim   float,
    feature_sim float
)
language sql
security invoker
set search_path = tracker, public
as $$
    with bases as (
        select pid as project_id from unnest(p_project_ids) as pid
    ),
    main_scores as (
        select b.project_id,
               case when a.summary_overview_embedding is not null
                    then 1 - (a.summary_overview_embedding <=> p_query_embedding) end as main_sim
        from bases b
        left join tracker.project_analyser a on a.project_id = b.project_id
    ),
    layer_scores as (
        select b.project_id,
               max(coalesce(lt.confidence, 1.0) * (1 - (lt.embedding <=> p_query_embedding))) as layer_sim
        from bases b
        left join tracker.project_layer_tags lt on lt.project_id = b.project_id
        group by b.project_id
    ),
    feature_scores as (
        select b.project_id,
               max(coalesce(ft.confidence, 1.0) * (1 - (ft.embedding <=> p_query_embedding))) as feature_sim
        from bases b
        left join tracker.project_feature_tags ft on ft.project_id = b.project_id
        group by b.project_id
    )
    select
        b.project_id,
        coalesce(p_weight_main    * ms.main_sim,    0)
            + coalesce(p_weight_layer   * ls.layer_sim,   0)
            + coalesce(p_weight_feature * fs.feature_sim, 0)
            as similarity,
        ms.main_sim,
        ls.layer_sim,
        fs.feature_sim
    from bases b
    left join main_scores    ms on ms.project_id = b.project_id
    left join layer_scores   ls on ls.project_id = b.project_id
    left join feature_scores fs on fs.project_id = b.project_id
    order by similarity desc
    limit p_limit;
$$;

grant execute on function tracker.find_similar_projects(
    vector(1536), uuid[], int, float, float, float
) to authenticated, service_role;


-- ═══ MIGRATION: 0027_issue_timeline.sql ═══

-- Issue planning timeline. Adds per-issue scheduling fields, a
-- per-project status colour palette, and a per-project label→icon
-- map. The icon map is required before a label can render on the
-- timeline; the UI gates timeline access on the icon map being
-- complete for all in-use labels (similar to the analyser-required
-- banner pattern from migration 0001).

-- ─── per-issue scheduling fields ───────────────────────────────────────────
-- starts_at / ends_at are nullable so existing issues stay
-- "unscheduled" and live in the tray below the timeline. lane_y is a
-- 0..1 fractional position so vertical placement survives across
-- screen sizes — the renderer multiplies by canvas height. color is
-- an optional hex override; null falls back to the project's status
-- palette.
alter table tracker.issues
    add column if not exists starts_at timestamptz,
    add column if not exists ends_at   timestamptz,
    add column if not exists lane_y    real,
    add column if not exists color     text;

alter table tracker.issues
    drop constraint if exists issues_lane_y_fraction;
alter table tracker.issues
    add constraint issues_lane_y_fraction
    check (lane_y is null or (lane_y >= 0 and lane_y <= 1));

alter table tracker.issues
    drop constraint if exists issues_schedule_ordering;
alter table tracker.issues
    add constraint issues_schedule_ordering
    check (
        starts_at is null
        or ends_at is null
        or ends_at >= starts_at
    );

alter table tracker.issues
    drop constraint if exists issues_color_hex;
alter table tracker.issues
    add constraint issues_color_hex
    check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

create index if not exists issues_project_starts_idx
    on tracker.issues(project_id, starts_at);

-- ─── per-project status colour palette ────────────────────────────────────
-- Lets the user override the default status→colour map. Falls back
-- to the UI's hardcoded defaults (purple = open, amber = waiting,
-- red = blocked, etc) when no row is present.
create table if not exists tracker.project_status_colors (
    project_id  uuid        not null references tracker.projects(id) on delete cascade,
    status      tracker.issue_status not null,
    color       text        not null,
    updated_at  timestamptz not null default now(),
    primary key (project_id, status),
    constraint psc_color_hex check (color ~ '^#[0-9a-fA-F]{6}$')
);

drop trigger if exists touch_project_status_colors on tracker.project_status_colors;
create trigger touch_project_status_colors
    before update on tracker.project_status_colors
    for each row execute function tracker.touch_updated_at();

-- ─── per-project label→icon map ───────────────────────────────────────────
-- icon_name is an Iconly Bold icon identifier (see lib/iconly.ts in
-- the app). Required before a label can render on the timeline.
create table if not exists tracker.project_label_icons (
    project_id  uuid        not null references tracker.projects(id) on delete cascade,
    label       text        not null,
    icon_name   text        not null,
    color       text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    primary key (project_id, label),
    constraint pli_label_not_empty check (length(trim(label)) > 0),
    constraint pli_color_hex       check (color is null or color ~ '^#[0-9a-fA-F]{6}$')
);

drop trigger if exists touch_project_label_icons on tracker.project_label_icons;
create trigger touch_project_label_icons
    before update on tracker.project_label_icons
    for each row execute function tracker.touch_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────
alter table tracker.project_status_colors enable row level security;
alter table tracker.project_label_icons   enable row level security;

drop policy if exists project_status_colors_owner_all on tracker.project_status_colors;
create policy project_status_colors_owner_all on tracker.project_status_colors
    for all
    using      (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()))
    with check (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()));

drop policy if exists project_label_icons_owner_all on tracker.project_label_icons;
create policy project_label_icons_owner_all on tracker.project_label_icons
    for all
    using      (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()))
    with check (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()));

grant all on tracker.project_status_colors to authenticated, service_role;
grant all on tracker.project_label_icons   to authenticated, service_role;


-- ═══ MIGRATION: 0028_icon_catalog.sql ═══

-- Icon catalog with embeddings — global, read-only reference data
-- used by the icon picker's semantic search.
--
-- Why a separate table:
--   Icons are not user-owned. Every project shares the same Iconly
--   set, so there's nothing to scope per-user. One row per icon,
--   populated once by scripts/embed-icons.ts and refreshed only
--   when icons get added.
--
-- Columns:
--   name        — kebab-case canonical slug, matches the
--                 ICONLY_LOADERS key (e.g. "add-user", "rain-drop").
--                 This is what gets stored in
--                 project_label_icons.icon_name.
--   tags        — flat list of plain-English keywords; what we feed
--                 to the embedder along with `description`.
--   description — short one-liner ("a raindrop, used for weather,
--                 water, precipitation"). Optional — we ship without
--                 LLM expansion in v1, but keep the column so a later
--                 pass can fill it in without a schema change.
--   embedding   — 1536-dim text-embedding-3-small vector. Same model
--                 as project summary embeddings so a single embedder
--                 config covers both.
--   model       — model name that produced `embedding`. Lets a future
--                 re-embed sweep target old rows.
--   updated_at  — touched on upsert.

create table if not exists tracker.icon_catalog (
    name        text primary key,
    tags        text[]        not null default '{}',
    description text,
    embedding   vector(1536),
    model       text,
    updated_at  timestamptz   not null default now()
);

create index if not exists icon_catalog_embedding_hnsw_idx
    on tracker.icon_catalog
    using hnsw (embedding vector_cosine_ops)
    where embedding is not null;

-- The catalog is global reference data — every signed-in user
-- needs to read it from the picker. RLS on, with a permissive
-- read policy. Writes happen via the service-role key from the
-- one-shot embed script, which bypasses RLS.
alter table tracker.icon_catalog enable row level security;

drop policy if exists icon_catalog_read_all on tracker.icon_catalog;
create policy icon_catalog_read_all on tracker.icon_catalog
    for select to authenticated, anon
    using (true);

grant select on tracker.icon_catalog to authenticated, anon;
grant all    on tracker.icon_catalog to service_role;

-- Similarity RPC: rank icons by cosine similarity to a query vector.
-- security_invoker so the read policy above gates access. Empty
-- catalog or unembedded rows return nothing.
create or replace function tracker.find_similar_icons(
    p_embedding vector(1536),
    p_limit     int default 60
)
returns table (
    name       text,
    similarity float
)
language sql
stable
security invoker
set search_path = tracker, public
as $$
    select
        c.name,
        1 - (c.embedding <=> p_embedding) as similarity
    from tracker.icon_catalog c
    where c.embedding is not null
    order by c.embedding <=> p_embedding
    limit p_limit;
$$;

grant execute on function tracker.find_similar_icons(vector(1536), int)
    to authenticated, anon, service_role;


-- ═══ MIGRATION: 0029_icon_search_cache.sql ═══

-- Cross-session cache for icon search queries.
--
-- Why this exists:
--   The hot path on /api/icons/search is the embedding call to the
--   analyser (which is in turn an OpenAI round-trip). The catalog
--   is essentially static, so the same query maps to the same set
--   of icons every time. Caching the resolved hits per query lets
--   every signed-in user benefit from anyone else's previous
--   search — typing "weather" once warms the cache for everyone.
--
-- Catalog-drift caveat:
--   `hits` are baked at insert time. If the catalog or its
--   embeddings change materially, truncate this table so stale
--   rankings don't linger. The label-icons → embed-icons pipeline
--   is the only thing that should trigger that.
--
-- Access shape:
--   Reads + writes go through the service-role client inside the
--   API route (lib/supabase/server.ts createServiceClient). Browser
--   clients never touch this table directly, so we don't need a
--   policy — RLS stays on as a safety net.

create table if not exists tracker.icon_search_cache (
    query        text primary key,
    hits         jsonb       not null,
    model        text        not null,
    created_at   timestamptz not null default now(),
    last_used_at timestamptz not null default now(),
    hit_count    int         not null default 1
);

-- Cheap LRU support — pick this column when we ever want to evict
-- the bottom of the table.
create index if not exists icon_search_cache_last_used_idx
    on tracker.icon_search_cache(last_used_at);

alter table tracker.icon_search_cache enable row level security;
grant all on tracker.icon_search_cache to service_role;


-- ═══ MIGRATION: 0030_icon_catalog_versioning.sql ═══

-- Catalog/index version stamp + per-row cache versioning so a
-- re-embed run automatically invalidates downstream caches.
--
-- Why this exists:
--   icon_search_cache stores baked similarity rankings per query.
--   When scripts/embed-icons.ts re-embeds the catalog, those
--   rankings are stale but there's no per-row signal saying so —
--   today the operator has to TRUNCATE the table by hand. We
--   instead stamp a `version` on every cache row + read the
--   currently-active version at request time, so old rows fall
--   out of consideration on their own. Same value travels in the
--   API response so browsers can drop their in-memory cache too.
--
-- Lifecycle:
--   - Single-row meta table holds the active version.
--   - The embed script bumps it (new uuid) at the end of a run.
--   - The search route filters cache lookups by that version and
--     writes the current version on insert.

create table if not exists tracker.icon_catalog_meta (
    id          int primary key default 1,
    version     text not null default gen_random_uuid()::text,
    updated_at  timestamptz not null default now(),
    constraint icon_catalog_meta_singleton check (id = 1)
);

-- Ensure exactly one row exists.
insert into tracker.icon_catalog_meta (id) values (1)
on conflict (id) do nothing;

alter table tracker.icon_catalog_meta enable row level security;

drop policy if exists icon_catalog_meta_read_all on tracker.icon_catalog_meta;
create policy icon_catalog_meta_read_all on tracker.icon_catalog_meta
    for select to authenticated, anon
    using (true);

grant select on tracker.icon_catalog_meta to authenticated, anon;
grant all    on tracker.icon_catalog_meta to service_role;

-- Per-row version on the existing cache table. Pre-migration rows
-- get NULL — the route treats those as stale (will re-embed and
-- overwrite on next access).
alter table tracker.icon_search_cache
    add column if not exists version text;

create index if not exists icon_search_cache_version_idx
    on tracker.icon_search_cache(version);


-- ═══ MIGRATION: 0031_github_tokens.sql ═══

-- tracker.github_tokens — captures the GitHub OAuth provider token from
-- the Supabase auth callback so the app can (a) list the user's repos
-- when adding a project and (b) hand a short-lived clone credential to
-- bobby-analyser for private repos.
--
-- Supabase exposes `provider_token` / `provider_refresh_token` only in
-- the session that comes out of the OAuth callback; if we want them
-- afterwards we have to persist them ourselves. RLS keeps each user
-- locked to their own row.

create table if not exists tracker.github_tokens (
    user_id           uuid        primary key references auth.users(id) on delete cascade,
    -- GitHub access token (classic OAuth: long-lived, no expiry).
    access_token      text        not null,
    -- GitHub refresh token. Always null today (classic OAuth doesn't
    -- issue one); reserved for the GitHub-App migration so we don't
    -- have to add a column later.
    refresh_token     text,
    -- Space-separated OAuth scopes returned by GitHub. We compare
    -- against this to decide whether to prompt the user to reconnect
    -- with broader scope (e.g. missing `repo`).
    scopes            text,
    -- Stable GitHub numeric user id, captured for diagnostics.
    provider_user_id  text,
    -- GitHub login, for showing "connected as @octocat" in the UI.
    provider_login    text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

drop trigger if exists touch_github_tokens on tracker.github_tokens;
create trigger touch_github_tokens
    before update on tracker.github_tokens
    for each row execute function tracker.touch_updated_at();

alter table tracker.github_tokens enable row level security;

drop policy if exists github_tokens_owner_select on tracker.github_tokens;
create policy github_tokens_owner_select on tracker.github_tokens
    for select using (user_id = auth.uid());

drop policy if exists github_tokens_owner_insert on tracker.github_tokens;
create policy github_tokens_owner_insert on tracker.github_tokens
    for insert with check (user_id = auth.uid());

drop policy if exists github_tokens_owner_update on tracker.github_tokens;
create policy github_tokens_owner_update on tracker.github_tokens
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists github_tokens_owner_delete on tracker.github_tokens;
create policy github_tokens_owner_delete on tracker.github_tokens
    for delete using (user_id = auth.uid());

grant all on tracker.github_tokens to authenticated, service_role;


-- ═══ MIGRATION: 0032_issue_analyse_effort.sql ═══

-- Per-issue analyser effort. Lets a creator pick how thorough the analyser
-- should be when investigating THIS issue (set from the create-issue modal's
-- advanced settings, overridable per-run from the suggestions popover).
--
-- Stored on the issue so the choice survives the navigation to the issue's
-- detail page (where the first analysis auto-fires) and any later reload.
-- Null means "no per-issue choice" — the analyse call omits effort entirely
-- and the analyser falls back to the project default, then its own default.
-- Values mirror lib/analyser.ts AnalyseEffort (distinct from the indexing
-- effort): fast | medium | high | veryhigh.

alter table tracker.issues
    add column if not exists analyse_effort text;

alter table tracker.issues
    drop constraint if exists issues_analyse_effort_valid;
alter table tracker.issues
    add constraint issues_analyse_effort_valid
    check (analyse_effort is null or analyse_effort in ('fast', 'medium', 'high', 'veryhigh'));


-- ═══ MIGRATION: 0033_relay_workers.sql ═══

-- tracker.relay_workers + tracker.relay_pairings — the bobby-relay
-- menubar app's device-pairing and worker-management backing store.
--
-- A "worker" is a user's local machine that exposes a local LLM to the
-- bobby-analyser server. The relay app has no Supabase session, so it
-- pairs via an OAuth-device-flow-style handshake: it POSTs /relay/pair/start
-- to mint a (device_code, user_code) pair, the user approves the user_code
-- while signed into the tracker, and the relay polls /relay/pair/poll to
-- collect the opaque worker token. The analyser later resolves that token
-- back to a userId via /relay/resolve. Revoking a worker (revoked_at) stops
-- the token resolving, which makes revoke real.
--
-- RLS locks each user to their own workers/pairings. The unauthenticated
-- relay endpoints (pair/start, pair/poll, resolve) run through the
-- service-role client, which bypasses RLS.

create table if not exists tracker.relay_workers (
    id            uuid        primary key default gen_random_uuid(),
    user_id       uuid        not null references auth.users(id) on delete cascade,
    -- Human-friendly device label shown in the workers UI.
    name          text        not null default 'My Mac',
    -- Opaque bearer token the relay presents to the analyser. The
    -- analyser resolves it to user_id via /relay/resolve. Unique so a
    -- token maps to exactly one worker.
    token         text        not null unique,
    -- Last known reachable endpoint for the local LLM, when the relay
    -- reports one. Null until the relay connects.
    endpoint      text,
    -- Models the worker advertises: [{id, supportsTools?, contextWindow?}].
    models        jsonb       not null default '[]'::jsonb,
    created_at    timestamptz not null default now(),
    -- Bumped by /relay/resolve so the UI can show recency.
    last_seen_at  timestamptz,
    -- Set on revoke; revoked rows stop resolving and drop out of the UI.
    revoked_at    timestamptz
);

create index if not exists relay_workers_user_id_idx on tracker.relay_workers (user_id);

alter table tracker.relay_workers enable row level security;

drop policy if exists relay_workers_owner_select on tracker.relay_workers;
create policy relay_workers_owner_select on tracker.relay_workers
    for select using (user_id = auth.uid());

drop policy if exists relay_workers_owner_insert on tracker.relay_workers;
create policy relay_workers_owner_insert on tracker.relay_workers
    for insert with check (user_id = auth.uid());

drop policy if exists relay_workers_owner_update on tracker.relay_workers;
create policy relay_workers_owner_update on tracker.relay_workers
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists relay_workers_owner_delete on tracker.relay_workers;
create policy relay_workers_owner_delete on tracker.relay_workers
    for delete using (user_id = auth.uid());

grant all on tracker.relay_workers to authenticated, service_role;

create table if not exists tracker.relay_pairings (
    id            uuid        primary key default gen_random_uuid(),
    -- Secret the relay polls with. Never shown to the user.
    device_code   text        not null unique,
    -- Short code the user types/approves while signed into the tracker.
    user_code     text        not null unique,
    -- Bound on approval (the approving user).
    user_id       uuid        references auth.users(id) on delete cascade,
    -- The worker minted on approval.
    worker_id     uuid        references tracker.relay_workers(id) on delete set null,
    status        text        not null default 'pending'
                  check (status in ('pending', 'approved', 'denied', 'expired', 'consumed')),
    -- Suggested device name carried from pair/start to the minted worker.
    worker_name   text,
    created_at    timestamptz not null default now(),
    expires_at    timestamptz not null,
    approved_at   timestamptz,
    consumed_at   timestamptz
);

alter table tracker.relay_pairings enable row level security;

-- pair/start + poll operate via service_role before a user_id is bound;
-- the owner policies only cover rows already claimed by a user.
drop policy if exists relay_pairings_owner_select on tracker.relay_pairings;
create policy relay_pairings_owner_select on tracker.relay_pairings
    for select using (user_id = auth.uid());

drop policy if exists relay_pairings_owner_update on tracker.relay_pairings;
create policy relay_pairings_owner_update on tracker.relay_pairings
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());

grant all on tracker.relay_pairings to authenticated, service_role;


-- ═══ MIGRATION: 0034_issue_search_service.sql ═══

-- 0034_issue_search_service.sql
--
-- Trusted, service-role issue similarity search for bobby-analyser's chat
-- "mind" endpoint (analyser ADR-0048).
--
-- The analyser's /chat thinker can choose an "issues" action: it embeds the
-- user's question via /embeddings and needs to nearest-neighbor it against this
-- project's issue vectors. It calls the analyser -> Supabase over PostgREST with
-- the SERVICE-ROLE key (the same trust level already used to upsert
-- issue_embeddings in lib/issue-embedding.ts).
--
-- Why a new function instead of reusing tracker.find_similar_issues (0015):
-- that one is security-definer and gated on `p.user_id = auth.uid()`. A
-- service-role call carries no user JWT, so auth.uid() is null and the guard
-- raises. This function is security-INVOKER and EXECUTE is granted only to
-- service_role, so:
--   * the trusted backend can run it (service_role bypasses table RLS and sees
--     all rows), scoped explicitly by p_project_id;
--   * anon / authenticated callers cannot invoke it at all (no EXECUTE grant),
--     so it can't be used to read another user's issues from the browser.
-- The tracker's mind route (app/api/projects/[id]/mind/route.ts) authenticates
-- the user and confirms project ownership before ever asking the analyser to
-- search, so the project scope passed here is already authorized.
--
-- Returns `body` too (unlike find_similar_issues) so the analyser's finaliser
-- has enough context to judge relevance and summarize. Excludes issues marked as
-- duplicates so they don't dominate results.

create or replace function tracker.match_project_issues(
    p_project_id uuid,
    p_embedding  vector(1536),
    p_limit      int default 5
)
returns table (
    id           uuid,
    issue_number int,
    title        text,
    body         text,
    status       text,
    similarity   float
)
language sql
stable
security invoker
set search_path = tracker, public
as $$
    select
        i.id,
        i.issue_number,
        i.title,
        i.body,
        i.status::text,
        1 - (e.embedding <=> p_embedding) as similarity
    from tracker.issues i
        join tracker.issue_embeddings e on e.issue_id = i.id
    where i.project_id = p_project_id
      and i.duplicate_of_issue_id is null
    order by e.embedding <=> p_embedding
    limit p_limit;
$$;

-- Lock the function down to the trusted backend only.
revoke execute on function tracker.match_project_issues(uuid, vector, int) from public;
revoke execute on function tracker.match_project_issues(uuid, vector, int) from anon, authenticated;
grant  execute on function tracker.match_project_issues(uuid, vector, int) to service_role;


-- ═══ MIGRATION: 0035_mind_context.sql ═══

-- 0035_mind_context.sql
--
-- Managed-context store for the Mind chat's background context agent
-- (analyser ADR-0049).
--
-- The analyser splits chat memory in two: a short TEMPORAL buffer (the last few
-- raw turns, client-carried) and this durable MANAGED store. After each answer,
-- a background agent in the analyser rationalizes the turn into a compact,
-- structured memory — current goals, cited files with a short "why", issues in
-- focus — pruning stale entries. The next turn's thinker + finaliser read it so
-- follow-ups reuse context instead of re-retrieving.
--
-- Ownership + access: the analyser reads/writes this table over PostgREST with
-- the SERVICE-ROLE key (same trust level it already uses for issue embeddings
-- and progress). The tracker UI never touches it — it's internal plumbing — so
-- RLS is enabled with NO policies: anon/authenticated get nothing, and
-- service_role bypasses RLS. One row per conversation, upserted on
-- conversation_id.
--
-- conversation_id is generated client-side per conversation. Rows are not tied
-- to a persisted chat (the chat itself lives in client state today), so on a
-- fresh conversation a new id is minted; old rows are harmless orphans. A future
-- cleanup sweep can prune by updated_at if needed.

create table if not exists tracker.mind_context (
    conversation_id uuid        primary key,
    project_id      uuid        references tracker.projects(id) on delete cascade,
    context         jsonb       not null default '{}'::jsonb,
    turn            int         not null default 0,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- Helps a future TTL/cleanup sweep and per-project inspection.
create index if not exists mind_context_project_idx on tracker.mind_context (project_id);

alter table tracker.mind_context enable row level security;
-- No policies on purpose: only the service-role backend (which bypasses RLS)
-- may read or write this internal store.


-- ═══ MIGRATION: 0036_github_installations.sql ═══

-- tracker.github_installations — the "Bobby" GitHub App installation
-- registry and installation-token cache backing the two-way issue sync.
--
-- When a user installs the Bobby GitHub App, the install callback and the
-- `installation` webhook record the installation here. The row carries the
-- installation-token cache (`cached_token`/`token_expires_at`) so
-- lib/github-app.ts can reuse a short-lived installation access token
-- across requests instead of re-minting on every call — a DB-column cache
-- is strongly consistent and needs no new infra (no KV binding in v1).
--
-- `user_id` is set only by the install callback, the one flow that knows
-- which tracker user installed the app; webhook-driven upserts leave it
-- untouched. RLS lets a user read their own installations; all writes go
-- through the service-role client (install callback + webhook), which
-- bypasses RLS. suspended_at / deleted_at are soft-delete lifecycle
-- markers driven by the `installation` webhook (suspend / unsuspend /
-- deleted actions).

create table if not exists tracker.github_installations (
    -- GitHub's numeric installation id — the stable join key we key
    -- installation tokens and repo lookups on.
    installation_id   bigint      primary key,
    -- Set by the install callback (the only flow that knows the tracker
    -- user); null for installations only ever seen via webhook.
    user_id           uuid        references auth.users(id) on delete cascade,
    -- The GitHub account (user or org) the app is installed on.
    account_login     text,
    account_type      text,
    account_id        bigint,
    -- Installation access token cache. Short-lived (~1h); re-minted with
    -- a 5-min safety margin by lib/github-app.ts.
    cached_token      text,
    token_expires_at  timestamptz,
    -- Soft-delete lifecycle, driven by the `installation` webhook.
    suspended_at      timestamptz,
    deleted_at        timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index if not exists github_installations_user_id_idx
    on tracker.github_installations (user_id);

drop trigger if exists touch_github_installations on tracker.github_installations;
create trigger touch_github_installations
    before update on tracker.github_installations
    for each row execute function tracker.touch_updated_at();

alter table tracker.github_installations enable row level security;

-- Owner-select only; writes are service-role (install callback + webhook).
drop policy if exists github_installations_owner_select on tracker.github_installations;
create policy github_installations_owner_select on tracker.github_installations
    for select using (user_id = auth.uid());

grant all on tracker.github_installations to authenticated, service_role;


-- ═══ MIGRATION: 0037_projects_github_sync.sql ═══

-- Link tracker.projects to a GitHub App installation + repo, and add the
-- per-project two-way-sync toggle.
--
-- We store the GitHub numeric repo id (github_repo_id), not the
-- owner/repo string, because the numeric id is stable across renames and
-- transfers — it's the reliable join key for routing an inbound `issues`
-- webhook back to a project. github_installation_id points at the
-- installation whose token can act on that repo. github_sync_enabled is
-- kept separate from project_analyser.enabled: indexing and issue sync are
-- orthogonal, and this flag alone gates both inbound routing and outbound
-- pushes.
--
-- The partial unique index enforces one project per repo (where a repo is
-- linked at all), so inbound webhook routing is unambiguous. Existing
-- owner RLS on tracker.projects already covers these new columns.

alter table tracker.projects
    add column if not exists github_installation_id bigint
        references tracker.github_installations(installation_id),
    add column if not exists github_repo_id         bigint,
    add column if not exists github_sync_enabled     boolean not null default false;

-- One project per linked repo → unambiguous inbound routing. Partial so
-- unlinked projects (github_repo_id is null) don't collide with each other.
create unique index if not exists projects_github_repo_id_uniq
    on tracker.projects (github_repo_id)
    where github_repo_id is not null;


-- ═══ MIGRATION: 0038_issue_sync_state.sql ═══

-- Per-issue GitHub sync state, for echo suppression and provenance.
--
-- github_issue_number / github_node_id already exist (migration 0001);
-- this migration adds the columns that make two-way sync loop-safe:
--   * sync_source     — which side last wrote this row ('tracker' | 'github').
--   * last_synced_hash — syncHash(normalized title|body|state) of the last
--                        value we pushed/ingested. An inbound webhook whose
--                        hash matches this is our own echo → dropped. Hash-
--                        based (not a time window) so it survives GitHub's
--                        delivery lag.
--   * github_synced_at — when this row last round-tripped with GitHub.
-- All nullable so pre-existing issues (never synced) stay untouched.

alter table tracker.issues
    add column if not exists github_synced_at timestamptz,
    add column if not exists sync_source      text,
    add column if not exists last_synced_hash text;

alter table tracker.issues
    drop constraint if exists issues_sync_source_valid;
alter table tracker.issues
    add constraint issues_sync_source_valid
    check (sync_source is null or sync_source in ('tracker', 'github'));


-- ═══ MIGRATION: 0039_github_webhook_deliveries.sql ═══

-- tracker.github_webhook_deliveries — redelivery idempotency ledger.
--
-- GitHub sends a unique X-GitHub-Delivery id per webhook delivery and
-- retries/redelivers on failure or via the manual "Redeliver" button. The
-- webhook route inserts the delivery id here before processing; a
-- unique-violation on the primary key means "already handled" → the route
-- returns 202 without re-applying the event. This is the first line of
-- loop/duplicate prevention (content-hash echo suppression is the second).
--
-- Written only by the webhook route via the service-role client; there is
-- no per-user ownership, so RLS is enabled with no policies (service_role
-- bypasses RLS; authenticated clients get nothing).

create table if not exists tracker.github_webhook_deliveries (
    -- GitHub's X-GitHub-Delivery header — globally unique per delivery.
    delivery_id   text        primary key,
    -- The X-GitHub-Event value, kept for diagnostics.
    event         text,
    received_at   timestamptz not null default now()
);

alter table tracker.github_webhook_deliveries enable row level security;

grant all on tracker.github_webhook_deliveries to authenticated, service_role;


-- ═══ MIGRATION: 0040_issue_analysis_comment.sql ═══

-- Live GitHub analysis comment: track the placeholder comment we post on an
-- issue and the state of the (durable, analyser-owned) analysis run so the
-- callback can edit that comment in place.
--
--   * github_analysis_comment_id — the GitHub comment id of the "analysing…"
--     placeholder we posted; the analyser's result callback edits it in place.
--   * analysis_status — lifecycle of the detached run:
--       'analysing' → 'done' | 'failed' | 'cancelled' (cancelled = issue closed
--       mid-run). Null for issues that never triggered an analysis.
-- Both nullable so existing issues are untouched.

alter table tracker.issues
    add column if not exists github_analysis_comment_id bigint,
    add column if not exists analysis_status            text;

alter table tracker.issues
    drop constraint if exists issues_analysis_status_valid;
alter table tracker.issues
    add constraint issues_analysis_status_valid
    check (analysis_status is null or analysis_status in ('analysing', 'done', 'failed', 'cancelled'));


-- ═══ MIGRATION: 0041_github_sync_settings.sql ═══

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


-- ═══ MIGRATION: 0042_pull_request_analyses.sql ═══

-- tracker.pull_request_analyses — tracks Bobby's analysis of a GitHub PR so the
-- live comment can be edited in place and the run cancelled.
--
-- One row per (project, pr_number). id doubles as the analyser task_id (used to
-- correlate the result callback and to cancel). github_comment_id is the
-- placeholder comment Bobby posts; the callback edits it. head_sha lets us skip
-- redundant re-runs when a `synchronize` event carries the same head. status
-- mirrors the detached run lifecycle.
--
-- Written by the webhook + callback via the service-role client; owner-readable.

create table if not exists tracker.pull_request_analyses (
    id                uuid        primary key default gen_random_uuid(),
    project_id        uuid        not null references tracker.projects(id) on delete cascade,
    pr_number         int         not null,
    github_comment_id bigint,
    head_sha          text,
    status            text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint pull_request_analyses_project_pr_uniq unique (project_id, pr_number),
    constraint pull_request_analyses_status_valid
        check (status is null or status in ('analysing', 'done', 'failed', 'cancelled'))
);

create index if not exists pull_request_analyses_project_idx
    on tracker.pull_request_analyses (project_id);

drop trigger if exists touch_pull_request_analyses on tracker.pull_request_analyses;
create trigger touch_pull_request_analyses
    before update on tracker.pull_request_analyses
    for each row execute function tracker.touch_updated_at();

alter table tracker.pull_request_analyses enable row level security;

-- Owner-select (through project ownership); all writes are service-role.
drop policy if exists pull_request_analyses_owner_select on tracker.pull_request_analyses;
create policy pull_request_analyses_owner_select on tracker.pull_request_analyses
    for select using (
        exists (
            select 1 from tracker.projects p
            where p.id = pull_request_analyses.project_id and p.user_id = auth.uid()
        )
    );

grant all on tracker.pull_request_analyses to authenticated, service_role;


-- ═══ MIGRATION: 0043_pull_requests.sql ═══

-- tracker.pull_requests + tracker.pr_comments — a queryable mirror of a repo's
-- pull requests and their GitHub comment threads, so the app can render a
-- Pull-requests tab (list + detail + comments) without hitting GitHub on every
-- view. Populated by the webhook (pull_request / issue_comment /
-- pull_request_review events) and a one-off backfill (lib/pr-backfill.ts).
--
-- Mirrors 0042_pull_request_analyses: written by the webhook + backfill via the
-- service-role client; owner-readable through project ownership; all writes are
-- service-role. The analysis *run* still lives in pull_request_analyses (its id
-- is the analyser task_id); this migration also adds `result` there so the
-- structured review is persisted, not just rendered into a GitHub comment.

-- ── pull_requests ───────────────────────────────────────────────────────────
create table if not exists tracker.pull_requests (
    id                uuid        primary key default gen_random_uuid(),
    project_id        uuid        not null references tracker.projects(id) on delete cascade,
    pr_number         int         not null,
    github_node_id    text,
    title             text        not null default '',
    body              text,
    state             text        not null default 'open',
    merged            boolean     not null default false,
    draft             boolean     not null default false,
    author_login      text,
    author_avatar_url text,
    html_url          text,
    head_ref          text,
    base_ref          text,
    head_sha          text,
    base_sha          text,
    additions         int,
    deletions         int,
    changed_files     int,
    comments_count    int,
    gh_created_at     timestamptz,
    gh_updated_at     timestamptz,
    closed_at         timestamptz,
    merged_at         timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint pull_requests_project_pr_uniq unique (project_id, pr_number),
    constraint pull_requests_state_valid check (state in ('open', 'closed'))
);

create index if not exists pull_requests_project_idx
    on tracker.pull_requests (project_id);

drop trigger if exists touch_pull_requests on tracker.pull_requests;
create trigger touch_pull_requests
    before update on tracker.pull_requests
    for each row execute function tracker.touch_updated_at();

alter table tracker.pull_requests enable row level security;

drop policy if exists pull_requests_owner_select on tracker.pull_requests;
create policy pull_requests_owner_select on tracker.pull_requests
    for select using (
        exists (
            select 1 from tracker.projects p
            where p.id = pull_requests.project_id and p.user_id = auth.uid()
        )
    );

grant all on tracker.pull_requests to authenticated, service_role;

-- ── pr_comments ─────────────────────────────────────────────────────────────
-- One row per GitHub comment on a PR. `source` disambiguates the id spaces:
-- 'issue_comment' (the PR conversation thread, incl. Bobby's own bot comment),
-- 'review' (a review's summary body), 'review_comment' (inline diff comments —
-- reserved for a later iteration). Uniqueness is per (project, source, id).
create table if not exists tracker.pr_comments (
    id                uuid        primary key default gen_random_uuid(),
    project_id        uuid        not null references tracker.projects(id) on delete cascade,
    pr_number         int         not null,
    source            text        not null,
    github_comment_id bigint      not null,
    author_login      text,
    author_avatar_url text,
    body              text,
    html_url          text,
    gh_created_at     timestamptz,
    gh_updated_at     timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint pr_comments_source_id_uniq unique (project_id, source, github_comment_id),
    constraint pr_comments_source_valid
        check (source in ('issue_comment', 'review', 'review_comment'))
);

create index if not exists pr_comments_project_pr_idx
    on tracker.pr_comments (project_id, pr_number);

drop trigger if exists touch_pr_comments on tracker.pr_comments;
create trigger touch_pr_comments
    before update on tracker.pr_comments
    for each row execute function tracker.touch_updated_at();

alter table tracker.pr_comments enable row level security;

drop policy if exists pr_comments_owner_select on tracker.pr_comments;
create policy pr_comments_owner_select on tracker.pr_comments
    for select using (
        exists (
            select 1 from tracker.projects p
            where p.id = pr_comments.project_id and p.user_id = auth.uid()
        )
    );

grant all on tracker.pr_comments to authenticated, service_role;

-- ── persist the structured review ───────────────────────────────────────────
-- Bobby's PR review was only ever rendered into the live GitHub comment; store
-- it so the detail page can render it natively (summary/impact/fix-claims/…).
alter table tracker.pull_request_analyses
    add column if not exists result jsonb;


-- ═══ MIGRATION: 0044_comment_provenance.sql ═══

-- Two-way comment provenance: distinguish comments authored in the tracker (and
-- posted to GitHub as the real user) from comments mirrored from GitHub. Extends
-- pr_comments (0043) and adds a parallel issue_comments table for issue threads.
--
-- Ownership is single-writer by provenance: 'github' rows are read-only mirrors;
-- 'tracker' rows are authored/edited/deleted in-app by author_user_id and pushed
-- to GitHub. The webhook skips rows it already holds as 'tracker' (echo
-- suppression), so a tracker comment bouncing back never overwrites our copy.

-- ── pr_comments: add provenance + author ────────────────────────────────────
alter table tracker.pr_comments
    add column if not exists provenance     text not null default 'github',
    add column if not exists author_user_id uuid references auth.users(id) on delete set null;

alter table tracker.pr_comments
    drop constraint if exists pr_comments_provenance_valid;
alter table tracker.pr_comments
    add constraint pr_comments_provenance_valid check (provenance in ('github', 'tracker'));

-- ── issue_comments (mirror of pr_comments, conversation-only) ────────────────
create table if not exists tracker.issue_comments (
    id                uuid        primary key default gen_random_uuid(),
    project_id        uuid        not null references tracker.projects(id) on delete cascade,
    issue_number      int         not null,
    github_comment_id bigint      not null,
    provenance        text        not null default 'github',
    author_user_id    uuid        references auth.users(id) on delete set null,
    author_login      text,
    author_avatar_url text,
    body              text,
    html_url          text,
    gh_created_at     timestamptz,
    gh_updated_at     timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint issue_comments_id_uniq unique (project_id, github_comment_id),
    constraint issue_comments_provenance_valid check (provenance in ('github', 'tracker'))
);

create index if not exists issue_comments_project_issue_idx
    on tracker.issue_comments (project_id, issue_number);

drop trigger if exists touch_issue_comments on tracker.issue_comments;
create trigger touch_issue_comments
    before update on tracker.issue_comments
    for each row execute function tracker.touch_updated_at();

alter table tracker.issue_comments enable row level security;

drop policy if exists issue_comments_owner_select on tracker.issue_comments;
create policy issue_comments_owner_select on tracker.issue_comments
    for select using (
        exists (
            select 1 from tracker.projects p
            where p.id = issue_comments.project_id and p.user_id = auth.uid()
        )
    );

grant all on tracker.issue_comments to authenticated, service_role;


-- ═══ MIGRATION: 0045_pr_review_index.sql ═══

-- tracker.pr_review_index — the Phase-5 institutional-memory index the
-- bobby-analyser's KB-grounded PR reviewer populates (analyser ADR-0057).
--
-- After each PR review the analyser upserts one row per reviewed file, recording
-- the merge verdict and the finding categories it raised. Keyed by the analyser
-- graph id (`repo_id`, == tracker.project_analyser.graph_id) rather than a
-- tracker project id, because the analyser is GitHub-/tracker-agnostic and only
-- knows the graph it reviewed against. This lets a later review of the same file
-- surface "we've seen churn here before" and, once the revert-feedback wire lands
-- (see below), learn which past reviews shipped changes that were later backed
-- out — the signal Phase 5 uses to calibrate its own confidence.
--
-- The analyser writes AND reads via the service role (which bypasses RLS); RLS
-- here only governs owner-facing reads in-app. Ownership is derived by joining
-- the graph id back to a project the caller owns (through project_analyser).
--
-- REVERT-FEEDBACK WIRE (not built yet — hook only): when a merged PR is later
-- reverted, the tracker should flip `reverted` on every row for that PR:
--
--     update tracker.pr_review_index
--        set reverted = true, updated_at = now()
--      where repo_id = <graph_id> and pr_number = <n>;
--
-- Detecting the revert (a "Revert \"…\"" PR merging, or the analyser reporting it)
-- is deliberately out of scope for this migration — this is only the column +
-- index the flip targets. See analyser ADR-0057 Phase 5.

create table if not exists tracker.pr_review_index (
    id           uuid        primary key default gen_random_uuid(),
    -- Analyser graph id (== tracker.project_analyser.graph_id). Plain text, not
    -- an FK: the analyser owns the graph-id namespace and may write before the
    -- tracker has materialised a matching project_analyser row.
    repo_id      text        not null,
    pr_number    int         not null,
    -- Repo-relative path of the reviewed file. One row per (repo, pr, file).
    file         text        not null,
    -- PR title + merge verdict at review time (snapshotted for the reverse lookup
    -- so we don't re-join to pull_request_analyses).
    title        text,
    verdict      text,
    -- Finding categories raised on this file, as a JSON string[] (e.g.
    -- ["convention","test_gap"]). Defaults to an empty array.
    finding_tags jsonb       not null default '[]'::jsonb,
    -- Flipped true by the tracker when the PR that touched this file is later
    -- reverted (see the revert-feedback wire above). Drives Phase-5 calibration.
    reverted     boolean     not null default false,
    updated_at   timestamptz not null default now(),
    -- The analyser upserts on this key with resolution=merge-duplicates.
    constraint pr_review_index_repo_pr_file_uniq unique (repo_id, pr_number, file)
);

-- Reverse lookup: "what have we reviewed about this file before?"
create index if not exists pr_review_index_repo_file_idx
    on tracker.pr_review_index (repo_id, file);

drop trigger if exists touch_pr_review_index on tracker.pr_review_index;
create trigger touch_pr_review_index
    before update on tracker.pr_review_index
    for each row execute function tracker.touch_updated_at();

alter table tracker.pr_review_index enable row level security;

-- Owner-select through the graph → project ownership chain; all writes are
-- service-role (the analyser populates; the tracker flips `reverted`).
drop policy if exists pr_review_index_owner_select on tracker.pr_review_index;
create policy pr_review_index_owner_select on tracker.pr_review_index
    for select using (
        exists (
            select 1
            from tracker.project_analyser pa
            join tracker.projects p on p.id = pa.project_id
            where pa.graph_id = pr_review_index.repo_id and p.user_id = auth.uid()
        )
    );

grant all on tracker.pr_review_index to authenticated, service_role;


-- ═══ MIGRATION: 0046_project_auto_index_on_push.sql ═══

-- Auto-index-on-push toggle. When on (the default), a push to the repo's
-- default branch triggers an incremental graph update via the GitHub App
-- webhook (bobby-analyser's coalescing update queue, ADR-0058). Orthogonal to
-- github_sync_enabled (issue/PR sync) and to project_analyser.enabled — a
-- project can auto-index without mirroring issues, or vice versa.
--
-- Default true so connected+indexed projects keep current with commits out of
-- the box; the push webhook still no-ops unless the App is installed and a
-- graph has been bootstrapped. Existing rows inherit true.

alter table tracker.projects
    add column if not exists auto_index_on_push boolean not null default true;


-- ═══ MIGRATION: 0047_project_insight.sql ═══

-- tracker.project_insight — a per-project read model for the projects-grid
-- tile footer. One row per project, maintained by triggers, so rendering the
-- listing is a single indexed row fetch per project instead of an aggregate
-- over every issue and PR the user owns.
--
-- WHY TRIGGERS, NOT THE WEBHOOK: the GitHub webhook is not the only writer to
-- tracker.issues, and not even the most important one. A user flipping an
-- issue to done in the app (app/api/issues/[id]/route.ts) fires no webhook at
-- all, yet it is the main driver of the tile's done/total footer. Today six
-- paths write issues — the UI create/patch/delete, the duplicate-of route, the
-- webhook, and the bulk importer in lib/github-sync.ts. A trigger covers all
-- six, including ones not written yet, and runs inside the same transaction as
-- the write: if the issue commits, the counter commits. No drift, no
-- reconciliation job, no cron (there is nowhere to run one — the OpenNext
-- worker has no scheduled handler).
--
-- The counters are deliberately *not* a hand-written transition matrix. Each
-- trigger computes the row's contribution before and after the change and
-- applies the delta, so the 6x6 status matrix collapses into three boolean
-- expressions that cannot drift out of sync with each other.
--
-- Time windows ("N PRs recently opened") are NOT stored as counts — no event
-- fires when a PR stops being recent. recent_pr_opens keeps the raw open
-- timestamps and the client filters by window at render, so a tile decays back
-- to done/total on its own with no refetch and no expiry job.

-- ── table ───────────────────────────────────────────────────────────────────
-- user_id is denormalised off projects so the RLS policy is a single-column
-- check rather than a cross-table EXISTS — same reasoning as 0005, and it
-- leaves the table Realtime-publishable later without a policy rewrite.
create table if not exists tracker.project_insight (
    project_id       uuid        primary key references tracker.projects(id) on delete cascade,
    user_id          uuid        not null references auth.users(id) on delete cascade,
    -- Live issues: status in (open, in_progress, blocked). Mirrors the app's
    -- existing isClosed() convention (done | archived | duplicated are closed).
    open_total       int         not null default 0,
    -- Completed only. 'duplicated' and 'archived' are closed but NOT done —
    -- they must not inflate the done/total denominator.
    done_total       int         not null default 0,
    urgent_open      int         not null default 0,
    -- When urgent_open last went up (created urgent, or escalated to urgent).
    last_urgent_at   timestamptz,
    -- Open timestamps of the 10 most recent non-draft PRs, newest first.
    recent_pr_opens  timestamptz[] not null default '{}',
    -- Newest issue/PR activity. The tile footer shows this; projects.updated_at
    -- is the project ROW's touch time and does not move when an issue does.
    last_activity_at timestamptz,
    updated_at       timestamptz not null default now(),
    constraint project_insight_counts_nonneg
        check (open_total >= 0 and done_total >= 0 and urgent_open >= 0)
);

create index if not exists project_insight_user_idx
    on tracker.project_insight (user_id);

alter table tracker.project_insight enable row level security;

-- Read-only to the owner. Every write goes through the security-definer
-- triggers below; nothing client-side may INSERT/UPDATE/DELETE.
drop policy if exists project_insight_owner_select on tracker.project_insight;
create policy project_insight_owner_select on tracker.project_insight
    for select using (user_id = auth.uid());

-- REQUIRED: 0001's `grant all on all tables in schema tracker` only covered the
-- tables that existed then — it does not apply to tables added later, so a new
-- table without its own grant fails with "permission denied for table" before
-- RLS is ever consulted. Every migration that adds a table repeats this.
--
-- SELECT only for authenticated: this is a derived read model, and the triggers
-- below are security definer, so they write it regardless. Withholding
-- INSERT/UPDATE/DELETE enforces "no client writes" at the privilege layer
-- rather than relying on the absence of a policy.
grant select on tracker.project_insight to authenticated;
grant all    on tracker.project_insight to service_role;

-- ── seed: every project always has an insight row ───────────────────────────
-- Guarantees the issue/PR triggers below can be plain UPDATEs that cannot
-- silently miss, and keeps the read path free of null-row special cases.
create or replace function tracker.seed_project_insight()
returns trigger language plpgsql security definer as $$
begin
    insert into tracker.project_insight (project_id, user_id)
    values (new.id, new.user_id)
    on conflict (project_id) do nothing;
    return null;
end $$;

drop trigger if exists seed_insight on tracker.projects;
create trigger seed_insight
    after insert on tracker.projects
    for each row execute function tracker.seed_project_insight();

-- ── issues → counters ───────────────────────────────────────────────────────
create or replace function tracker.apply_issue_insight()
returns trigger language plpgsql security definer as $$
declare
    d_open   int := 0;
    d_done   int := 0;
    d_urgent int := 0;
begin
    -- Re-parenting an issue would have to decrement one project and increment
    -- another. Nothing in the app does this; fail loudly rather than drift.
    if tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
        raise exception 'project_insight: moving an issue between projects is not supported';
    end if;

    -- The old row stops contributing...
    if tg_op in ('UPDATE', 'DELETE') then
        d_open   := d_open   - (old.status in ('open', 'in_progress', 'blocked'))::int;
        d_done   := d_done   - (old.status = 'done')::int;
        d_urgent := d_urgent - (old.priority = 'urgent'
                                and old.status in ('open', 'in_progress', 'blocked'))::int;
    end if;

    -- ...and the new row starts. INSERT/DELETE simply skip one side, so every
    -- status and priority transition falls out of the same two blocks.
    if tg_op in ('INSERT', 'UPDATE') then
        d_open   := d_open   + (new.status in ('open', 'in_progress', 'blocked'))::int;
        d_done   := d_done   + (new.status = 'done')::int;
        d_urgent := d_urgent + (new.priority = 'urgent'
                                and new.status in ('open', 'in_progress', 'blocked'))::int;
    end if;

    update tracker.project_insight set
        open_total       = greatest(open_total  + d_open,   0),
        done_total       = greatest(done_total  + d_done,   0),
        urgent_open      = greatest(urgent_open + d_urgent, 0),
        -- Rises on "urgent issue created" AND "issue escalated to urgent" —
        -- both are d_urgent > 0, so neither needs special-casing.
        last_urgent_at   = case when d_urgent > 0 then now() else last_urgent_at end,
        last_activity_at = greatest(last_activity_at, now()),
        updated_at       = now()
    where project_id = coalesce(new.project_id, old.project_id);

    return null;
end $$;

drop trigger if exists apply_insight on tracker.issues;
create trigger apply_insight
    after insert or update or delete on tracker.issues
    for each row execute function tracker.apply_issue_insight();

-- ── pull requests → recent-open window ──────────────────────────────────────
create or replace function tracker.apply_pr_insight()
returns trigger language plpgsql security definer as $$
begin
    update tracker.project_insight set
        -- Append only on a genuinely new PR. The webhook upserts, so
        -- `synchronize`/`closed` take the ON CONFLICT path and fire the UPDATE
        -- trigger, not INSERT — one append per PR, automatically. The 24h
        -- guard stops lib/pr-backfill.ts from stuffing the array with historic
        -- opens the first time a repo is connected.
        recent_pr_opens = case
            when tg_op = 'INSERT'
                 and not new.draft
                 and new.gh_created_at is not null
                 and new.gh_created_at > now() - interval '24 hours'
            then (array[new.gh_created_at] || recent_pr_opens)[1:10]
            else recent_pr_opens
        end,
        -- gh_updated_at (not now()) so backfilling months-old PRs doesn't
        -- report the project as active seconds ago. GREATEST ignores nulls.
        last_activity_at = greatest(last_activity_at, new.gh_updated_at, new.gh_created_at),
        updated_at       = now()
    where project_id = new.project_id;
    return null;
end $$;

drop trigger if exists apply_insight on tracker.pull_requests;
create trigger apply_insight
    after insert or update on tracker.pull_requests
    for each row execute function tracker.apply_pr_insight();

-- ── backfill ────────────────────────────────────────────────────────────────
-- Also the repair statement: re-run this body as an UPDATE if a counter is
-- ever suspected wrong. LATERAL (not a plain join) keeps issues and PRs from
-- multiplying each other into a cartesian product.
insert into tracker.project_insight
    (project_id, user_id, open_total, done_total, urgent_open,
     last_urgent_at, recent_pr_opens, last_activity_at)
select
    p.id,
    p.user_id,
    coalesce(i.open_total, 0),
    coalesce(i.done_total, 0),
    coalesce(i.urgent_open, 0),
    i.last_urgent_at,
    -- Same 24h guard as the trigger, so the column never holds timestamps that
    -- can only ever be filtered out.
    coalesce(
        (select array_agg(x.gh_created_at order by x.gh_created_at desc)
         from (
             select gh_created_at
             from tracker.pull_requests
             where project_id = p.id
               and not draft
               and gh_created_at is not null
               and gh_created_at > now() - interval '24 hours'
             order by gh_created_at desc
             limit 10
         ) x),
        '{}'::timestamptz[]
    ),
    greatest(i.last_issue_at, r.last_pr_at)
from tracker.projects p
left join lateral (
    select
        count(*) filter (where status in ('open', 'in_progress', 'blocked'))    as open_total,
        count(*) filter (where status = 'done')                                 as done_total,
        count(*) filter (where priority = 'urgent'
                         and status in ('open', 'in_progress', 'blocked'))      as urgent_open,
        -- Best available proxy: we don't record when an issue *became* urgent.
        max(created_at) filter (where priority = 'urgent'
                                and status in ('open', 'in_progress', 'blocked')) as last_urgent_at,
        max(updated_at)                                                          as last_issue_at
    from tracker.issues
    where project_id = p.id
) i on true
left join lateral (
    select max(gh_updated_at) as last_pr_at
    from tracker.pull_requests
    where project_id = p.id
) r on true
on conflict (project_id) do nothing;


-- ═══ MIGRATION: 0048_project_insight_issue_created.sql ═══

-- The tile footer's timestamp should describe whatever the footer is talking
-- about, rather than being the same number regardless of variant:
--
--   pr        → when the latest PR opened      (already derivable: max(recent_pr_opens))
--   critical  → when the latest urgent landed  (already have: last_urgent_at)
--   progress  → when the latest issue was created   ← needs this column
--   clear     → when the latest issue was created   ← needs this column
--
-- last_activity_at is the newest issue/PR *update*, which is a different fact
-- and reads wrong under "2 / 7" — an edit to a months-old issue would report
-- the project as active minutes ago. Hence a dedicated created-at high-water
-- mark. It stays useful for the "Updated" field row.

alter table tracker.project_insight
    add column if not exists last_issue_created_at timestamptz;

-- Replaces the 0047 function; the trigger binding is unchanged.
create or replace function tracker.apply_issue_insight()
returns trigger language plpgsql security definer as $$
declare
    d_open   int := 0;
    d_done   int := 0;
    d_urgent int := 0;
begin
    -- Re-parenting an issue would have to decrement one project and increment
    -- another. Nothing in the app does this; fail loudly rather than drift.
    if tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
        raise exception 'project_insight: moving an issue between projects is not supported';
    end if;

    -- The old row stops contributing...
    if tg_op in ('UPDATE', 'DELETE') then
        d_open   := d_open   - (old.status in ('open', 'in_progress', 'blocked'))::int;
        d_done   := d_done   - (old.status = 'done')::int;
        d_urgent := d_urgent - (old.priority = 'urgent'
                                and old.status in ('open', 'in_progress', 'blocked'))::int;
    end if;

    -- ...and the new row starts. INSERT/DELETE simply skip one side, so every
    -- status and priority transition falls out of the same two blocks.
    if tg_op in ('INSERT', 'UPDATE') then
        d_open   := d_open   + (new.status in ('open', 'in_progress', 'blocked'))::int;
        d_done   := d_done   + (new.status = 'done')::int;
        d_urgent := d_urgent + (new.priority = 'urgent'
                                and new.status in ('open', 'in_progress', 'blocked'))::int;
    end if;

    update tracker.project_insight set
        open_total       = greatest(open_total  + d_open,   0),
        done_total       = greatest(done_total  + d_done,   0),
        urgent_open      = greatest(urgent_open + d_urgent, 0),
        -- Rises on "urgent issue created" AND "issue escalated to urgent" —
        -- both are d_urgent > 0, so neither needs special-casing.
        last_urgent_at   = case when d_urgent > 0 then now() else last_urgent_at end,
        last_issue_created_at = case
            -- Monotonic high-water mark on insert...
            when tg_op = 'INSERT' then greatest(last_issue_created_at, new.created_at)
            -- ...but a delete can remove the very issue it points at, so
            -- recompute. AFTER DELETE, so the row is already gone and max() is
            -- the correct post-delete answer. Deletes are rare; the scan is
            -- covered by issues_project_idx.
            when tg_op = 'DELETE' then
                (select max(created_at) from tracker.issues where project_id = old.project_id)
            else last_issue_created_at
        end,
        last_activity_at = greatest(last_activity_at, now()),
        updated_at       = now()
    where project_id = coalesce(new.project_id, old.project_id);

    return null;
end $$;

-- Backfill the new column for rows 0047 already created.
update tracker.project_insight pi
set last_issue_created_at = i.max_created
from (
    select project_id, max(created_at) as max_created
    from tracker.issues
    group by project_id
) i
where i.project_id = pi.project_id
  and pi.last_issue_created_at is distinct from i.max_created;


-- ═══ MIGRATION: 0049_notifications.sql ═══

-- tracker.notifications — the feed behind the topbar bell
-- (components/layout/notification-popover.tsx, which shipped against mock data).
--
-- WHY TRIGGERS, NOT THE ROUTE HANDLERS: the same argument 0047 makes for
-- project_insight, plus one that is decisive rather than merely preferable.
-- For the KB-build event there is NO tracker code to hang a notification off:
-- app/api/projects/[id]/analyser/index/route.ts kicks the job off and returns
-- 202, and the bobby-analyser then PATCHes tracker.project_analyser directly
-- over PostgREST from its own host (see the route's header comment, and
-- lib/analyser.ts kickoffJob — KickoffJobInput carries no callback URL, unlike
-- the issue/PR flows which do have /api/internal/*-result routes). Nothing in
-- this app runs when a graph finishes indexing. A trigger on the row the
-- analyser writes is the only server-side place that event exists, short of
-- changing the analyser's contract.
--
-- The PR events could have gone in the webhook / callback, but putting all
-- three in one place keeps the "what is worth telling the user about" rules
-- readable as a set, and inherits the same guarantee as 0047: the notification
-- commits in the same transaction as the fact it describes, so the feed cannot
-- drift from the data. There is also nowhere to run a reconciler — the OpenNext
-- worker has no scheduled handler.
--
-- WHAT IS DELIBERATELY NOT HERE: 'failed' states. An index or review that fails
-- is a real thing to surface, but it wants different copy, a retry affordance,
-- and probably a different tone than "here's your result" — out of scope for
-- the first cut rather than forgotten.

-- ── table ───────────────────────────────────────────────────────────────────
-- user_id is denormalised (not reached through project_id) for the reason
-- 0005 documents: Supabase Realtime evaluates RLS off the WAL record and
-- silently drops events when the policy needs a cross-table EXISTS. This table
-- is realtime-published at the bottom of this file, so its policy has to be a
-- flat single-column check from day one.
create table if not exists tracker.notifications (
    id         uuid        primary key default gen_random_uuid(),
    user_id    uuid        not null references auth.users(id) on delete cascade,
    -- Nullable only so a future account-level notice has somewhere to live;
    -- every kind below sets it. ON DELETE CASCADE means deleting a project
    -- takes its notifications with it, which is why the delete-project
    -- teardown needs no new step.
    project_id uuid        references tracker.projects(id) on delete cascade,
    kind       text        not null,
    -- title/meta/href are rendered verbatim by the popover. They are a
    -- point-in-time snapshot, NOT a live view: a project renamed after the fact
    -- keeps its old name here, which is correct for a feed entry ("this is what
    -- happened, then") and avoids a join per row on read.
    title      text        not null,
    meta       text,
    href       text,
    -- Null = unread. A timestamp rather than a boolean so "New" vs "Earlier"
    -- can later become time-based without a migration.
    read_at    timestamptz,
    created_at timestamptz not null default now(),
    constraint notifications_kind_valid check (
        kind in ('kb_ready', 'kb_updated', 'pr_analysis_ready', 'pr_opened')
    )
);

-- The feed's only read pattern: newest-first for one user. Also the index the
-- trim in push_notification() rides.
create index if not exists notifications_user_created_idx
    on tracker.notifications (user_id, created_at desc);

alter table tracker.notifications enable row level security;

-- Owner-only, and split per verb rather than `for all` because the verbs differ:
-- the user may read, mark read, and delete — but never insert. Inserting is the
-- triggers' job (they are security definer), and a client-forged notification
-- has no legitimate meaning.
drop policy if exists notifications_owner_select on tracker.notifications;
create policy notifications_owner_select on tracker.notifications
    for select using (user_id = auth.uid());

drop policy if exists notifications_owner_update on tracker.notifications;
create policy notifications_owner_update on tracker.notifications
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_owner_delete on tracker.notifications;
create policy notifications_owner_delete on tracker.notifications
    for delete using (user_id = auth.uid());

-- REQUIRED: 0001's blanket grant only covered the tables that existed then, so
-- every later table repeats this or fails with "permission denied" before RLS
-- is consulted (same note as 0047).
--
-- The UPDATE grant is COLUMN-SCOPED to read_at. The owner_update policy above
-- would otherwise let a client rewrite its own notification's title or href —
-- harmless to other users, but it would make the feed's contents untrustworthy
-- as a record. Marking read is the only update the product needs; the privilege
-- layer now says exactly that. No INSERT grant, for the same reason.
grant select, delete       on tracker.notifications to authenticated;
grant update (read_at)     on tracker.notifications to authenticated;
grant all                  on tracker.notifications to service_role;

-- ── insert helper ───────────────────────────────────────────────────────────
-- Every trigger below funnels through this so the retention rule lives in one
-- place. The tray shows a bounded list and nothing in the product pages back
-- through history, so an unbounded table would be pure growth — and there is no
-- cron to prune it (0047's constraint again). Trimming on write is O(1)-ish on
-- notifications_user_created_idx and keeps the table self-maintaining.
create or replace function tracker.push_notification(
    p_user_id    uuid,
    p_project_id uuid,
    p_kind       text,
    p_title      text,
    p_meta       text,
    p_href       text
) returns void language plpgsql security definer as $$
begin
    insert into tracker.notifications (user_id, project_id, kind, title, meta, href)
    values (p_user_id, p_project_id, p_kind, p_title, p_meta, p_href);

    delete from tracker.notifications
     where user_id = p_user_id
       and id not in (
           select id from tracker.notifications
            where user_id = p_user_id
            order by created_at desc
            limit 50
       );
end $$;

-- ── 1. knowledge base indexed → 'Knowledge base is ready' / 'update finished'
create or replace function tracker.notify_analyser_indexed()
returns trigger language plpgsql security definer as $$
declare
    v_first bool;
    v_name  text;
begin
    -- Fire on the TRANSITION into 'ready', not on the state. The analyser
    -- PATCHes this row repeatedly while a job runs (progress), and may touch it
    -- again after it finishes; without this guard a post-completion progress
    -- write would emit a second "ready!".
    if new.status <> 'ready' or old.status is not distinct from 'ready' then
        return null;
    end if;

    -- First-ever build vs a later one. last_indexed_at is the codebase's
    -- established proxy for "has bootstrapped at least once" — the same test
    -- components/projects/analyser-panel.tsx uses to label its button "Index
    -- now" vs "Re-index now". Read from OLD, i.e. the value before this run
    -- stamped it.
    --
    -- This assumes the analyser writes status='ready' and last_indexed_at in
    -- the SAME PATCH (it does — they are one completion write). If it ever
    -- split them, last_indexed_at would already be set when status flipped and
    -- a first build would announce itself as an update. The panel's button
    -- would mislabel in exactly the same way, so the two would at least be
    -- wrong together, and visibly.
    v_first := old.last_indexed_at is null;

    select name into v_name from tracker.projects where id = new.project_id;

    perform tracker.push_notification(
        new.user_id,
        new.project_id,
        case when v_first then 'kb_ready' else 'kb_updated' end,
        case when v_first then 'Knowledge base is ready!' else 'Knowledge base update finished' end,
        v_name,
        '/projects/' || new.project_id
    );
    return null;
end $$;

-- UPDATE only: a project_analyser row is created 'disabled'/'indexing' and
-- reaches 'ready' by update, never by insert.
drop trigger if exists notify_indexed on tracker.project_analyser;
create trigger notify_indexed
    after update on tracker.project_analyser
    for each row execute function tracker.notify_analyser_indexed();

-- ── 2. PR review finished → 'PR review ready' ───────────────────────────────
create or replace function tracker.notify_pr_analysis_done()
returns trigger language plpgsql security definer as $$
declare
    v_user  uuid;
    v_name  text;
    v_score text;
    v_max   text;
    v_title text;
begin
    -- Transition into 'done' only. INSERT is covered because a re-run of the
    -- same PR reuses the row (unique project_id+pr_number) — that arrives as an
    -- UPDATE, and is a genuinely new result worth a second notification.
    if new.status is distinct from 'done' then return null; end if;
    if tg_op = 'UPDATE' and old.status is not distinct from 'done' then return null; end if;

    select p.user_id, p.name into v_user, v_name
      from tracker.projects p where p.id = new.project_id;
    if v_user is null then return null; end if;

    -- The score is OPTIONAL and must never be invented — commit f0a5c71 ("never
    -- fake the score") removed exactly this class of guess from the PR comment
    -- and the in-app view. Legacy/partial results omit it, so the headline
    -- carries the score only when both halves are actually present.
    v_score := new.result ->> 'score';
    v_max   := new.result ->> 'score_max';
    v_title := case
        when v_score is not null and v_max is not null
            then 'PR review ready — ' || v_score || '/' || v_max
        else 'PR review ready'
    end;

    perform tracker.push_notification(
        v_user,
        new.project_id,
        'pr_analysis_ready',
        v_title,
        coalesce(v_name, 'Project') || ' · PR #' || new.pr_number,
        '/projects/' || new.project_id || '/pulls/' || new.pr_number
    );
    return null;
end $$;

drop trigger if exists notify_analysis_done on tracker.pull_request_analyses;
create trigger notify_analysis_done
    after insert or update on tracker.pull_request_analyses
    for each row execute function tracker.notify_pr_analysis_done();

-- ── 3. new PR opened → 'X opened a pull request' ────────────────────────────
create or replace function tracker.notify_pr_opened()
returns trigger language plpgsql security definer as $$
declare
    v_user uuid;
    v_name text;
begin
    -- The webhook UPSERTS, so `reopened`/`synchronize`/`closed` all land as
    -- UPDATEs and only a genuinely new PR is an INSERT — the same lever 0047's
    -- apply_pr_insight pulls.
    --
    -- The 24h guard is load-bearing and NOT cosmetic: lib/pr-backfill.ts bulk-
    -- inserts a repo's entire PR history the first time it is connected. Without
    -- it, connecting a repo would carpet-bomb the tray with years of "new PR"
    -- notices. 0047 carries the identical guard for the identical reason.
    --
    -- draft/state/merged: a draft isn't reviewed yet (the webhook skips analysis
    -- for it), and a PR that arrives already closed or merged is history, not
    -- news — the 24h window alone would still let a same-day closed PR through.
    if not (
        not new.draft
        and new.state = 'open'
        and not new.merged
        and new.gh_created_at is not null
        and new.gh_created_at > now() - interval '24 hours'
    ) then
        return null;
    end if;

    select p.user_id, p.name into v_user, v_name
      from tracker.projects p where p.id = new.project_id;
    if v_user is null then return null; end if;

    perform tracker.push_notification(
        v_user,
        new.project_id,
        'pr_opened',
        coalesce(new.author_login, 'Someone') || ' opened a pull request',
        coalesce(v_name, 'Project') || ' · PR #' || new.pr_number,
        '/projects/' || new.project_id || '/pulls/' || new.pr_number
    );
    return null;
end $$;

drop trigger if exists notify_pr_opened on tracker.pull_requests;
create trigger notify_pr_opened
    after insert on tracker.pull_requests
    for each row execute function tracker.notify_pr_opened();

-- ── realtime ────────────────────────────────────────────────────────────────
-- Lets the bell animate the moment a row lands, with no polling (see 0003).
-- RLS still applies to realtime, and the flat user_id policy above is what makes
-- it deliverable (0005).
--
-- Guarded, unlike 0003's bare ALTER: adding a table twice raises
-- "relation is already member of publication", which would make re-running this
-- migration fail on an otherwise idempotent file.
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'tracker'
           and tablename = 'notifications'
    ) then
        alter publication supabase_realtime add table tracker.notifications;
    end if;
end $$;


-- ═══ MIGRATION: 0050_project_icon.sql ═══

-- Per-project icon: a canonical Iconly slug (e.g. 'rocket', 'add-user'), the
-- same value space as tracker.project_label_icons.icon_name. Chosen by the user
-- from the settings page's icon picker and rendered on the projects grid tile
-- and the project header.
--
-- Nullable, no default: a project with no icon set (every existing row, and any
-- created before the user picks one) renders a stable hash-derived glyph in the
-- app instead. Validated app-side against the canonical Iconly set on write
-- (same as label icons), so no DB check constraint is needed here. Existing
-- owner RLS on tracker.projects already covers the new column.

alter table tracker.projects
    add column if not exists icon_name text;


-- ═══ MIGRATION: 0051_notification_email.sql ═══

-- tracker: email fan-out for the notification feed (migration 0049).
--
-- WHY A TRIGGER, NOT APP CODE: the same decisive reason 0049 gives for the feed
-- itself. The KB-ready / KB-updated events have NO tracker code path — the
-- analyser PATCHes tracker.project_analyser directly over PostgREST from its own
-- host — so there is nowhere server-side to hang an email off for them. But
-- every notification of every kind funnels through tracker.push_notification()
-- into ONE insert on tracker.notifications. A single AFTER INSERT trigger there
-- is therefore the only place that sees them all, current and future. It POSTs
-- the row id back to the app (which owns SMTP) over pg_net; the app resolves the
-- recipient and sends. The PR-review email routes through here too, so there is
-- exactly one dispatch path rather than one-per-event-source.
--
-- pg_net IS ASYNC: net.http_post enqueues the request and returns immediately;
-- its background worker delivers AFTER this transaction commits. So a slow or
-- unreachable app can never block or roll back the notification insert, and by
-- the time the callback runs the row — and anything it references, e.g. the
-- pull_request_analyses.result — is already committed and readable.
--
-- OPT-IN, SECRETS OUT OF GIT: the callback URL and shared token live in
-- tracker.app_config, which the operator populates (see below). With either
-- absent the trigger no-ops — email stays off until deliberately configured,
-- mirroring the app-side SMTP_* gate. The token authenticates DB→app so only
-- this database can ask the app to send mail.

create extension if not exists pg_net;

-- ── config ────────────────────────────────────────────────────────────────────
-- A tiny key/value bag for operator-set server config a trigger needs at runtime
-- (today: the notification-email callback). It holds a bearer secret, so it is
-- RLS-locked with NO grants to authenticated — clients get nothing (RLS is
-- default-deny once enabled). Only the SECURITY DEFINER trigger below (which
-- bypasses RLS) and service_role ever read it.
create table if not exists tracker.app_config (
    key   text primary key,
    value text not null
);

alter table tracker.app_config enable row level security;
grant all on tracker.app_config to service_role;

-- To turn email ON, the operator inserts these two rows (the token must match
-- the app's NOTIFY_EMAIL_TOKEN env var):
--
--   insert into tracker.app_config (key, value) values
--     ('notify_email_url',   'https://<app-host>/api/internal/notification-email'),
--     ('notify_email_token', '<same value as the app''s NOTIFY_EMAIL_TOKEN>')
--   on conflict (key) do update set value = excluded.value;

-- ── fan-out trigger ───────────────────────────────────────────────────────────
create or replace function tracker.email_notification()
returns trigger language plpgsql security definer as $$
declare
    v_url   text;
    v_token text;
begin
    select value into v_url   from tracker.app_config where key = 'notify_email_url';
    select value into v_token from tracker.app_config where key = 'notify_email_token';

    -- Not configured → email disabled. Never raise: the feed insert must stand
    -- on its own regardless of whether the email channel is set up.
    if v_url is null or v_token is null then
        return null;
    end if;

    -- Fire-and-forget. We pass only the id; the app reloads the row (and, for a
    -- PR review, its result) so the email always reflects committed state and no
    -- secret-bearing payload rides the request beyond the auth token.
    perform net.http_post(
        url     := v_url,
        body    := jsonb_build_object('id', new.id),
        headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || v_token
        ),
        timeout_milliseconds := 5000
    );
    return null;
end $$;

drop trigger if exists email_notification on tracker.notifications;
create trigger email_notification
    after insert on tracker.notifications
    for each row execute function tracker.email_notification();


-- ═══ MIGRATION: 0052_teams.sql ═══

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


-- ═══ MIGRATION: 0053_newsletter_subscribers.sql ═══

-- Newsletter sign-ups from the landing page's footer.
--
-- Deliberately its own table rather than a column on a user: the whole point is
-- to hear from people who have NOT signed up. There is no account behind these
-- rows, so nothing here joins to auth.users.
--
-- Writes come from /api/newsletter via the service client, which bypasses RLS.
-- RLS is enabled with no policies at all, so the anon and authenticated roles
-- can neither read the list nor add to it directly — an email list is exactly
-- the kind of table that must not be readable from the browser.
--
-- `source` records which surface the address came from, so a later signup form
-- elsewhere doesn't need a schema change to be told apart.

create table if not exists tracker.newsletter_subscribers (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    source text not null default 'landing-footer',
    created_at timestamptz not null default now(),
    -- Set when someone asks to be removed; kept rather than deleted so a
    -- re-subscribe doesn't silently resurrect an old opt-out.
    unsubscribed_at timestamptz
);

-- Foo@x.com and foo@x.com are one person, so addresses are normalised to
-- lower case by the route before they get here and the index is a plain one on
-- the column. An expression index on lower(email) would be equivalent for
-- lookups but couldn't back an ON CONFLICT (email) upsert, which is how a
-- second submission updates the existing row instead of failing.
create unique index if not exists newsletter_subscribers_email_key
    on tracker.newsletter_subscribers (email);

alter table tracker.newsletter_subscribers enable row level security;


-- ═══ MIGRATION: 0053_notification_outbox.sql ═══

-- tracker: the transactional OUTBOX for the Notifications module.
--
-- WHY AN OUTBOX: this stack has NO cron and no queue (OpenNext has no scheduled
-- handler), so there is no external ticker to reconcile "the fact happened" with
-- "the notification was sent". The outbox closes that gap by co-locating the two:
-- a producer INSERTs the event row here in the SAME transaction as the business
-- fact it describes (the PR was opened, the KB finished indexing). Commit is
-- atomic — either both land or neither does — so a notification can never be
-- promised for a fact that rolled back, nor a fact silently go unannounced.
--
-- HOW IT DRAINS: a drain reads pending rows and hands each to the channel
-- dispatcher, then marks it delivered. Today that drain runs inside the app —
-- BackgroundTasks / next/server `after()` piggy-backing on the same request that
-- enqueued — because that is the only post-response hook this stack has. When the
-- Notifications module is extracted the very same table becomes a proper queue's
-- source of truth; only the drain's trigger changes, not this schema.
--
-- AT-LEAST-ONCE, SO CHANNELS ARE IDEMPOTENT: a row can be pulled again if the
-- drain dies after delivering but before marking it done (crash, timeout, retry).
-- That is deliberate — losing a notification is worse than repeating one — and it
-- is the contract NotificationChannel.deliver is written against: delivery must be
-- idempotent. `attempts` is here to observe and cap redelivery later.
--
-- ADDITIVE AND DORMANT: this migration only ADDS a table. It does NOT touch,
-- disable, or replace the existing trigger-based path (0049's feed insert and
-- 0051's pg_net email fan-out), which keeps running exactly as before. Nothing
-- writes to or reads from this table until the module is wired to producers; the
-- cutover from triggers to the outbox is a separate, deliberate migration.

-- ── outbox ──────────────────────────────────────────────────────────────────
-- One row per notification event awaiting delivery. `event` is the full
-- JSON-serialised domain event (modules/notifications/domain/events.ts) — the
-- table stays kind-agnostic so adding a notification kind never touches SQL.
create table if not exists tracker.notification_outbox (
    id           uuid primary key default gen_random_uuid(),
    event        jsonb not null,
    status       text not null default 'pending' check (status in ('pending', 'done')),
    attempts     int not null default 0,
    created_at   timestamptz not null default now(),
    delivered_at timestamptz
);

-- The drain claims the oldest pending rows first. A PARTIAL index keeps only the
-- undelivered rows in the index, so the queue-head lookup stays small and cheap
-- even as delivered history accumulates.
create index if not exists notification_outbox_pending_idx
    on tracker.notification_outbox (status, created_at)
    where status = 'pending';

-- Only the service-role drain ever touches this table. Enable RLS (default-deny
-- once on) and grant nothing to `authenticated` — clients get no access at all —
-- while service_role, which bypasses RLS, retains full access.
alter table tracker.notification_outbox enable row level security;
grant all on tracker.notification_outbox to service_role;


-- ═══ MIGRATION: 0054_notification_cutover.sql ═══

-- tracker: the Notifications CUTOVER — trigger-direct-delivery → enqueue + app drain.
--
-- WHAT CHANGES: 0049 made the DB do everything — a trigger looked up the recipient
-- and INSERTed the finished feed row, and 0051 bolted an email fan-out onto that
-- insert. That put channel selection, recipient resolution, and per-kind copy
-- inside plpgsql, where the teams model (fan-out to every member, per-user
-- channel preferences) cannot live. This migration moves DELIVERY to the app.
-- The Notifications module (modules/notifications/*) now owns channels, recipient
-- fan-out, and rendering; the DB's only remaining job is to record that a fact
-- happened, atomically with the fact.
--
-- HOW: the three business-fact triggers no longer deliver. Under the SAME firing
-- conditions as 0049, each now enqueues ONE row into tracker.notification_outbox
-- (0053) whose `event` jsonb is the app's domain event, byte-for-byte the shape
-- modules/notifications/domain/events.ts parses (camelCase: kind, projectId,
-- occurredAt, projectName, and the per-kind fields). The event carries FACTS only
-- — no user_id, no rendered title — because recipients and copy are the app's
-- concern now. Enqueue commits in the same transaction as the fact (0053's outbox
-- guarantee), so a notification can never be promised for a fact that rolled back.
--
-- THE WAKE: this stack has no cron and no queue worker (OpenNext has no scheduled
-- handler), so an AFTER INSERT trigger on the outbox pings the app over pg_net —
-- exactly the pattern 0051 used for email — to nudge /api/internal/notifications/drain
-- to pull the pending rows and hand each to the channel dispatcher. pg_net is
-- async: the ping goes out only AFTER the outbox row commits, so a slow or
-- unreachable app can never block or roll back the enqueue.
--
-- ── CRITICAL OPERATIONAL NOTE — ORDER OF OPERATIONS ──────────────────────────
-- This migration REMOVES the DB-side delivery path. From the moment it is applied,
-- nothing delivers notifications until the app's drain does. Therefore:
--
--   1. DEPLOY THE APP FIRST. The build carrying /api/internal/notifications/drain
--      (and the Notifications module that reads the outbox) MUST be live BEFORE
--      this migration is applied. Apply it against the old app and every event
--      enqueued between apply-time and deploy-time sits undelivered in the outbox
--      until the drain ships (they are not lost — the outbox is durable and the
--      drain claims oldest-pending first — but the feed goes quiet meanwhile).
--
--   2. THEN set the drain endpoint, or nothing pings. Like 0051's email keys, the
--      URL and shared token live in tracker.app_config (secrets out of git); with
--      either absent the outbox trigger no-ops. The operator inserts:
--
--        insert into tracker.app_config (key, value) values
--          ('notify_drain_url',   'https://<app-host>/api/internal/notifications/drain'),
--          ('notify_drain_token', '<same value as the app''s NOTIFY_DRAIN_TOKEN env var>')
--        on conflict (key) do update set value = excluded.value;
--
--      The token authenticates DB→app so only this database can wake the drain.
--
-- SAFE TO RE-RUN: every statement is idempotent (drop-if-exists, create-or-replace,
-- drop-then-create for triggers). Re-applying makes no additional change.
--
-- WHAT IS DELIBERATELY LEFT ALONE: tracker.notifications (the feed table), its RLS,
-- its column grants, and its realtime publication all STAY — the in-app channel
-- still writes that table (now from the app, via the drain), and the bell still
-- animates off its realtime feed. Only the DB's *delivery* triggers are removed.
--
-- NOTE ON RECIPIENTS: 0049's PR triggers skipped when the project's owner could not
-- be resolved (`v_user is null`). That was recipient logic, not a firing condition
-- about the fact — and it is exactly what moves to the app (which fans out to all
-- team members, not one owner). The enqueue triggers below therefore drop that
-- lookup and preserve only the fact-level guards 0049 documents as load-bearing:
-- the ready/done transition guards, the first-build kb_ready-vs-kb_updated split,
-- and the pr_opened draft/state/merged/24h window.

create extension if not exists pg_net;

-- ── 1. tear down the old DB-side delivery path ───────────────────────────────
-- Triggers first (a function cannot be dropped while a trigger depends on it),
-- then the functions. push_notification() is the shared insert helper 0049 built;
-- with all three producers gone it has no caller left, so it goes too. The feed
-- table itself is untouched.
drop trigger if exists notify_indexed        on tracker.project_analyser;
drop trigger if exists notify_analysis_done  on tracker.pull_request_analyses;
drop trigger if exists notify_pr_opened      on tracker.pull_requests;
drop trigger if exists email_notification    on tracker.notifications;

drop function if exists tracker.notify_analyser_indexed();
drop function if exists tracker.notify_pr_analysis_done();
drop function if exists tracker.notify_pr_opened();
drop function if exists tracker.email_notification();
drop function if exists tracker.push_notification(uuid, uuid, text, text, text, text);

-- ── 2. new producers: enqueue the domain event into the outbox ───────────────
-- Each mirrors its 0049 counterpart's firing conditions VERBATIM, then builds the
-- exact domain event (events.ts) with jsonb_build_object and INSERTs it. Still
-- SECURITY DEFINER — the outbox is RLS-locked (0053) and only the definer/service
-- role may write it — same posture as 0049's push_notification. occurredAt is an
-- ISO-8601 string via to_jsonb(now()).

-- 2a. knowledge base indexed → kb_ready (first build) / kb_updated (later build)
create or replace function tracker.enqueue_kb_indexed()
returns trigger language plpgsql security definer as $$
declare
    v_first bool;
    v_name  text;
begin
    -- Fire on the TRANSITION into 'ready', not on the state (verbatim from 0049).
    -- The analyser PATCHes this row repeatedly while a job runs, and may touch it
    -- again after; without this guard a post-completion write emits a second "ready!".
    if new.status <> 'ready' or old.status is not distinct from 'ready' then
        return null;
    end if;

    -- First-ever build vs a later one — read from OLD, before this run stamped it
    -- (verbatim from 0049; drives kb_ready vs kb_updated).
    v_first := old.last_indexed_at is null;

    select name into v_name from tracker.projects where id = new.project_id;

    insert into tracker.notification_outbox (event)
    values (jsonb_build_object(
        'kind',        case when v_first then 'kb_ready' else 'kb_updated' end,
        'projectId',   new.project_id,
        'occurredAt',  to_jsonb(now()),
        'projectName', v_name
    ));
    return null;
end $$;

-- UPDATE only: a project_analyser row is created 'disabled'/'indexing' and reaches
-- 'ready' by update, never by insert (verbatim from 0049).
drop trigger if exists enqueue_kb_indexed on tracker.project_analyser;
create trigger enqueue_kb_indexed
    after update on tracker.project_analyser
    for each row execute function tracker.enqueue_kb_indexed();

-- 2b. PR review finished → pr_analysis_ready
create or replace function tracker.enqueue_pr_analysis_ready()
returns trigger language plpgsql security definer as $$
declare
    v_name text;
begin
    -- Transition into 'done' only. A re-run of the same PR reuses the row (unique
    -- project_id+pr_number) and arrives as an UPDATE — a genuinely new result worth
    -- announcing again (verbatim from 0049).
    if new.status is distinct from 'done' then return null; end if;
    if tg_op = 'UPDATE' and old.status is not distinct from 'done' then return null; end if;

    select p.name into v_name from tracker.projects p where p.id = new.project_id;

    -- The score is OPTIONAL and must never be invented (0049; commit f0a5c71). We
    -- read it with -> so the number type is preserved and an absent (or JSON-null)
    -- key becomes JSON null — which is exactly the `score != null && scoreMax != null`
    -- distinction renderNotification() makes. score_max maps to the domain's scoreMax.
    insert into tracker.notification_outbox (event)
    values (jsonb_build_object(
        'kind',        'pr_analysis_ready',
        'projectId',   new.project_id,
        'occurredAt',  to_jsonb(now()),
        'projectName', v_name,
        'prNumber',    new.pr_number,
        'score',       new.result -> 'score',
        'scoreMax',    new.result -> 'score_max'
    ));
    return null;
end $$;

drop trigger if exists enqueue_pr_analysis_ready on tracker.pull_request_analyses;
create trigger enqueue_pr_analysis_ready
    after insert or update on tracker.pull_request_analyses
    for each row execute function tracker.enqueue_pr_analysis_ready();

-- 2c. new PR opened → pr_opened
create or replace function tracker.enqueue_pr_opened()
returns trigger language plpgsql security definer as $$
declare
    v_name text;
begin
    -- INSERT-only trigger, plus the load-bearing 24h/draft/state/merged guard,
    -- copied VERBATIM from 0049. The 24h window keeps a first-time repo backfill
    -- (lib/pr-backfill.ts bulk-inserting years of PRs) from carpet-bombing the tray;
    -- draft/state/merged drop PRs that are not news.
    if not (
        not new.draft
        and new.state = 'open'
        and not new.merged
        and new.gh_created_at is not null
        and new.gh_created_at > now() - interval '24 hours'
    ) then
        return null;
    end if;

    select p.name into v_name from tracker.projects p where p.id = new.project_id;

    -- authorLogin is carried RAW (nullable): the "Someone" fallback now lives in
    -- renderNotification(), not here.
    insert into tracker.notification_outbox (event)
    values (jsonb_build_object(
        'kind',        'pr_opened',
        'projectId',   new.project_id,
        'occurredAt',  to_jsonb(now()),
        'projectName', v_name,
        'prNumber',    new.pr_number,
        'authorLogin', new.author_login
    ));
    return null;
end $$;

drop trigger if exists enqueue_pr_opened on tracker.pull_requests;
create trigger enqueue_pr_opened
    after insert on tracker.pull_requests
    for each row execute function tracker.enqueue_pr_opened();

-- ── 3. the wake: ping the app's drain when a row is enqueued ──────────────────
-- Mirrors 0051's email fan-out exactly: read the endpoint + token from
-- tracker.app_config (SECURITY DEFINER bypasses the config table's default-deny
-- RLS), no-op if either is unset, and fire-and-forget a pg_net POST carrying only
-- the row id. The app reloads pending rows from the outbox itself, so no
-- event payload rides the request beyond the auth token.
create or replace function tracker.ping_notification_drain()
returns trigger language plpgsql security definer as $$
declare
    v_url   text;
    v_token text;
begin
    select value into v_url   from tracker.app_config where key = 'notify_drain_url';
    select value into v_token from tracker.app_config where key = 'notify_drain_token';

    -- Not configured → no ping. Never raise: the outbox enqueue must stand on its
    -- own regardless of whether the drain endpoint is wired up (the drain will pick
    -- the row up on its next run either way).
    if v_url is null or v_token is null then
        return null;
    end if;

    perform net.http_post(
        url     := v_url,
        body    := jsonb_build_object('id', new.id),
        headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || v_token
        ),
        timeout_milliseconds := 5000
    );
    return null;
end $$;

drop trigger if exists ping_notification_drain on tracker.notification_outbox;
create trigger ping_notification_drain
    after insert on tracker.notification_outbox
    for each row execute function tracker.ping_notification_drain();


-- ═══ MIGRATION: 0055_gitlab_integration.sql ═══

-- GitLab integration — provider discriminator + GitLab-specific link/credential
-- storage, alongside the existing GitHub wiring (0031/0036/0037/0039/0041).
--
-- The VCS module (modules/vcs) is already provider-agnostic; this migration adds
-- the DATA a second provider needs. Three additions:
--
--   1. tracker.provider_tokens — a multi-provider replacement for the user-
--      authority OAuth token. github_tokens is keyed by user_id alone and assumes
--      a long-lived, non-expiring classic token; GitLab tokens expire (~2h) and
--      carry a refresh token, and a user may connect BOTH providers — so this is
--      keyed (user_id, provider) with an expires_at. GitHub keeps using
--      github_tokens for now; a later migration can fold it in here.
--
--   2. tracker.projects.provider + gitlab_project_id — the discriminator the
--      composition root (modules/vcs/Composition.ts) branches on, plus the stable
--      numeric GitLab project id used to route an inbound webhook back to a
--      project (the GitLab analog of github_repo_id). The existing sync-setting
--      columns (github_sync_enabled / _direction / _deletes, auto_index_on_push)
--      are provider-neutral in meaning and are REUSED for GitLab — no new copies.
--
--   3. tracker.gitlab_project_links — the per-project bot credential + webhook
--      registration. GitLab has no "app installation" concept (cf.
--      github_installations); the bot credential is a Project Access Token
--      provisioned per repo via the owner's OAuth token, and each project webhook
--      has its OWN secret (X-Gitlab-Token), unlike GitHub's single app-level
--      secret. These are secrets, so the table is SERVICE-ROLE ONLY (no owner
--      select) — the UI reads connection status from projects.gitlab_project_id,
--      never the credential itself.

-- ─── 1. multi-provider user OAuth tokens ────────────────────────────────────

create table if not exists tracker.provider_tokens (
    user_id           uuid        not null references auth.users(id) on delete cascade,
    -- 'github' | 'gitlab'. A user may connect both, hence the composite PK.
    provider          text        not null check (provider in ('github', 'gitlab')),
    -- The instance this credential is for. 'gitlab.com', or a self-managed host
    -- like 'gitlab.acme.com'. Part of the key because this is a PUBLIC service:
    -- one user can connect BOTH public gitlab.com (via OAuth) and their own
    -- self-hosted instance(s) (via a pasted token) — different hosts, different
    -- rows. GitHub rows use 'github.com'.
    host              text        not null default 'gitlab.com',
    -- How the credential was obtained: 'oauth' (gitlab.com, Supabase-brokered,
    -- refreshable) or 'pat' (a user-pasted Personal/Project Access Token for a
    -- self-managed instance — the only mechanism that works across arbitrary
    -- instances, since OAuth can't be brokered to an unknown host).
    auth_kind         text        not null default 'oauth' check (auth_kind in ('oauth', 'pat')),
    -- The user's access token (acts AS the signed-in user).
    access_token      text        not null,
    -- Refresh token. OAuth (gitlab.com) issues one; used to mint a new access
    -- token when the current one expires (no scheduler here — refresh is lazy,
    -- on read, when expires_at has passed). Null for PATs.
    refresh_token     text,
    -- When access_token expires. Null = non-expiring (a PAT with no expiry).
    expires_at        timestamptz,
    -- Space/comma-separated granted scopes, for deciding whether to re-consent.
    scopes            text,
    -- Provider numeric user id (diagnostics) + login ("connected as @user").
    provider_user_id  text,
    provider_login    text,
    -- API base for a self-managed instance (e.g. https://gitlab.acme.com/api/v4).
    -- Null → derive from host (https://<host>/api/v4).
    api_base          text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    primary key (user_id, provider, host)
);

drop trigger if exists touch_provider_tokens on tracker.provider_tokens;
create trigger touch_provider_tokens
    before update on tracker.provider_tokens
    for each row execute function tracker.touch_updated_at();

alter table tracker.provider_tokens enable row level security;

drop policy if exists provider_tokens_owner_select on tracker.provider_tokens;
create policy provider_tokens_owner_select on tracker.provider_tokens
    for select using (user_id = auth.uid());

drop policy if exists provider_tokens_owner_insert on tracker.provider_tokens;
create policy provider_tokens_owner_insert on tracker.provider_tokens
    for insert with check (user_id = auth.uid());

drop policy if exists provider_tokens_owner_update on tracker.provider_tokens;
create policy provider_tokens_owner_update on tracker.provider_tokens
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists provider_tokens_owner_delete on tracker.provider_tokens;
create policy provider_tokens_owner_delete on tracker.provider_tokens
    for delete using (user_id = auth.uid());

grant all on tracker.provider_tokens to authenticated, service_role;

-- ─── 2. projects: provider discriminator + GitLab repo id ───────────────────

alter table tracker.projects
    -- Existing rows are GitHub; default keeps them so with no backfill needed.
    add column if not exists provider          text   not null default 'github'
        check (provider in ('github', 'gitlab')),
    -- Stable numeric GitLab project id — the rename-proof join key for routing
    -- an inbound GitLab webhook back to a project (mirrors github_repo_id).
    add column if not exists gitlab_project_id bigint;

-- One project per linked GitLab repo → unambiguous inbound routing. Partial so
-- unlinked projects (gitlab_project_id is null) don't collide (mirrors
-- projects_github_repo_id_uniq).
create unique index if not exists projects_gitlab_project_id_uniq
    on tracker.projects (gitlab_project_id)
    where gitlab_project_id is not null;

-- ─── 3. per-project GitLab bot credential + webhook (service-role only) ──────

create table if not exists tracker.gitlab_project_links (
    -- One link per project (GitLab has no cross-repo installation concept).
    project_id         uuid        primary key references tracker.projects(id) on delete cascade,
    -- The numeric GitLab project id, mirrored here for the webhook route's
    -- id → link lookup (projects also carries it for the id → project routing).
    gitlab_project_id  bigint      not null,
    -- The provisioned Project Access Token acting as the bot (app authority).
    -- Rotated lazily via the owner's provider_tokens refresh token on 401/expiry.
    access_token       text,
    -- PAT expiry (GitLab mandates one, max ~365d). Drives lazy re-provisioning.
    token_expires_at   timestamptz,
    -- The registered project-hook id, so we can update/delete the hook later.
    webhook_id         bigint,
    -- This project's webhook secret (compared to X-Gitlab-Token, constant-time).
    -- Per-project, unlike GitHub's single GITHUB_APP_WEBHOOK_SECRET.
    webhook_secret     text,
    -- API base for self-managed GitLab (e.g. https://git.example.com/api/v4).
    -- Null → gitlab.com. Derived from the project's repo_url host at link time.
    api_base           text,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create index if not exists gitlab_project_links_gitlab_project_id_idx
    on tracker.gitlab_project_links (gitlab_project_id);

drop trigger if exists touch_gitlab_project_links on tracker.gitlab_project_links;
create trigger touch_gitlab_project_links
    before update on tracker.gitlab_project_links
    for each row execute function tracker.touch_updated_at();

-- Secrets live here (bot PAT + webhook secret): service-role only. RLS is on
-- with NO policies, and no grant to `authenticated`, so only the service-role
-- client (webhook + link/provision flows, which bypass RLS) can touch it.
alter table tracker.gitlab_project_links enable row level security;
grant all on tracker.gitlab_project_links to service_role;

-- ─── 4. generic webhook-delivery idempotency ledger ─────────────────────────

-- GitLab redelivers hooks; X-Gitlab-Event-UUID is the stable delivery id. A
-- generic (provider, delivery_id) ledger dedupes them the way
-- github_webhook_deliveries does for GitHub (that table stays as-is; this one
-- serves GitLab and any future provider). Service-role only.
create table if not exists tracker.webhook_deliveries (
    provider     text        not null,
    delivery_id  text        not null,
    event        text,
    created_at   timestamptz not null default now(),
    primary key (provider, delivery_id)
);

alter table tracker.webhook_deliveries enable row level security;
grant all on tracker.webhook_deliveries to service_role;


-- ═══ MIGRATION: 0056_provider_tokens_multi_instance.sql ═══

-- Upgrade tracker.provider_tokens to MULTI-INSTANCE (per-host) keying.
--
-- 0055 first shipped a single-instance shape — primary key (user_id, provider),
-- no host column — and some databases applied that form before it was revised.
-- This migration brings the table to (user_id, provider, host) with auth_kind +
-- api_base, IDEMPOTENTLY, so it is a no-op on databases that already got the
-- revised 0055 and a clean upgrade on those that got the original.
--
-- Why host is in the key: this is a public service. A user may connect public
-- gitlab.com (OAuth) AND their own self-managed instance(s) (a pasted token);
-- each instance is its own row, distinguished by host.

-- 1. New columns (skipped when already present).
alter table tracker.provider_tokens
    add column if not exists host      text not null default 'gitlab.com',
    add column if not exists auth_kind text not null default 'oauth',
    add column if not exists api_base  text;

-- 2. auth_kind domain, added once (guarded so a re-run doesn't error).
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'provider_tokens_auth_kind_chk'
    ) then
        alter table tracker.provider_tokens
            add constraint provider_tokens_auth_kind_chk check (auth_kind in ('oauth', 'pat'));
    end if;
end $$;

-- 3. Re-key to include host. Only acts when the current PK isn't already the
--    3-column form, so re-running (or a fresh 0055) is a no-op. provider_tokens
--    holds only GitLab rows and none have been created yet in practice, so the
--    default host ('gitlab.com') on any pre-existing row keeps the key unique.
do $$
declare
    pk_cols text;
begin
    select string_agg(a.attname, ',' order by array_position(c.conkey, a.attnum))
    into pk_cols
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'tracker.provider_tokens'::regclass and c.contype = 'p';

    if pk_cols is distinct from 'user_id,provider,host' then
        if pk_cols is not null then
            alter table tracker.provider_tokens drop constraint provider_tokens_pkey;
        end if;
        alter table tracker.provider_tokens add primary key (user_id, provider, host);
    end if;
end $$;


-- ═══ MIGRATION: 0057_projects_gitlab_instance.sql ═══

-- Make GitLab project linking instance-aware on tracker.projects.
--
-- 0055 added gitlab_project_id with a GLOBAL unique index. That's wrong for a
-- public multi-instance service: GitLab project ids are only unique WITHIN an
-- instance, so two self-managed instances can each have project id 42. Key the
-- uniqueness (and, later, inbound webhook routing) on (host, project id) instead.

alter table tracker.projects
    -- The GitLab instance host a linked project lives on (e.g. 'gitlab.com' or
    -- 'git.acme.com'). Null for GitHub / unlinked projects. Set at create time
    -- from the repo URL host; also the routing key for inbound GitLab webhooks.
    add column if not exists gitlab_host text;

-- Replace the global unique index with a per-instance one.
drop index if exists tracker.projects_gitlab_project_id_uniq;

create unique index if not exists projects_gitlab_instance_project_uniq
    on tracker.projects (gitlab_host, gitlab_project_id)
    where gitlab_project_id is not null;


-- ═══ MIGRATION: 0058_issue_sync_source_gitlab.sql ═══

-- Allow 'gitlab' as an issue sync source.
--
-- 0038 constrained tracker.issues.sync_source to ('tracker','github'). GitLab-
-- origin issues reuse the same sync columns (github_issue_number holds the
-- GitLab issue iid, github_node_id the global id), so the source enum just needs
-- to admit 'gitlab' too.

alter table tracker.issues
    drop constraint if exists issues_sync_source_valid;

alter table tracker.issues
    add constraint issues_sync_source_valid
    check (sync_source is null or sync_source in ('tracker', 'github', 'gitlab'));


-- ═══ MIGRATION: 0059_prowl_billing.sql ═══

-- Prowl — usage metering & credits foundation (app-side).
--
-- "Prowl" is Ucelot's billing system: every model call the analyser runs spends
-- PROWL POINTS, drawn from a team's monthly allowance. This migration lays the
-- store the app needs to (a) know each team's tier + allowance and (b) record
-- every metered call. Enforcement (blocking a call when the balance is spent) and
-- the analyser-side token accounting come later — this is the ledger they'll read.
--
-- BILLING SUBJECT = the TEAM (migration 0052). Every account already has a
-- personal team that owns its resources; the subscription + usage attach there,
-- so a shared team's spend pools naturally across its members.
--
-- AUTHORISATION — same hybrid model as 0052:
--   • RLS is the coarse tenant backstop: a row is visible iff you are a member of
--     the owning team (tracker.is_team_member). Cross-team leakage is impossible
--     by construction.
--   • Usage events are WRITTEN by the trusted service role only (the metering
--     layer uses Supabase.service(), which bypasses RLS) — there is no client
--     insert policy, so a member can read their team's spend but never forge it.
--   • Tier changes are admin-gated (is_team_admin); the eventual billing provider
--     writes them through the service role.

-- ─── tier enum (mirrors modules/billing TierId) ──────────────────────────────
do $$ begin
    if not exists (
        select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'prowl_tier' and n.nspname = 'tracker'
    ) then
        create type tracker.prowl_tier as enum ('kit', 'prowler', 'pride', 'apex');
    end if;
end $$;

-- ─── team_subscriptions — one row per team ───────────────────────────────────
-- monthly_points is a NEGOTIATED OVERRIDE only: when NULL (the norm) the app uses
-- the tier's catalogue default (modules/billing Tier), so re-pricing a tier is a
-- code change with no data migration. Non-null carries a bespoke Apex allowance.
create table if not exists tracker.team_subscriptions (
    team_id        uuid              primary key references tracker.teams(id) on delete cascade,
    tier           tracker.prowl_tier not null default 'kit',
    monthly_points integer,
    -- Rolling period anchor. balance = allowance − Σ(points since period_start).
    -- Defaults to the start of the current UTC month; a real billing provider
    -- will advance this on renewal (no cron in this stack — the provider drives it).
    period_start   timestamptz       not null default date_trunc('month', now() at time zone 'utc'),
    status         text              not null default 'active',
    created_at     timestamptz       not null default now(),
    updated_at     timestamptz       not null default now(),
    constraint team_subscriptions_status_chk check (status in ('active', 'past_due', 'canceled')),
    constraint team_subscriptions_points_chk check (monthly_points is null or monthly_points >= 0)
);

drop trigger if exists touch_team_subscriptions on tracker.team_subscriptions;
create trigger touch_team_subscriptions before update on tracker.team_subscriptions
    for each row execute function tracker.touch_updated_at();

-- ─── prowl_usage_events — the append-only usage ledger ───────────────────────
-- One row per metered model call. project_id is a denormalised convenience with
-- NO FK: a call's spend must survive the project's deletion (you still billed it),
-- and skipping the constraint keeps the hot-path insert cheap.
create table if not exists tracker.prowl_usage_events (
    id            uuid        primary key default gen_random_uuid(),
    team_id       uuid        not null references tracker.teams(id) on delete cascade,
    user_id       uuid        references auth.users(id) on delete set null,
    -- What was called: 'issue_analyse' | 'compose' | 'embed' | 'query' | 'chat'
    -- | 'pr_analyse' | 'deep_dive'. Free text (not an enum) so a new analyser
    -- endpoint can be metered without a migration.
    kind          text        not null,
    model         text,
    -- The raw signal the analyser records (it is the SOLE writer — see the
    -- analyser's internal/server/usage.go). cost_usd is the billed truth; Prowl
    -- Points are DERIVED from it at read time (modules/billing pointsFromCostUsd),
    -- never stored — so the rate lives in one place and can't drift from schema.
    cost_usd      numeric(12, 6),
    input_tokens  integer,
    output_tokens integer,
    project_id    uuid,
    meta          jsonb       not null default '{}'::jsonb,
    created_at    timestamptz not null default now()
);
create index if not exists prowl_usage_events_team_time_idx
    on tracker.prowl_usage_events(team_id, created_at desc);

-- ─── prowl_usage_period — the maintained rollup (the READ path) ──────────────
-- prowl_usage_events is the immutable audit log; summing it on every balance read
-- is O(rows-this-period) and the balance pill reads app-wide, so instead a trigger
-- keeps a per-team-per-period counter. Reads become a single-row lookup, flat
-- regardless of event volume. The rollup is DERIVED — it can be rebuilt from the
-- events at any time (insert…select sum group by). Period = the calendar UTC month
-- (matches how the API anchors period_start); a custom-renewal billing provider
-- would key this to the subscription period instead.
create table if not exists tracker.prowl_usage_period (
    team_id      uuid        not null references tracker.teams(id) on delete cascade,
    period_start timestamptz not null,
    -- Summed raw cost for the period; the balance derives points from this.
    cost_usd     numeric(14, 6) not null default 0,
    calls        integer     not null default 0,
    updated_at   timestamptz not null default now(),
    primary key (team_id, period_start)
);

-- Fold each inserted usage event's raw cost into its team's current-period
-- counter. Runs in the insert's transaction (atomic + consistent). SECURITY
-- DEFINER so it maintains the rollup regardless of who inserted (the service-role
-- analyser today).
create or replace function tracker.prowl_rollup_usage()
returns trigger language plpgsql security definer set search_path = tracker, pg_temp as $$
begin
    insert into tracker.prowl_usage_period(team_id, period_start, cost_usd, calls)
    values (
        new.team_id,
        date_trunc('month', new.created_at at time zone 'utc'),
        coalesce(new.cost_usd, 0),
        1
    )
    on conflict (team_id, period_start) do update set
        cost_usd   = prowl_usage_period.cost_usd + excluded.cost_usd,
        calls      = prowl_usage_period.calls + 1,
        updated_at = now();
    return new;
end $$;

drop trigger if exists prowl_rollup_on_usage on tracker.prowl_usage_events;
create trigger prowl_rollup_on_usage after insert on tracker.prowl_usage_events
    for each row execute function tracker.prowl_rollup_usage();

-- ─── auto-provision a Kit subscription for every team ────────────────────────
-- Mirrors 0052's ensure_personal_team pattern: new teams get a free-tier row on
-- insert (SECURITY DEFINER so it runs regardless of the caller's RLS), and
-- existing teams are backfilled below. There is no cron to repair drift, so the
-- trigger is the durable guarantee that every team has exactly one subscription.
create or replace function tracker.ensure_team_subscription()
returns trigger language plpgsql security definer set search_path = tracker, pg_temp as $$
begin
    insert into tracker.team_subscriptions(team_id, tier)
    values (new.id, 'kit')
    on conflict (team_id) do nothing;
    return new;
end $$;

drop trigger if exists ensure_subscription_on_team on tracker.teams;
create trigger ensure_subscription_on_team after insert on tracker.teams
    for each row execute function tracker.ensure_team_subscription();

-- Backfill: every existing team starts on Kit.
insert into tracker.team_subscriptions(team_id, tier)
select id, 'kit' from tracker.teams
on conflict (team_id) do nothing;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table tracker.team_subscriptions  enable row level security;
alter table tracker.prowl_usage_events   enable row level security;
alter table tracker.prowl_usage_period   enable row level security;

-- Subscriptions: any team member may read; only admins may change the tier from
-- the app (the billing provider writes via the service role, which bypasses RLS).
drop policy if exists team_subscriptions_member_select on tracker.team_subscriptions;
create policy team_subscriptions_member_select on tracker.team_subscriptions
    for select using (tracker.is_team_member(team_id));

drop policy if exists team_subscriptions_admin_update on tracker.team_subscriptions;
create policy team_subscriptions_admin_update on tracker.team_subscriptions
    for update using (tracker.is_team_admin(team_id)) with check (tracker.is_team_admin(team_id));

-- Usage events: members read their team's spend. NO insert/update/delete policy —
-- the append-only ledger is written exclusively by the service-role metering
-- layer, so members can never forge or erase usage.
drop policy if exists prowl_usage_events_member_select on tracker.prowl_usage_events;
create policy prowl_usage_events_member_select on tracker.prowl_usage_events
    for select using (tracker.is_team_member(team_id));

-- Usage rollup: members read their team's counter. Written only by the trigger
-- (SECURITY DEFINER) / service role — no client write policy.
drop policy if exists prowl_usage_period_member_select on tracker.prowl_usage_period;
create policy prowl_usage_period_member_select on tracker.prowl_usage_period
    for select using (tracker.is_team_member(team_id));

-- ─── grants (0001's blanket grant predates these tables) ─────────────────────
grant select, update on tracker.team_subscriptions to authenticated;
grant all           on tracker.team_subscriptions to service_role;
grant select         on tracker.prowl_usage_events to authenticated;
grant all           on tracker.prowl_usage_events to service_role;
grant select         on tracker.prowl_usage_period to authenticated;
grant all           on tracker.prowl_usage_period to service_role;


-- ═══ MIGRATION: 0060_mcp_integration.sql ═══

-- Treat "expose this project's knowledge base over MCP" as a per-project
-- integration, mirroring tracker.project_public_integration (0011).
--
--   tracker.project_mcp_integration — one row per project, opt-in.
--   Projects default to DISABLED: a knowledge base is only reachable by an
--   MCP client once someone deliberately turns it on.
--
-- AUTHORISATION — the TEAM-AWARE pattern, not 0011's original owner-only one.
-- 0011 shipped before teams; migration 0052 moved every project-gated table to
-- the coarse team gate and explicitly rewrote project_public_integration's
-- policy to `tracker.member_of_project_team(project_id)`. A fresh owner-scoped
-- (projects.user_id = auth.uid()) policy would be inconsistent with that and
-- would break outright for team-owned projects whose creator has left
-- (projects.user_id is nullable since 0052). So this table is born team-aware.
--
-- The finer intra-team rule — only an admin/owner may FLIP the switch — is
-- enforced in the app layer (the PATCH route's requireRole(role, "admin")),
-- matching the hybrid model 0052/0059 describe: coarse tenant isolation in RLS,
-- rich role logic in modules/access.
--
-- SERVICE ROLE: the MCP server resolves a project's exposure without a browser
-- session, so it reads this table through Supabase.service() (RLS bypass). The
-- service_role grant below is load-bearing, not boilerplate.

-- ─── tracker.project_mcp_integration ────────────────────────────────────────
create table if not exists tracker.project_mcp_integration (
    project_id  uuid primary key references tracker.projects(id) on delete cascade,
    enabled     boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

drop trigger if exists touch_project_mcp_integration on tracker.project_mcp_integration;
create trigger touch_project_mcp_integration
    before update on tracker.project_mcp_integration
    for each row execute function tracker.touch_updated_at();

alter table tracker.project_mcp_integration enable row level security;

-- Coarse tenant backstop: a row is visible/writable iff you are a member of the
-- team that owns the project. Cross-team access is impossible by construction.
drop policy if exists project_mcp_integration_owner_all on tracker.project_mcp_integration;
drop policy if exists project_mcp_integration_team_all  on tracker.project_mcp_integration;
create policy project_mcp_integration_team_all on tracker.project_mcp_integration
    for all
    using      (tracker.member_of_project_team(project_id))
    with check (tracker.member_of_project_team(project_id));

grant all on tracker.project_mcp_integration to authenticated, service_role;

-- Deliberately NO backfill: exposing a knowledge base is opt-in, so every
-- existing project starts with no row, which the app reads as disabled.


-- ═══ MIGRATION: 0061_mcp_oauth.sql ═══

-- tracker.mcp_oauth_clients / _codes / _tokens — the backing store for the
-- self-contained OAuth 2.1 Authorization Server this app exposes so Claude
-- (Claude Code / Desktop / claude.ai) can authorize against the remote MCP
-- server at /api/mcp.
--
-- The Authorization Server and the Resource Server are the SAME app, so there
-- is no JWT to verify: access tokens are OPAQUE random strings and validation
-- is a lookup in mcp_oauth_tokens. That buys instant revocation (revoked_at)
-- and costs no signing key — mirroring the precedent set by tracker.relay_workers
-- (0033), whose opaque per-user bearer token works exactly the same way.
--
-- SECRETS ARE NEVER STORED IN THE CLEAR. Only SHA-256 hashes (base64url) of the
-- authorization code, the access token, the refresh token and any client secret
-- land in these tables; a database leak therefore yields nothing replayable.
--
-- SERVICE ROLE is load-bearing here, not boilerplate. The token endpoint has no
-- cookie (it is called by a CLI/desktop client), and the authorization code is
-- minted before any bearer token exists, so every write below happens through
-- Supabase.service() with RLS bypassed. Because RLS is bypassed there, the app
-- repositories filter every query explicitly (client_id / user_id / revoked_at /
-- expires_at) — see modules/mcp-oauth/infrastructure.
--
-- RLS is still enabled on all three tables so that the ONLY thing a signed-in
-- user can reach with their anon key is their OWN token rows: read them (to list
-- "connected MCP clients") and revoke them (update revoked_at). Column-level
-- grants make that literal — `authenticated` may update revoked_at and nothing
-- else. Clients and codes get no user-facing policy at all; with RLS enabled and
-- no policy, `authenticated` sees zero rows.

-- ─── tracker.mcp_oauth_clients ──────────────────────────────────────────────
-- One row per client registered through RFC 7591 Dynamic Client Registration.
-- Claude registers itself as a PUBLIC client (token_endpoint_auth_method 'none',
-- no secret) and relies on PKCE; the confidential case is supported for
-- completeness (client_secret_hash non-null).
create table if not exists tracker.mcp_oauth_clients (
    client_id                   text        primary key,
    -- SHA-256 (base64url) of the client secret. NULL for public clients.
    client_secret_hash          text,
    client_name                 text        not null default 'Unnamed client',
    -- Exact-match allow-list. An authorize request whose redirect_uri is not
    -- byte-identical to one of these is refused WITHOUT redirecting.
    redirect_uris               text[]      not null,
    grant_types                 text[]      not null default array['authorization_code', 'refresh_token'],
    token_endpoint_auth_method  text        not null default 'none',
    client_uri                  text,
    created_at                  timestamptz not null default now(),
    constraint mcp_oauth_clients_redirect_uris_not_empty
        check (array_length(redirect_uris, 1) >= 1),
    constraint mcp_oauth_clients_auth_method_known
        check (token_endpoint_auth_method in ('none', 'client_secret_basic', 'client_secret_post'))
);

alter table tracker.mcp_oauth_clients enable row level security;

-- No policy: only the service role (which bypasses RLS) touches this table.
grant all on tracker.mcp_oauth_clients to service_role;

-- ─── tracker.mcp_oauth_codes ────────────────────────────────────────────────
-- Single-use, ~60s authorization codes. The row is keyed by the code's HASH, so
-- the code itself exists only in the redirect that carried it. `consumed_at` is
-- stamped by a conditional UPDATE ... where consumed_at is null, which makes
-- consumption atomic: a replayed code loses the race, and the token endpoint
-- then revokes every token previously issued from it (RFC 6749 §4.1.2).
create table if not exists tracker.mcp_oauth_codes (
    code_hash               text        primary key,
    client_id               text        not null references tracker.mcp_oauth_clients(client_id) on delete cascade,
    user_id                 uuid        not null references auth.users(id) on delete cascade,
    -- Bound at mint time; the token request must present the identical value.
    redirect_uri            text        not null,
    -- PKCE (RFC 7636). S256 only — 'plain' is rejected at the authorize endpoint.
    code_challenge          text        not null,
    code_challenge_method   text        not null default 'S256'
                            check (code_challenge_method = 'S256'),
    scope                   text        not null default 'mcp:read',
    -- RFC 8707 resource indicator, i.e. <APP_URL>/api/mcp. Optional.
    resource                text,
    expires_at              timestamptz not null,
    consumed_at             timestamptz,
    created_at              timestamptz not null default now()
);

create index if not exists mcp_oauth_codes_client_idx  on tracker.mcp_oauth_codes (client_id);
create index if not exists mcp_oauth_codes_user_idx    on tracker.mcp_oauth_codes (user_id);
create index if not exists mcp_oauth_codes_expires_idx on tracker.mcp_oauth_codes (expires_at);

alter table tracker.mcp_oauth_codes enable row level security;

-- No policy: codes are only ever read/written by the service role.
grant all on tracker.mcp_oauth_codes to service_role;

-- ─── tracker.mcp_oauth_tokens ───────────────────────────────────────────────
-- One row per issued access/refresh pair. Refresh rotation inserts a NEW row and
-- stamps revoked_at on the old one, so the table doubles as the audit trail of a
-- client's session chain. `code_hash` records which authorization code minted the
-- row, which is what lets a detected code replay revoke the tokens that code
-- already produced.
create table if not exists tracker.mcp_oauth_tokens (
    id                  uuid        primary key default gen_random_uuid(),
    -- SHA-256 (base64url) of the opaque access token ("bmcp_…").
    token_hash          text        not null unique,
    -- SHA-256 (base64url) of the opaque refresh token ("bmcp_rt_…"). NULL when
    -- the grant issued no refresh token.
    refresh_hash        text        unique,
    client_id           text        not null references tracker.mcp_oauth_clients(client_id) on delete cascade,
    user_id             uuid        not null references auth.users(id) on delete cascade,
    scope               text        not null default 'mcp:read',
    expires_at          timestamptz not null,
    refresh_expires_at  timestamptz,
    -- Set on explicit revoke, on refresh rotation, and on replay detection.
    -- A non-null value makes the token stop resolving immediately.
    revoked_at          timestamptz,
    last_used_at        timestamptz,
    created_at          timestamptz not null default now(),
    -- Provenance: the authorization code this pair descends from. Carried across
    -- refresh rotations so replay revocation reaches the whole chain.
    code_hash           text
);

-- token_hash / refresh_hash are already indexed by their UNIQUE constraints.
create index if not exists mcp_oauth_tokens_user_idx    on tracker.mcp_oauth_tokens (user_id);
create index if not exists mcp_oauth_tokens_client_idx  on tracker.mcp_oauth_tokens (client_id);
create index if not exists mcp_oauth_tokens_code_idx    on tracker.mcp_oauth_tokens (code_hash)
    where code_hash is not null;
create index if not exists mcp_oauth_tokens_active_idx  on tracker.mcp_oauth_tokens (user_id, client_id)
    where revoked_at is null;

alter table tracker.mcp_oauth_tokens enable row level security;

-- A signed-in user may LIST their own connected clients …
drop policy if exists mcp_oauth_tokens_owner_select on tracker.mcp_oauth_tokens;
create policy mcp_oauth_tokens_owner_select on tracker.mcp_oauth_tokens
    for select using (user_id = auth.uid());

-- … and REVOKE them. The column grant below narrows this to revoked_at, so the
-- policy cannot be used to re-point a token at another user or extend its life.
drop policy if exists mcp_oauth_tokens_owner_revoke on tracker.mcp_oauth_tokens;
create policy mcp_oauth_tokens_owner_revoke on tracker.mcp_oauth_tokens
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on tracker.mcp_oauth_tokens to authenticated;
grant update (revoked_at) on tracker.mcp_oauth_tokens to authenticated;
grant all on tracker.mcp_oauth_tokens to service_role;


-- ═══ MIGRATION: 0062_project_region.sql ═══

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


-- ═══ MIGRATION: 0063_issue_embeddings_partitioned.sql ═══

-- 0063_issue_embeddings_partitioned.sql — write down the deployed shape of
-- tracker.issue_embeddings, which has never been in a migration.
--
-- ─── The drift ───────────────────────────────────────────────────────────────
--
-- 0015 checked in a PLAIN table keyed by issue_id, with an HNSW cosine index.
-- What is actually deployed is:
--
--   * PARTITIONED BY HASH (project_id) into 16 partitions (_p0 … _p15)
--   * primary key (project_id, issue_id)          — not (issue_id)
--   * an extra project_id column, NOT NULL, FK → projects(id) ON DELETE CASCADE
--   * NO HNSW index. Not on the parent, not on any partition.
--
-- The partitioning was applied directly to the hosted database and never written
-- down, so replaying supabase/migrations into an empty Postgres has been
-- producing a schema that differs from production in the primary key, the column
-- list, and the index set. Harmless while there is one database. Fatal with two:
-- a second region built from these files would diverge silently, and every bug
-- after that becomes a two-region bug that reproduces in only one of them.
--
-- ─── What this migration does ────────────────────────────────────────────────
--
-- Against PRODUCTION: nothing. It detects the partitioned table and returns.
-- Against a FRESH REPLAY: drops 0015's plain table (empty by definition at this
-- point) and rebuilds it in the deployed shape, then restores the RLS policy that
-- 0052 attached and the touch trigger 0015 attached, both of which go with the
-- dropped table.
-- Against ANYTHING ELSE — an unpartitioned table that already holds rows — it
-- refuses. That is a database nobody expected to exist, and silently dropping
-- embeddings to reshape it would be the wrong call to make automatically.
--
-- ─── Deliberately NOT restoring the HNSW index ───────────────────────────────
--
-- 0015 created `issue_embeddings_hnsw_idx`; production does not have it. This
-- migration reproduces production, so it does not recreate it either — the point
-- of the file is to make the two agree, not to quietly change how similarity
-- search behaves. Note what that means today: with hash partitioning, a
-- project-scoped lookup prunes to one partition and index-scans the (project_id,
-- issue_id) prefix, then does an EXACT k-NN over that project's rows. Exact
-- beats approximate for correctness and is fine at current per-project row
-- counts; it degrades linearly as any single project grows. Adding HNSW back is
-- a deliberate performance decision with its own migration, not a side effect of
-- this one.

do $$
declare
    v_relkind "char";
    v_rows    bigint;
begin
    select c.relkind into v_relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'tracker' and c.relname = 'issue_embeddings';

    if v_relkind is null then
        raise exception 'tracker.issue_embeddings is missing — 0015 must run before 0063';
    end if;

    -- Production, and any database already reconciled by this migration.
    if v_relkind = 'p' then
        raise notice '0063: issue_embeddings already partitioned — nothing to do';
        return;
    end if;

    execute 'select count(*) from tracker.issue_embeddings' into v_rows;
    if v_rows > 0 then
        raise exception
            'tracker.issue_embeddings is not partitioned but holds % row(s). Refusing to rebuild — move the data yourself, then re-run.', v_rows;
    end if;

    -- Fresh replay: 0015's table is empty. Dropping it also removes the policy
    -- 0052 created and the touch trigger 0015 created; both are restored below.
    -- No CASCADE: nothing should depend on this table, and if something does we
    -- want to hear about it rather than lose it silently.
    drop table tracker.issue_embeddings;

    create table tracker.issue_embeddings (
        -- Partition key first: it leads the primary key, which is what lets a
        -- project-scoped read prune to one partition and then index-scan.
        project_id  uuid         not null references tracker.projects(id) on delete cascade,
        issue_id    uuid         not null references tracker.issues(id)   on delete cascade,
        embedding   vector(1536) not null,
        -- Which model produced the vector, so a re-embed sweep can target only
        -- rows from an older model.
        model       text         not null default 'text-embedding-3-small',
        created_at  timestamptz  not null default now(),
        updated_at  timestamptz  not null default now(),
        primary key (project_id, issue_id)
    ) partition by hash (project_id);

    for i in 0..15 loop
        execute format(
            'create table tracker.issue_embeddings_p%s partition of tracker.issue_embeddings for values with (modulus 16, remainder %s)',
            i, i
        );
    end loop;

    execute 'alter table tracker.issue_embeddings enable row level security';

    -- The team policy from 0052 (its owner-era predecessor died with the table).
    -- Walks issue → project → team_members via the SECURITY DEFINER helper.
    execute $ddl$
        create policy issue_embeddings_team_all on tracker.issue_embeddings
            for all using (tracker.member_of_issue_team(issue_id))
                with check (tracker.member_of_issue_team(issue_id))
    $ddl$;

    execute 'grant all on tracker.issue_embeddings to authenticated, service_role';

    -- 0015's updated_at trigger. Declared on the parent so it applies to every
    -- partition, including ones added later.
    execute $ddl$
        create trigger touch_issue_embeddings
            before update on tracker.issue_embeddings
            for each row execute function tracker.touch_updated_at()
    $ddl$;

    raise notice '0063: rebuilt issue_embeddings as 16-way hash partitions on project_id';
end $$;

comment on table tracker.issue_embeddings is
    'Per-issue embedding vectors. HASH-partitioned on project_id (16 ways) so a project-scoped similarity search prunes to one partition. Upserts must carry project_id and conflict on (project_id, issue_id) — see modules/issues/infrastructure/SupabaseEmbeddingIndex.ts.';


-- ═══ MIGRATION: 0064_team_placement.sql ═══

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


-- ═══ MIGRATION: 0065_create_team_placement.sql ═══

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


-- ═══ MIGRATION: 0066_create_team_explicit_user.sql ═══

-- 0066_create_team_explicit_user.sql — create_team takes the caller explicitly.
--
-- The server is moving from a per-request RLS client to a service-role client:
-- authorization is decided by AccessService before any query runs, and the
-- database is no longer asked to re-derive it. Under service-role `auth.uid()` is
-- NULL, so `create_team` — which used it both as a gate and as `created_by` —
-- would raise 'auth required' on every call.
--
-- ensure_personal_team already solved this: it takes `p_user` and asserts it
-- matches the session when there IS one. This copies that shape exactly, so both
-- team-creation paths behave the same way under both kinds of client.
--
-- The assertion is the important part. With an RLS client (a browser-issued JWT)
-- `auth.uid()` is set, and passing someone else's id is rejected — so this does
-- not become a way to create teams as another user. With a service-role client
-- there is no session to check against, and the caller is the server, which has
-- already established who is asking.

drop function if exists tracker.create_team(text, text, text);

create or replace function tracker.create_team(p_name text, p_region text, p_cell text, p_user uuid)
returns uuid language plpgsql security definer set search_path = tracker, pg_temp as $$
declare v_team uuid;
begin
    if p_user is null then
        raise exception 'user required' using errcode = '42501';
    end if;
    -- Mirrors ensure_personal_team: when a session exists it must be the same
    -- user. Null (service-role) means the server is calling on someone's behalf
    -- and has already authorised it.
    if auth.uid() is not null and auth.uid() <> p_user then
        raise exception 'cannot create a team as another user' using errcode = '42501';
    end if;
    if length(trim(coalesce(p_name, ''))) = 0 then
        raise exception 'name required' using errcode = '22000';
    end if;
    if length(trim(coalesce(p_region, ''))) = 0 or length(trim(coalesce(p_cell, ''))) = 0 then
        raise exception 'placement required' using errcode = '22000';
    end if;

    insert into tracker.teams (name, is_personal, created_by, region, cell)
    values (trim(p_name), false, p_user, trim(p_region), trim(p_cell))
    returning id into v_team;

    insert into tracker.team_members (team_id, user_id, role)
    values (v_team, p_user, 'owner');

    return v_team;
end $$;

grant execute on function tracker.create_team(text, text, text, uuid) to authenticated, service_role;
revoke execute on function tracker.create_team(text, text, text, uuid) from public, anon;


-- ═══ MIGRATION: 0067_rls_as_reachability_fuse.sql ═══

-- 0067_rls_as_reachability_fuse.sql — retire RLS as an authorization system.
--
-- ─── What changes ────────────────────────────────────────────────────────────
--
-- Policies are dropped from every tenant table. RLS stays ENABLED, which with no
-- policy means deny-all: `anon` and `authenticated` get nothing. The server
-- reads with service-role, which bypasses RLS entirely.
--
-- So RLS stops being a second opinion on who may see what, and becomes a blunt
-- fuse: "can this table be reached at all with the public key?" — answer, no.
--
-- ─── Why ─────────────────────────────────────────────────────────────────────
--
-- Authorization was TWO systems that had to agree. The database enforced a COARSE
-- rule (is_team_member — any member of the team, any of its projects) while the
-- actual rule lived in AccessService (a plain member sees only projects granted
-- to one of their access groups). The database was never expressing the real
-- policy; it was a net underneath one.
--
-- And the net hid holes. Twelve routes and repository methods turned out to have
-- no check of their own — POST /api/issues took project_id straight from the
-- request body, GET /api/sessions/overview called listAll(), notifications were
-- read and marked with no owner filter. Every one of them worked, because RLS was
-- quietly narrowing the result. A single explicit gate makes that class of bug
-- fail loudly instead of silently passing.
--
-- What replaces the net is not nothing. It is two invariants enforced in CI:
--   lib/server/http/route-authz.test.ts        every route reaching tenant data
--                                              carries a tenant guard, per
--                                              HANDLER, not per file
--   lib/server/http/repository-scoping.test.ts every tenant query carries a
--                                              predicate; every mutation a KEYED
--                                              one
--
-- ─── What keeps its policies, and why that is not optional ───────────────────
--
-- NEXT_PUBLIC_SUPABASE_ANON_KEY ships in the browser bundle. For any table the
-- browser can reach, RLS is not defence in depth — it is the only thing between
-- a published key and the data. The browser holds a direct Supabase connection
-- for auth and for postgres_changes on exactly three tables, so those three keep
-- real, working policies:
--
--   project_analyser     indexing progress, watched live by the analyser panel
--   issue_suggestions    analyser output, watched by the suggestion box
--   notifications        the in-app feed
--
-- Reference tables (icon_catalog*) keep their read-only `using (true)` policies:
-- they are shared data owned by nobody, and dropping them would break nothing
-- while making the intent less clear.

do $$
declare
    r record;
    -- Browser-reachable over realtime — these MUST keep enforcing.
    keep constant text[] := array[
        'project_analyser', 'issue_suggestions', 'notifications',
        'icon_catalog', 'icon_catalog_meta'
    ];
begin
    for r in
        select schemaname, tablename, policyname
        from pg_policies
        where schemaname = 'tracker'
          and tablename <> all (keep)
        order by tablename, policyname
    loop
        execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
        raise notice '0067: dropped %.% policy %', r.schemaname, r.tablename, r.policyname;
    end loop;
end $$;

-- RLS stays ON everywhere. Enabled-with-no-policy is deny-all, which is exactly
-- the fuse we want: a leaked anon key reads nothing. Re-assert it rather than
-- assume, since a table added later could have arrived without it.
do $$
declare t record;
begin
    for t in
        select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'tracker' and c.relkind in ('r', 'p') and not c.relrowsecurity
    loop
        execute format('alter table tracker.%I enable row level security', t.relname);
        raise notice '0067: enabled RLS on tracker.%', t.relname;
    end loop;
end $$;

-- The SECURITY DEFINER helpers (is_team_member, member_of_project_team, …) are
-- deliberately left in place. Nothing calls them once the policies are gone, but
-- they are the only remaining description of the coarse rule, and dropping them
-- is a separate cleanup that should not ride along with a behaviour change.


-- ═══ MIGRATION: 0068_issue_suggestions_soft_issue_ref.sql ═══

-- 0068_issue_suggestions_soft_issue_ref.sql — the last cross-plane foreign key.
--
-- `issue_suggestions` is CONTROL plane: it is one of the three tables in the
-- supabase_realtime publication, so the browser subscribes to it directly and it
-- has to live where the browser's JWT is valid. `issues` is DATA plane and moves
-- with the region.
--
-- That makes issue_suggestions.issue_id → issues a constraint spanning two
-- databases, which Postgres cannot express. Left in place, the first suggestion
-- written for a Bangkok issue is rejected: the central database looks for that
-- issue id in its own `issues` table and does not find it. Analysis would run,
-- cost money, and fail at the last step with a foreign-key violation.
--
-- The column stays. `issue_id` still identifies the issue; it is simply resolved
-- by the application against whichever region holds it.
--
-- WHAT THIS COSTS, stated plainly: the constraint carried ON DELETE CASCADE, so
-- deleting an issue used to remove its cached suggestions for free. That is now
-- the application's job — see ProjectContentPurge, which clears regional content
-- and the central suggestions that point at it as one operation.
--
-- This is the ONLY central→regional foreign key. Everything else the control
-- plane references (projects, teams, users) stays central, which is why the
-- earlier `projects`-regional cut was abandoned: it put four of these in the way,
-- including one on team deletion.

alter table tracker.issue_suggestions
    drop constraint if exists issue_suggestions_issue_id_fkey;

comment on column tracker.issue_suggestions.issue_id is
    'The issue this suggestion is for. SOFT reference since 0068 — the issue row lives in its team''s region while this table is central, so no FK can span the two. Cleanup on issue/project deletion is done by ProjectContentPurge.';


-- ═══ MIGRATION: 0069_last_owner_allows_team_delete.sql ═══

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


-- ═══ MIGRATION: 0070_repo_uniqueness_per_team.sql ═══

-- 0070_repo_uniqueness_per_team.sql — one project per repo PER TEAM, not per install.
--
-- 0037 made a linked repo unique across the whole installation, and said why:
-- "One project per linked repo → unambiguous inbound routing." That was the
-- real reason. An inbound webhook carries a repo id and nothing else, so a
-- second project on the same repo left the receiver with no way to choose.
--
-- But the rule it bought is wrong for teams. Two teams tracking one repo is
-- ordinary — a platform team and a product team on the same service — and they
-- are separate tenants with separate members, issues and analyser graphs.
-- Uniqueness belongs inside the team.
--
-- Routing no longer needs the global rule. The webhook receivers now select
-- EVERY project matching the repo and apply the event to each (see the commit
-- that precedes this migration). That change shipped first, on purpose: it is a
-- no-op while one project per repo still holds, so it could be verified against
-- live traffic before this migration made two rows possible. Applying this
-- first would have made the first cross-team repo throw inside both receivers.
--
-- The bug this closes: the two indexes are both PARTIAL (`where … is not null`),
-- but gitlab_project_id is set at CREATE while github_repo_id stays null until
-- the App-install callback runs. So the GitLab index bit immediately and the
-- GitHub one did not — the same repo could be added to a second team over
-- GitHub but not over GitLab, purely as an accident of when each column gets
-- filled. Worse, that GitHub project worked right up until the second team
-- connected the App, at which point linking failed.
--
-- Widening a unique index is a RELAXATION: every row set that satisfied the
-- global rule satisfies the per-team one, so the new indexes cannot fail to
-- build on existing data. They are therefore created BEFORE the old ones are
-- dropped, leaving no window in which a repo is unconstrained.
--
-- projects.team_id is NOT NULL (0052), which matters here: a nullable leading
-- column would make every teamless row distinct under unique semantics and
-- quietly reopen the duplicate it is meant to close.

-- ─── GitHub ─────────────────────────────────────────────────────────────────
create unique index if not exists projects_team_github_repo_uniq
    on tracker.projects (team_id, github_repo_id)
    where github_repo_id is not null;

drop index if exists tracker.projects_github_repo_id_uniq;

-- ─── GitLab ─────────────────────────────────────────────────────────────────
-- Keeps gitlab_host in the key: the same numeric project id on two different
-- instances is two different repos (0057).
create unique index if not exists projects_team_gitlab_project_uniq
    on tracker.projects (team_id, gitlab_host, gitlab_project_id)
    where gitlab_project_id is not null;

drop index if exists tracker.projects_gitlab_instance_project_uniq;


-- ═══ MIGRATION: 0071_issue_analysis_started_at.sql ═══

-- 0071_issue_analysis_started_at.sql — let an abandoned analysis be recognised.
--
-- ensure() writes analysis_status='analysing' BEFORE dispatching the run, and
-- only the analyser's callback ever clears it. So when a callback is lost — an
-- unroutable address, a redeploy mid-run, the analyser dying — the row stays
-- 'analysing' forever, and every retry short-circuits on:
--
--     if (issue.analysis_status === 'analysing') return 'in_flight'
--
-- The issue becomes permanently unanalysable. There is no scheduler in this
-- stack to reap it, so today the only cure is a manual UPDATE.
--
-- The guard needs to know WHEN the run started, and no existing column can say.
-- updated_at is wrong for this: any unrelated edit refreshes it, so editing a
-- stuck issue would extend its stuck window rather than shorten it — exactly
-- backwards from what someone poking at a broken issue is trying to do.
--
-- Nullable with no backfill, deliberately. A row currently wedged in 'analysing'
-- has no start time, and the guard treats null as STALE — so every issue stuck
-- by this bug becomes retryable the moment this ships, with no data repair.
--
-- NOTE: `issues` is a REGIONAL table. Apply this to every cell's database, not
-- just the control one.

alter table tracker.issues
    add column if not exists analysis_started_at timestamptz;

comment on column tracker.issues.analysis_started_at is
    'When the current analysis run was dispatched. Set alongside analysis_status=''analysing''; '
    'read to decide whether an in-flight run has been abandoned. Null means unknown, which is '
    'treated as stale so pre-0071 wedged rows recover on their own.';


-- ═══ MIGRATION: 0072_project_duplicate_sensitivity.sql ═══

-- 0072_project_duplicate_sensitivity.sql — per-project duplicate sensitivity.
--
-- How similar two issues must be before we call one a likely duplicate of the
-- other. There is no correct value: a project filing terse, templated bug
-- reports has a very different similarity distribution from one filing long
-- prose, so the same cosine number means different things in each. It belongs to
-- the project, not to the codebase.
--
-- Stored as a NAME, not a number. The names are the product surface and the
-- numbers are a tuning detail — leaving the mapping in code means it can be
-- retuned (a new embedding model shifts every distribution) without a migration
-- and without rewriting rows whose stored number would silently change meaning.
--
-- Values, and note the inversion that makes this worth reading twice: LOW
-- sensitivity means a HIGH threshold. Low is fussy and flags almost nothing;
-- veryhigh is eager and will flag things that merely rhyme.
--
--     low      0.90    only near-identical
--     medium   0.80    the default
--     high     0.70    more matches, some wrong
--     veryhigh 0.65    noticeably more false positives
--
-- CHECK rather than an enum: adding a level to an enum needs ALTER TYPE and a
-- deploy ordering dance, while this is one migration and matches how the rest of
-- the schema treats small closed sets (see the region/cell format constraints).

alter table tracker.projects
    add column if not exists duplicate_sensitivity text not null default 'medium';

do $$ begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'projects_duplicate_sensitivity_valid'
          and conrelid = 'tracker.projects'::regclass
    ) then
        alter table tracker.projects
            add constraint projects_duplicate_sensitivity_valid
            check (duplicate_sensitivity in ('low', 'medium', 'high', 'veryhigh'));
    end if;
end $$;

comment on column tracker.projects.duplicate_sensitivity is
    'How eagerly to flag an issue as a likely duplicate. Names, not numbers — the '
    'cosine thresholds live in modules/issues/domain/DuplicateSensitivity.ts so they '
    'can be retuned without a migration. NOTE the inversion: low sensitivity = high '
    'threshold = fewer matches.';


-- ═══ MIGRATION: 0073_grant_tables_created_after_0001.sql ═══

-- 0073_grant_tables_created_after_0001.sql — repair two tables the API roles were
-- never granted on, and stop the next one from happening.
--
-- ─── The bug ─────────────────────────────────────────────────────────────────
--
-- 0001 grants with `on ALL TABLES in schema tracker`, which is a snapshot, not a
-- rule: it grants on the tables that exist AT THAT MOMENT and says nothing about
-- any table created later. So every migration since has had to carry its own
-- `grant all on tracker.<table> to authenticated, service_role`. Almost all of
-- them did. Two did not:
--
--   mind_context           0035 — reasoned explicitly about RLS ("no policies, so
--                                 only service_role, which bypasses RLS") and
--                                 concluded no grant was needed. RLS bypass is
--                                 not a table privilege; service_role still needs
--                                 the GRANT, and without it every access fails
--                                 with `permission denied for table mind_context`
--                                 regardless of role.
--   newsletter_subscribers 0053 — same omission, no stated reasoning.
--
-- Surfaced by project deletion: the regional purge clears mind_context by
-- project_id and threw there, which — by design — aborts the delete before the
-- project row is removed. The Mind chat's managed-context writes go through the
-- same table from the analyser, so those have been failing since 0035 too.
--
-- ─── Why granting these is not a widening ────────────────────────────────────
--
-- 0067 made RLS the reachability fuse: enabled with no policies on every tenant
-- table, so `anon` and `authenticated` read nothing whatever the grants say.
-- Both tables here are in exactly that state, and stay in it. The grant restores
-- what the schema assumes everywhere else — the API roles can address the table,
-- RLS decides whether they get rows — and matches the 30-odd tables that already
-- carry it.

-- Guarded on existence, because the file set and the deployed database do not
-- agree: `newsletter_subscribers` is absent from the hosted project even though
-- 0053 creates it. (0053 is a COLLIDING number — 0053_newsletter_subscribers and
-- 0053_notification_outbox — which is the likely reason one of the two never got
-- applied.) A repair migration is the wrong place to discover that; it should fix
-- what is there and say what it skipped.
do $$
declare
    t text;
begin
    foreach t in array array['mind_context', 'newsletter_subscribers'] loop
        if to_regclass('tracker.' || quote_ident(t)) is null then
            raise notice '0073: tracker.% does not exist here — skipped', t;
        else
            execute format('grant all on tracker.%I to authenticated, service_role', t);
            raise notice '0073: granted on tracker.%', t;
        end if;
    end loop;
end $$;

-- Re-run 0001's sweep to catch anything else that slipped through between then
-- and now. Idempotent, and the audit that found the two above says it is a no-op
-- today — it is here so this migration repairs the CLASS, not just the instance.
grant all     on all tables    in schema tracker to authenticated, service_role;
grant all     on all sequences in schema tracker to authenticated, service_role;
grant execute on all functions in schema tracker to authenticated, service_role;

-- And the actual fix: a RULE rather than another snapshot. Default privileges
-- apply to objects created LATER by the role that owns them, so a future
-- `create table tracker.x` is grantable without anyone remembering to say so.
--
-- Scoped to the role running this migration (the schema owner, which is also
-- what applies every other migration). A table created by some other role still
-- needs its own grant — but that is not how anything here is deployed.
alter default privileges in schema tracker
    grant all on tables to authenticated, service_role;
alter default privileges in schema tracker
    grant all on sequences to authenticated, service_role;
alter default privileges in schema tracker
    grant execute on functions to authenticated, service_role;

do $$ begin
    if to_regclass('tracker.mind_context') is not null then
        execute 'comment on table tracker.mind_context is '
            '''Mind chat managed context, written by the analyser with the service-role key. '
            'RLS is enabled with NO policies, which is what keeps anon/authenticated out — '
            'the grants in 0073 are addressability, not authorization (see 0067).''';
    end if;
end $$;


-- ═══ MIGRATION: 0074_beta_allowlist.sql ═══

-- 0074_beta_allowlist.sql — the beta whitelist moves out of the environment.
--
-- ─── What it replaced ────────────────────────────────────────────────────────
--
-- NEXT_PUBLIC_BETA_ALLOWED_EMAILS: a comma-separated list, baked into the client
-- bundle at build time. Three problems, all fatal to actually running a beta:
-- enrolling someone needs a redeploy, the list is public (it ships to every
-- visitor's browser), and there is no record of who was invited, by whom, or
-- when they first came through.
--
-- The env var SURVIVES as a staff bypass — a short list of our own addresses so
-- the team is never locked out by a bad row or an unapplied migration — and
-- nothing else. Beta enrolment happens here.
--
-- ─── How the gate reads this table ───────────────────────────────────────────
--
-- It doesn't, directly. The gate (lib/shared/BetaAccess.ts) runs in the BROWSER
-- as well as on the server, and since 0067 the browser reads nothing from
-- tracker.* — so a client-side `select` here would silently return zero rows and
-- lock everyone out. The flow instead is:
--
--   sign-in (or POST /api/beta/access)
--     → server looks the address up here with the service-role key
--     → on a hit, stamps `whitelisted: true` into the user's auth metadata
--       and records granted_at/granted_user below
--     → the flag now rides in the JWT, so every existing call site keeps its
--       synchronous check
--
-- Enrolment therefore takes effect on the user's next session refresh, which the
-- waitlist page triggers for itself. Removing a row does NOT evict anyone — the
-- stamp is already in their metadata; see the revoke note in
-- modules/beta/application/BetaEnrollmentService.ts.
--
-- ─── RLS ─────────────────────────────────────────────────────────────────────
--
-- Both tables are enabled with NO policies, per 0067: an email list is precisely
-- the kind of table that must be unreachable with the published anon key. Every
-- read and write below goes through the service-role client on the server.

-- ─── the allowlist: who is in the beta ───────────────────────────────────────
create table if not exists tracker.beta_allowlist (
    -- The address as the identity provider reports it, lower-cased. Primary key
    -- rather than a surrogate id: enrolment is BY address, an address is in the
    -- beta exactly once, and an upsert on conflict (email) is how re-inviting
    -- someone updates the note instead of failing.
    email        text        primary key,
    -- Who added them, when they were added, and a free-text note ("YC batch",
    -- "design partner") — the audit the env var never had. `invited_by` is a
    -- soft reference: no FK, because the enroller's account being deleted must
    -- not cascade into revoking the beta access they granted.
    invited_by   uuid,
    note         text,
    created_at   timestamptz not null default now(),
    -- Stamped the first time the address actually signs in and is let through.
    -- The gap between created_at and granted_at is "invited but never showed
    -- up", which is the one question an invite list always ends up being asked.
    granted_at   timestamptz,
    granted_user uuid,

    -- Normalisation is enforced, not assumed. The lookup is an equality match on
    -- this column, so a row inserted by hand from the SQL editor as
    -- "Foo@Example.com" would be a row that can never match anyone.
    constraint beta_allowlist_email_normalised
        check (email = lower(btrim(email)) and email like '%_@_%')
);

-- ─── the queue: who asked to be let in ───────────────────────────────────────
--
-- "Join the beta" on /waitlist used to write `beta_requested` into the user's
-- auth metadata and stop there — which meant the answer to "who wants in?" lived
-- in a place nothing can query without paging every auth user. Same list, in a
-- table you can sort.
create table if not exists tracker.beta_requests (
    email        text        primary key,
    -- The signed-in account that asked. Soft reference for the same reason as
    -- above, and because the queue outliving a deleted account is harmless.
    user_id      uuid,
    display_name text,
    requested_at timestamptz not null default now(),
    -- Which surface the request came from, so a second entry point later doesn't
    -- need a schema change to be told apart (same trick as newsletter_subscribers).
    source       text        not null default 'waitlist',

    constraint beta_requests_email_normalised
        check (email = lower(btrim(email)) and email like '%_@_%')
);

-- The queue is read newest-first and, once it is more than a screenful, filtered
-- to those not yet enrolled. Both are served by this.
create index if not exists beta_requests_requested_at_idx
    on tracker.beta_requests (requested_at desc);

alter table tracker.beta_allowlist enable row level security;
alter table tracker.beta_requests  enable row level security;

-- 0073 made these grants automatic for tables created after it (alter default
-- privileges), but stating them keeps the file readable on its own and costs
-- nothing if they are already in place.
grant all on tracker.beta_allowlist to authenticated, service_role;
grant all on tracker.beta_requests  to authenticated, service_role;

comment on table tracker.beta_allowlist is
    'Beta enrolment list — the source of truth that replaced '
    'NEXT_PUBLIC_BETA_ALLOWED_EMAILS. Read server-side only (service role); the '
    'browser gate reads the `whitelisted` auth-metadata flag stamped from here '
    'at sign-in. See modules/beta.';

comment on table tracker.beta_requests is
    'Waitlist queue — people who pressed "Join the beta". The list you enrol '
    'FROM; tracker.beta_allowlist is the list you enrol INTO.';

-- Seed: carry over the addresses that were in the env var, so applying this
-- migration never locks out whoever is already in. Idempotent, and the staff
-- bypass keeps working either way.
insert into tracker.beta_allowlist (email, note)
values ('peterphongpak@gmail.com', 'seeded from NEXT_PUBLIC_BETA_ALLOWED_EMAILS (0074)')
on conflict (email) do nothing;


-- ═══ MIGRATION: 0075_deleted_account_usage.sql ═══

-- 0075_deleted_account_usage.sql — free credits survive an account deletion.
--
-- ─── The hole ────────────────────────────────────────────────────────────────
--
-- Prowl's free allowance is per TEAM per calendar month (0059): a team's balance
-- is its tier allowance minus the spend recorded against (team_id, period_start).
-- Delete the account and the team goes with it; sign up again and the new team
-- gets a fresh Kit subscription with an untouched allowance. The whole monthly
-- limit resets for the price of two clicks, as often as you like.
--
-- ─── What is kept, and what is not ───────────────────────────────────────────
--
-- One row per deleted address: how much that person had spent in the month they
-- left, and nothing else. No name, no projects, no history, and NOT the address
-- itself — only a SHA-256 of it (peppered when BOBBY_ACCOUNT_PEPPER is set). The
-- row is write-once at deletion, read once at the next sign-up, and unreadable
-- to anyone who does not already know the email they are looking for.
--
-- That is the whole point of hashing here: the table can answer "has THIS address
-- deleted an account recently?" — which is the anti-abuse question — while being
-- useless as a list of people who left, which is not a list we have any business
-- keeping.
--
-- ─── Why it expires, and why the expiry is enforced in the query ─────────────
--
-- Retention is 30 days, comfortably longer than the abuse window (a calendar
-- month) so a row cannot expire in the middle of the period it protects.
--
-- There is NO SCHEDULER in this stack — no cron, no pg_cron, no OpenNext
-- scheduled handler — so nothing will come along and delete these rows for us.
-- An `expires_at` column that only a background job honours would be a promise
-- the deployment cannot keep. So every read filters on it (an expired row is
-- invisible, whether or not it is still on disk) and every write sweeps the
-- expired ones out. Retention is therefore a property of the queries, which do
-- run, rather than of a job that does not exist.

create table if not exists tracker.deleted_account_usage (
    -- SHA-256 of the lower-cased email, hex. Primary key: one row per address,
    -- and a later deletion by the same person REPLACES it rather than adding to
    -- it — by then the earlier figure has already been carried into the account
    -- being deleted, so the new snapshot includes it. Summing would double-count.
    email_hash   text        primary key,

    -- The UTC month the spend belongs to. The carry only applies when the person
    -- comes back INSIDE this same month: past its end the allowance would have
    -- reset for everybody, and charging them for a month they sat out would
    -- punish a legitimate return rather than an abusive one.
    period_start timestamptz not null,

    -- Raw cost, matching prowl_usage_events.cost_usd — points are derived from it
    -- at read time (modules/billing), never stored, so the rate can be retuned
    -- without rewriting history. `calls` is carried for the same reason the
    -- rollup carries it: it makes the restored row legible in the ledger.
    cost_usd     numeric(14, 6) not null default 0,
    calls        integer     not null default 0,

    deleted_at   timestamptz not null default now(),
    expires_at   timestamptz not null default now() + interval '30 days',

    constraint deleted_account_usage_hash_chk check (email_hash ~ '^[0-9a-f]{64}$'),
    constraint deleted_account_usage_expiry_chk check (expires_at > deleted_at)
);

-- The sweep that stands in for a cron job: every write path deletes what has
-- expired, so this index is what keeps that cheap.
create index if not exists deleted_account_usage_expires_idx
    on tracker.deleted_account_usage (expires_at);

alter table tracker.deleted_account_usage enable row level security;

grant all on tracker.deleted_account_usage to authenticated, service_role;

comment on table tracker.deleted_account_usage is
    'Anti-abuse tombstone: this month''s Prowl spend of a deleted account, keyed by '
    'a SHA-256 of the email, so deleting and re-registering cannot reset the free '
    'monthly allowance. Expires after 30 days; the expiry is enforced by every '
    'query because this stack has no scheduler to enforce it out of band. Written '
    'by DELETE /api/account, consumed by the next team the same address creates.';


-- ═══ MIGRATION: 0076_usage_subjects.sql ═══

-- 0076_usage_subjects.sql — usage stops belonging to teams.
--
-- ─── The problem this fixes ──────────────────────────────────────────────────
--
-- Prowl's free allowance is per TEAM per month, and a team is free to create and
-- free to delete. Both ends of that leak:
--
--   delete the ACCOUNT, sign up again   → new team, allowance reset
--   delete the TEAM, create another     → new team, allowance reset
--   just create a SECOND team           → another whole allowance, no deletion
--
-- 0075 patched the first case with a 30-day tombstone. It is superseded here,
-- and dropped at the bottom of this file: patching one door while two others
-- stand open was the wrong shape.
--
-- ─── The model ───────────────────────────────────────────────────────────────
--
-- Usage belongs to a USAGE SUBJECT — a durable billing identity keyed by the
-- owner's email, which is never deleted. Teams BIND to a subject:
--
--   usage_subjects        who the spend belongs to. Permanent.
--   usage_subject_teams   which team(s) have ever spent against that subject.
--
-- Deleting a team unbinds it; the subject, its ledger and its balance stay.
-- Creating a team binds it to the SAME subject, so the balance carries straight
-- over — automatically, with nothing to copy and nothing to expire.
--
-- Each email gets exactly two reserved slots:
--
--   personal   the personal team, bootstrapped with the account
--   free       the one free (Kit) team they may create
--
-- and one subject per PAID team beyond those. That is the whole quota, and it
-- survives every deletion, so "delete and recreate" stops being a reset and
-- becomes what it looks like: the same billing identity, continuing.
--
-- ─── Why the email, and why hashed ───────────────────────────────────────────
--
-- The email is the only identifier that survives an account being deleted and
-- recreated — user ids do not. It is stored as SHA-256 (peppered via
-- BOBBY_ACCOUNT_PEPPER) because this table now keeps rows FOREVER: it must be
-- able to answer "is this the same person?" without being a permanent list of
-- everyone who ever signed up. The hash answers that question and nothing else.
--
-- ─── Suspension ──────────────────────────────────────────────────────────────
--
-- A subject can be suspended: its data stays, its team can be read, and no new
-- usage may be recorded against it. Two ways in — the owner pausing a team to
-- free their one free slot for another team, and a paid plan ending with no free
-- slot available to fall back into. Both are the same state, so both leave by the
-- same door (resume, or subscribe).

-- ─── the durable billing identity ────────────────────────────────────────────
create table if not exists tracker.usage_subjects (
    id          uuid        primary key default gen_random_uuid(),
    -- SHA-256 of the lower-cased email (+ pepper). NOT a foreign key to
    -- auth.users, and that is the entire point: it outlives the account.
    owner_hash  text        not null,
    -- 'personal' and 'free' are the two reserved slots; 'paid' subjects are
    -- created per paid team and are not limited.
    slot        text        not null,
    -- 'active'   usage may be recorded
    -- 'suspended' data kept, nothing may be spent — see the header
    status      text        not null default 'active',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),

    constraint usage_subjects_slot_chk   check (slot in ('personal', 'free', 'paid')),
    constraint usage_subjects_status_chk check (status in ('active', 'suspended')),
    constraint usage_subjects_hash_chk   check (owner_hash ~ '^[0-9a-f]{64}$')
);

-- The quota, enforced by the database rather than by remembering to check: one
-- personal and one free subject per email, forever. Partial, so 'paid' subjects
-- are unconstrained.
create unique index if not exists usage_subjects_reserved_slot_key
    on tracker.usage_subjects (owner_hash, slot)
    where slot in ('personal', 'free');

create index if not exists usage_subjects_owner_idx on tracker.usage_subjects (owner_hash);

drop trigger if exists touch_usage_subjects on tracker.usage_subjects;
create trigger touch_usage_subjects before update on tracker.usage_subjects
    for each row execute function tracker.touch_updated_at();

-- ─── which teams have spent against a subject ────────────────────────────────
-- team_id carries NO foreign key on purpose. The row has to outlive the team —
-- that is what makes the balance survive a deletion — and a cascade would take
-- the mapping down with it, orphaning the very ledger rows it explains.
create table if not exists tracker.usage_subject_teams (
    team_id    uuid        primary key,
    subject_id uuid        not null references tracker.usage_subjects(id) on delete cascade,
    bound_at   timestamptz not null default now(),
    -- Set when the team is deleted or unbound. The row stays: it is how a
    -- subject's spend is found across every team it has ever had.
    unbound_at timestamptz
);

create index if not exists usage_subject_teams_subject_idx
    on tracker.usage_subject_teams (subject_id);

-- ─── break the cascades that were deleting the evidence ──────────────────────
--
-- prowl_usage_events.team_id and prowl_usage_period.team_id referenced
-- tracker.teams(id) ON DELETE CASCADE, so deleting a team erased its usage. Under
-- this model the team is a label on the spend, not its owner. The columns stay
-- (the analyser keeps writing team_id, unchanged — see internal/server/usage.go)
-- but they become SOFT references, resolved through usage_subject_teams.
do $$
declare c record;
begin
    for c in
        select conrelid::regclass as tbl, conname
        from pg_constraint
        where contype = 'f'
          and confrelid = 'tracker.teams'::regclass
          and conrelid in ('tracker.prowl_usage_events'::regclass, 'tracker.prowl_usage_period'::regclass)
    loop
        execute format('alter table %s drop constraint %I', c.tbl, c.conname);
        raise notice '0076: dropped %.% → teams cascade', c.tbl, c.conname;
    end loop;
end $$;

comment on column tracker.prowl_usage_events.team_id is
    'The team the spend was recorded against. SOFT reference since 0076 — no FK, '
    'because the row must survive the team being deleted. Ownership is '
    'usage_subject_teams → usage_subjects.';
comment on column tracker.prowl_usage_period.team_id is
    'See prowl_usage_events.team_id — soft reference since 0076.';

-- ─── suspension needs a status the subscription can hold too ─────────────────
-- team_subscriptions.status was ('active','past_due','canceled'). A suspended
-- team keeps its row and its tier history; it simply may not spend.
do $$ begin
    if exists (select 1 from pg_constraint where conname = 'team_subscriptions_status_chk') then
        alter table tracker.team_subscriptions drop constraint team_subscriptions_status_chk;
    end if;
    alter table tracker.team_subscriptions
        add constraint team_subscriptions_status_chk
        check (status in ('active', 'past_due', 'canceled', 'suspended'));
end $$;

alter table tracker.usage_subjects   enable row level security;
alter table tracker.usage_subject_teams enable row level security;

grant all on tracker.usage_subjects      to authenticated, service_role;
grant all on tracker.usage_subject_teams to authenticated, service_role;

comment on table tracker.usage_subjects is
    'Durable billing identity: who a team''s Prowl spend belongs to, keyed by a '
    'SHA-256 of the owner''s email so it survives the account and the team being '
    'deleted. Two reserved slots per email (personal, free) plus one per paid '
    'team. See modules/billing/domain/TeamSlots.ts.';
comment on table tracker.usage_subject_teams is
    'Every team that has ever spent against a usage subject. team_id is a SOFT '
    'reference — the row outlives the team, which is what makes a balance survive '
    'a team deletion and reattach to its replacement.';

-- ─── supersede 0075 ──────────────────────────────────────────────────────────
-- The 30-day, hash-keyed tombstone of a deleted account's spend. Same goal,
-- narrower mechanism: it only covered account deletion, only for a month, and it
-- copied numbers around instead of giving them an owner. Everything it did is a
-- consequence of the subject model above. Dropped rather than left dormant, so
-- there is one answer to "where does usage live".
drop table if exists tracker.deleted_account_usage;


-- ═══ MIGRATION: 0077_review_profiles.sql ═══

-- 0077_review_profiles.sql — a team can say what kind of PR reviewer it wants.
--
-- ─── What this stores ────────────────────────────────────────────────────────
--
-- A REVIEW PROFILE: the dials (how strict, what may block a merge, how much
-- evidence a blocker needs), the lenses (security, performance, migrations…),
-- and the team's own written instructions. The analyser compiles all of it into
-- one ReviewPolicy per run; see its ADR-0065.
--
-- ─── Why the team owns it and the project points at it ───────────────────────
--
-- The alternative — a profile per project — is the thing teams outgrow first.
-- A team with fifteen services has one opinion about code review, not fifteen,
-- and the second time somebody retypes "we wrap errors with %w" into a settings
-- box the feature has failed. So profiles are a team LIBRARY and each project
-- names one, which also makes "what changed about our reviews last month" a
-- question with one place to look.
--
-- projects.review_profile_id is NULLABLE and null means the built-in default —
-- the reviewer exactly as it behaved before profiles existed. That is the same
-- reason the analyser treats an absent policy as the default rather than as an
-- empty one: no row anywhere has to be backfilled for this migration to be
-- correct, and deleting a profile degrades its projects to the default instead
-- of breaking them (hence ON DELETE SET NULL).
--
-- ─── Why the dials are a jsonb blob and the lenses are an array ──────────────
--
-- The dials are a closed set TODAY and will not stay closed; every one added as
-- a column is a migration plus a deploy ordering dance for what is, to the
-- database, an opaque value it never filters on. The domain
-- (modules/analysis/domain/ReviewProfile.ts) owns the vocabulary and validates
-- it, exactly as DuplicateSensitivity owns its thresholds (0072) — the database
-- stores the choice, not the meaning.
--
-- Lenses are a text[] rather than jsonb because they ARE queried as a set: "how
-- many teams turned security on" is the first question this feature will be
-- asked, and `where 'security' = any(lenses)` beats digging through json.
--
-- ─── Why editing is privileged, and audited ──────────────────────────────────
--
-- The blocking dial decides what counts as a merge-blocking finding, and
-- modules/vcs/domain/MergeGate.ts refuses an in-app merge while any exist. So
-- editing a profile can loosen who is allowed to merge what. That makes it an
-- admin action (enforced in the route via AccessService — RLS is a fuse here,
-- not an authorization system, see 0067) and it makes updated_by worth keeping:
-- when a review gets quieter, somebody needs to be able to find out why.
--
-- ─── Grants ──────────────────────────────────────────────────────────────────
--
-- 0001's `grant on ALL TABLES` was a snapshot, not a rule, and two later tables
-- were missed and failed at runtime until 0073 repaired them. New table, own
-- grant. RLS enabled with no policies keeps it unreachable with the public key.

create table if not exists tracker.review_profiles (
    id            uuid primary key default gen_random_uuid(),
    team_id       uuid not null references tracker.teams(id) on delete cascade,

    name          text not null,
    -- The preset this profile started from ('balanced', 'gatekeeper', …), kept
    -- for the UI ("Custom, based on Gatekeeper") and so we can tell an untouched
    -- preset from a hand-tuned profile when asking whether presets are any good.
    preset        text,

    -- The dials, as {strictness, evidence, blocking, positivity, verbosity,
    -- voice, depth}. Unknown or missing keys resolve to the default ANALYSER-side
    -- as well, so a value written by a newer app never breaks an older cell.
    dials         jsonb not null default '{}'::jsonb,

    -- Enabled optional lenses. An EMPTY array is meaningful and distinct from
    -- null: it means "every optional lens off", which the analyser honours by
    -- running only the three that have deterministic enforcement behind them.
    lenses        text[] not null default '{}',

    -- The team's free text, and the glob-scoped kind as [{glob, text}]. Bounded
    -- and sanitised in the domain before it ever gets here; bounded AGAIN
    -- analyser-side, because a service does not trust its caller.
    instructions  text not null default '',
    path_rules    jsonb not null default '[]'::jsonb,

    created_by    uuid references auth.users(id) on delete set null,
    updated_by    uuid references auth.users(id) on delete set null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    constraint review_profiles_name_len check (char_length(name) between 1 and 60),
    -- The domain caps this at 2000 with a friendly error; this is the backstop
    -- that stops a direct writer parking a novel in a prompt.
    constraint review_profiles_instructions_len check (char_length(instructions) <= 2000),
    constraint review_profiles_lenses_len check (array_length(lenses, 1) is null or array_length(lenses, 1) <= 32),
    -- One name per team: the profile is chosen from a dropdown, and two
    -- "Strict"s in it is a support ticket.
    constraint review_profiles_name_unique unique (team_id, name)
);

create index if not exists review_profiles_team_idx on tracker.review_profiles(team_id);

alter table tracker.projects
    add column if not exists review_profile_id uuid
        references tracker.review_profiles(id) on delete set null;

create index if not exists projects_review_profile_idx
    on tracker.projects(review_profile_id)
    where review_profile_id is not null;

comment on table tracker.review_profiles is
    'A team''s saved PR-reviewer configuration: dials, lenses and instructions. '
    'The vocabulary lives in modules/analysis/domain/ReviewProfile.ts so it can be '
    'extended without a migration; this table stores the choice, not the meaning. '
    'Projects point at one (projects.review_profile_id); null means the built-in default.';

comment on column tracker.review_profiles.lenses is
    'Enabled OPTIONAL lenses. Empty array = all optional lenses off, which is '
    'distinct from the project having no profile at all. The three lenses with '
    'deterministic enforcement behind them (correctness, blast radius, test gaps) '
    'run regardless and are not listed here.';

comment on column tracker.projects.review_profile_id is
    'Which team review profile this project''s PR reviews run under. Null = the '
    'built-in default, i.e. the reviewer as it behaved before profiles existed. '
    'ON DELETE SET NULL so deleting a profile degrades its projects to the default '
    'rather than breaking their reviews.';

-- Keep updated_at honest without every writer remembering to.
create or replace function tracker.touch_review_profile()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists review_profiles_touch on tracker.review_profiles;
create trigger review_profiles_touch
    before update on tracker.review_profiles
    for each row execute function tracker.touch_review_profile();

-- Reachability fuse, per 0067: enabled, no policies, so the public key reads
-- nothing. Authorization is the app's job (AccessService), not the database's.
alter table tracker.review_profiles enable row level security;

grant all on tracker.review_profiles to authenticated, service_role;
