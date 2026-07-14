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
