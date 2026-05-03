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
