-- Auto-index-on-push toggle. When on (the default), a push to the repo's
-- default branch triggers an incremental graph update via the GitHub App
-- webhook (bobby-analyser's coalescing update queue, ADR-0058). Orthogonal to
-- github_sync_enabled (issue/PR sync) and to project_analyser.enabled — a
-- project can auto-index without mirroring issues, or vice versa.
--
-- Default true so connected+indexed projects keep current with commits out of
-- the box; the push webhook still no-ops unless the App is installed and a
-- graph has been bootstrapped. Existing rows inherit true.

alter table tracker.projects
    add column if not exists auto_index_on_push boolean not null default true;
