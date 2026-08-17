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
