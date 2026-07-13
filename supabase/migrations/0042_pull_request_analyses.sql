-- tracker.pull_request_analyses — tracks Bobby's analysis of a GitHub PR so the
-- live comment can be edited in place and the run cancelled.
--
-- One row per (project, pr_number). id doubles as the analyser task_id (used to
-- correlate the result callback and to cancel). github_comment_id is the
-- placeholder comment Bobby posts; the callback edits it. head_sha lets us skip
-- redundant re-runs when a `synchronize` event carries the same head. status
-- mirrors the detached run lifecycle.
--
-- Written by the webhook + callback via the service-role client; owner-readable.

create table if not exists tracker.pull_request_analyses (
    id                uuid        primary key default gen_random_uuid(),
    project_id        uuid        not null references tracker.projects(id) on delete cascade,
    pr_number         int         not null,
    github_comment_id bigint,
    head_sha          text,
    status            text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint pull_request_analyses_project_pr_uniq unique (project_id, pr_number),
    constraint pull_request_analyses_status_valid
        check (status is null or status in ('analysing', 'done', 'failed', 'cancelled'))
);

create index if not exists pull_request_analyses_project_idx
    on tracker.pull_request_analyses (project_id);

drop trigger if exists touch_pull_request_analyses on tracker.pull_request_analyses;
create trigger touch_pull_request_analyses
    before update on tracker.pull_request_analyses
    for each row execute function tracker.touch_updated_at();

alter table tracker.pull_request_analyses enable row level security;

-- Owner-select (through project ownership); all writes are service-role.
drop policy if exists pull_request_analyses_owner_select on tracker.pull_request_analyses;
create policy pull_request_analyses_owner_select on tracker.pull_request_analyses
    for select using (
        exists (
            select 1 from tracker.projects p
            where p.id = pull_request_analyses.project_id and p.user_id = auth.uid()
        )
    );

grant all on tracker.pull_request_analyses to authenticated, service_role;
