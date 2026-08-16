-- 0070_repo_uniqueness_per_team.sql — one project per repo PER TEAM, not per install.
--
-- 0037 made a linked repo unique across the whole installation, and said why:
-- "One project per linked repo → unambiguous inbound routing." That was the
-- real reason. An inbound webhook carries a repo id and nothing else, so a
-- second project on the same repo left the receiver with no way to choose.
--
-- But the rule it bought is wrong for teams. Two teams tracking one repo is
-- ordinary — a platform team and a product team on the same service — and they
-- are separate tenants with separate members, issues and analyser graphs.
-- Uniqueness belongs inside the team.
--
-- Routing no longer needs the global rule. The webhook receivers now select
-- EVERY project matching the repo and apply the event to each (see the commit
-- that precedes this migration). That change shipped first, on purpose: it is a
-- no-op while one project per repo still holds, so it could be verified against
-- live traffic before this migration made two rows possible. Applying this
-- first would have made the first cross-team repo throw inside both receivers.
--
-- The bug this closes: the two indexes are both PARTIAL (`where … is not null`),
-- but gitlab_project_id is set at CREATE while github_repo_id stays null until
-- the App-install callback runs. So the GitLab index bit immediately and the
-- GitHub one did not — the same repo could be added to a second team over
-- GitHub but not over GitLab, purely as an accident of when each column gets
-- filled. Worse, that GitHub project worked right up until the second team
-- connected the App, at which point linking failed.
--
-- Widening a unique index is a RELAXATION: every row set that satisfied the
-- global rule satisfies the per-team one, so the new indexes cannot fail to
-- build on existing data. They are therefore created BEFORE the old ones are
-- dropped, leaving no window in which a repo is unconstrained.
--
-- projects.team_id is NOT NULL (0052), which matters here: a nullable leading
-- column would make every teamless row distinct under unique semantics and
-- quietly reopen the duplicate it is meant to close.

-- ─── GitHub ─────────────────────────────────────────────────────────────────
create unique index if not exists projects_team_github_repo_uniq
    on tracker.projects (team_id, github_repo_id)
    where github_repo_id is not null;

drop index if exists tracker.projects_github_repo_id_uniq;

-- ─── GitLab ─────────────────────────────────────────────────────────────────
-- Keeps gitlab_host in the key: the same numeric project id on two different
-- instances is two different repos (0057).
create unique index if not exists projects_team_gitlab_project_uniq
    on tracker.projects (team_id, gitlab_host, gitlab_project_id)
    where gitlab_project_id is not null;

drop index if exists tracker.projects_gitlab_instance_project_uniq;
