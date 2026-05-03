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
