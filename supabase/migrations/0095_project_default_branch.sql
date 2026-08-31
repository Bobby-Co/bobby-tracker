-- 0095_project_default_branch.sql — the name of a project's default branch.
--
-- The tracker has always KNOWN which tree is the default — it is the one
-- project_analyser indexes, the one an omitted branch resolves to — without ever
-- knowing what it is CALLED. That was fine while the default was implicit. It
-- stopped being fine when 0094 made the branch an explicit choice at issue
-- composition: the picker could only offer "Default branch", which asks someone
-- to choose between a named branch and an unnamed one, on a repository whose
-- default might be `main`, `master`, `develop` or `trunk`.
--
-- ─── Derived, not configured ────────────────────────────────────────────────
--
-- This is a MIRROR of a fact the provider owns, like github_repo_id — never
-- edited from the settings form, which is why it is written through its own
-- narrow repository method rather than joining ProjectPatch.
--
-- ─── Why null is expected, and permanently survivable ───────────────────────
--
-- There is no scheduler in this stack, so there is no backfill job to run: every
-- project that exists today starts null. Three paths fill it, and every one of
-- them is best-effort:
--
--   - the webhooks, which already read repository.default_branch off each push
--     and pull-request payload and were throwing it away. This also makes a
--     RENAMED default self-correct, which no one-shot backfill would.
--   - a lazy resolve on GET .../branches, but only for a project that actually
--     tracks branches — the one case where the name is about to be displayed.
--   - nothing else. A project nobody pushes to and whose branches nobody tracks
--     never pays for a lookup it has no use for.
--
-- So the UI must read null as "I don't know the name", not as an error, and say
-- "Default branch" exactly as it did before this column existed.

alter table tracker.projects
    add column if not exists default_branch text;

comment on column tracker.projects.default_branch is
    'The repository''s default branch name, mirrored from the provider. Null '
    'means not yet learned — never an error: it is filled opportunistically by '
    'the webhooks and by a lazy resolve when a project first needs to NAME its '
    'default, and the UI falls back to the generic "Default branch" label.';
