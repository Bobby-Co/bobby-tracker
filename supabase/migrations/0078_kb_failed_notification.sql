-- tracker: tell people when INDEXING FAILS.
--
-- The gap this closes: tracker.project_analyser has always been able to end in
-- 'failed' with the reason in `last_error`, and nothing has ever announced it.
-- 0049 (and 0054 after it) only fire on the transition into 'ready'. So the one
-- outcome a user genuinely needs to act on — the repository they connected did
-- not get indexed, and every feature that depends on the knowledge base is
-- therefore quietly inert — was the one outcome the product never mentioned.
-- They wait for a "ready" mail that is never coming.
--
-- Two changes, both additive:
--   1. widen 0049's kind check so the feed can hold the new kind at all;
--   2. an outbox producer for it, mirroring enqueue_kb_indexed from 0054
--      exactly — same table, same transition-guard shape, same event envelope.
--
-- No existing trigger is touched and no row is rewritten.

-- ── 1. the feed may now hold kb_failed ──────────────────────────────────────
-- A check constraint is the one place the kind vocabulary is duplicated outside
-- the app (modules/notifications/domain/Events.ts is the source of truth). It is
-- kept because it is the last line of defence against a typo'd kind reaching the
-- tray, where it would render as an unstyled row on every page.
alter table tracker.notifications
    drop constraint if exists notifications_kind_valid;
alter table tracker.notifications
    add constraint notifications_kind_valid check (
        kind in ('kb_ready', 'kb_updated', 'kb_failed', 'pr_analysis_ready', 'pr_opened')
    );

-- ── 2. indexing failed → kb_failed ──────────────────────────────────────────
create or replace function tracker.enqueue_kb_failed()
returns trigger language plpgsql security definer as $$
declare
    v_name text;
begin
    -- Fire on the TRANSITION into 'failed', not on the state — the same guard
    -- enqueue_kb_indexed uses for 'ready', and for the same reason: the analyser
    -- PATCHes this row repeatedly while a job runs and may touch it again after,
    -- and without this a later write would announce the same failure twice.
    --
    -- A RETRY that fails again is a genuinely new failure and does announce
    -- itself, because reaching 'failed' a second time means passing through
    -- 'indexing' first, which makes it a real transition.
    if new.status <> 'failed' or old.status is not distinct from 'failed' then
        return null;
    end if;

    select name into v_name from tracker.projects where id = new.project_id;

    -- `reason` is the analyser's own last_error. It is carried on the event
    -- rather than looked up at send time because the analyser overwrites the
    -- column on the next attempt, and a notification is a point-in-time snapshot
    -- of what happened — not a live view of what the column says now.
    insert into tracker.notification_outbox (event)
    values (jsonb_build_object(
        'kind',        'kb_failed',
        'projectId',   new.project_id,
        'occurredAt',  to_jsonb(now()),
        'projectName', v_name,
        'reason',      new.last_error
    ));
    return null;
end $$;

-- UPDATE only, matching enqueue_kb_indexed: a project_analyser row is created
-- 'disabled'/'indexing' and reaches a terminal state by update, never by insert.
drop trigger if exists enqueue_kb_failed on tracker.project_analyser;
create trigger enqueue_kb_failed
    after update on tracker.project_analyser
    for each row execute function tracker.enqueue_kb_failed();

comment on function tracker.enqueue_kb_failed() is
    'Enqueues a kb_failed notification event when a project_analyser row '
    'transitions into failed. Mirrors enqueue_kb_indexed (0054); the reason is '
    'snapshotted from last_error because the analyser overwrites it on retry.';
