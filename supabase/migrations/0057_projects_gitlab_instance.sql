-- Make GitLab project linking instance-aware on tracker.projects.
--
-- 0055 added gitlab_project_id with a GLOBAL unique index. That's wrong for a
-- public multi-instance service: GitLab project ids are only unique WITHIN an
-- instance, so two self-managed instances can each have project id 42. Key the
-- uniqueness (and, later, inbound webhook routing) on (host, project id) instead.

alter table tracker.projects
    -- The GitLab instance host a linked project lives on (e.g. 'gitlab.com' or
    -- 'git.acme.com'). Null for GitHub / unlinked projects. Set at create time
    -- from the repo URL host; also the routing key for inbound GitLab webhooks.
    add column if not exists gitlab_host text;

-- Replace the global unique index with a per-instance one.
drop index if exists tracker.projects_gitlab_project_id_uniq;

create unique index if not exists projects_gitlab_instance_project_uniq
    on tracker.projects (gitlab_host, gitlab_project_id)
    where gitlab_project_id is not null;
