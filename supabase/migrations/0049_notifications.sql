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
