-- Allow 'gitlab' as an issue sync source.
--
-- 0038 constrained tracker.issues.sync_source to ('tracker','github'). GitLab-
-- origin issues reuse the same sync columns (github_issue_number holds the
-- GitLab issue iid, github_node_id the global id), so the source enum just needs
-- to admit 'gitlab' too.

alter table tracker.issues
    drop constraint if exists issues_sync_source_valid;

alter table tracker.issues
    add constraint issues_sync_source_valid
    check (sync_source is null or sync_source in ('tracker', 'github', 'gitlab'));
