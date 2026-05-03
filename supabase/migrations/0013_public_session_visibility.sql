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
