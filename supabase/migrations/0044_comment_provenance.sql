-- Two-way comment provenance: distinguish comments authored in the tracker (and
-- posted to GitHub as the real user) from comments mirrored from GitHub. Extends
-- pr_comments (0043) and adds a parallel issue_comments table for issue threads.
--
-- Ownership is single-writer by provenance: 'github' rows are read-only mirrors;
-- 'tracker' rows are authored/edited/deleted in-app by author_user_id and pushed
-- to GitHub. The webhook skips rows it already holds as 'tracker' (echo
-- suppression), so a tracker comment bouncing back never overwrites our copy.

-- ── pr_comments: add provenance + author ────────────────────────────────────
alter table tracker.pr_comments
    add column if not exists provenance     text not null default 'github',
    add column if not exists author_user_id uuid references auth.users(id) on delete set null;

alter table tracker.pr_comments
    drop constraint if exists pr_comments_provenance_valid;
alter table tracker.pr_comments
    add constraint pr_comments_provenance_valid check (provenance in ('github', 'tracker'));

-- ── issue_comments (mirror of pr_comments, conversation-only) ────────────────
create table if not exists tracker.issue_comments (
    id                uuid        primary key default gen_random_uuid(),
    project_id        uuid        not null references tracker.projects(id) on delete cascade,
    issue_number      int         not null,
    github_comment_id bigint      not null,
    provenance        text        not null default 'github',
    author_user_id    uuid        references auth.users(id) on delete set null,
    author_login      text,
    author_avatar_url text,
    body              text,
    html_url          text,
    gh_created_at     timestamptz,
    gh_updated_at     timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint issue_comments_id_uniq unique (project_id, github_comment_id),
    constraint issue_comments_provenance_valid check (provenance in ('github', 'tracker'))
);

create index if not exists issue_comments_project_issue_idx
    on tracker.issue_comments (project_id, issue_number);

drop trigger if exists touch_issue_comments on tracker.issue_comments;
create trigger touch_issue_comments
    before update on tracker.issue_comments
    for each row execute function tracker.touch_updated_at();

alter table tracker.issue_comments enable row level security;

drop policy if exists issue_comments_owner_select on tracker.issue_comments;
create policy issue_comments_owner_select on tracker.issue_comments
    for select using (
        exists (
            select 1 from tracker.projects p
            where p.id = issue_comments.project_id and p.user_id = auth.uid()
        )
    );

grant all on tracker.issue_comments to authenticated, service_role;
