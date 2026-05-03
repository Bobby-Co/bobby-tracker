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
