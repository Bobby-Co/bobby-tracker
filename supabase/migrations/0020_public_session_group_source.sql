-- Public sessions can now optionally be backed by a project group
-- instead of (or in addition to) a manual project list. When
-- group_id is set, the session's effective coverage is the group's
-- current membership filtered to projects that have the public-
-- submissions integration enabled — adding a project to the group
-- expands the session automatically, removing one shrinks it.
--
-- This is the data model change that lets the public AI compose
-- flow do the same project routing the authenticated group page
-- already does: caller hits the public ai-compose endpoint with
-- token + paragraph, the server pulls the group, runs compose +
-- embed + find_similar_projects, and the public form gets back a
-- ranking so the submitter (or the form on their behalf) can route
-- the issue to the most-relevant project(s).
--
-- group_id is nullable. When null, the session uses the existing
-- public_session_projects junction. Both can be present — the
-- group takes precedence at resolve time, but the junction is
-- preserved as a fallback / migration path.

alter table tracker.public_sessions
    add column if not exists group_id uuid references tracker.project_groups(id) on delete set null;

-- on delete set null instead of cascade: deleting a group shouldn't
-- delete the sessions that referenced it. They drop back to manual-
-- project mode and the owner can repoint them.

create index if not exists public_sessions_group_idx
    on tracker.public_sessions(group_id) where group_id is not null;
