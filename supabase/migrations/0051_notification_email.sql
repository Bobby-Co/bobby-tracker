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
