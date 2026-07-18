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
