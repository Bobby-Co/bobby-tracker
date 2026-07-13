-- Link tracker.projects to a GitHub App installation + repo, and add the
-- per-project two-way-sync toggle.
--
-- We store the GitHub numeric repo id (github_repo_id), not the
-- owner/repo string, because the numeric id is stable across renames and
-- transfers — it's the reliable join key for routing an inbound `issues`
-- webhook back to a project. github_installation_id points at the
-- installation whose token can act on that repo. github_sync_enabled is
-- kept separate from project_analyser.enabled: indexing and issue sync are
-- orthogonal, and this flag alone gates both inbound routing and outbound
-- pushes.
--
-- The partial unique index enforces one project per repo (where a repo is
-- linked at all), so inbound webhook routing is unambiguous. Existing
-- owner RLS on tracker.projects already covers these new columns.

alter table tracker.projects
    add column if not exists github_installation_id bigint
        references tracker.github_installations(installation_id),
    add column if not exists github_repo_id         bigint,
    add column if not exists github_sync_enabled     boolean not null default false;

-- One project per linked repo → unambiguous inbound routing. Partial so
-- unlinked projects (github_repo_id is null) don't collide with each other.
create unique index if not exists projects_github_repo_id_uniq
    on tracker.projects (github_repo_id)
    where github_repo_id is not null;
