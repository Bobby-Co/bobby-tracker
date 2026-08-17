-- Per-issue GitHub sync state, for echo suppression and provenance.
--
-- github_issue_number / github_node_id already exist (migration 0001);
-- this migration adds the columns that make two-way sync loop-safe:
--   * sync_source     — which side last wrote this row ('tracker' | 'github').
--   * last_synced_hash — syncHash(normalized title|body|state) of the last
--                        value we pushed/ingested. An inbound webhook whose
--                        hash matches this is our own echo → dropped. Hash-
--                        based (not a time window) so it survives GitHub's
--                        delivery lag.
--   * github_synced_at — when this row last round-tripped with GitHub.
-- All nullable so pre-existing issues (never synced) stay untouched.

alter table tracker.issues
    add column if not exists github_synced_at timestamptz,
    add column if not exists sync_source      text,
    add column if not exists last_synced_hash text;

alter table tracker.issues
    drop constraint if exists issues_sync_source_valid;
alter table tracker.issues
    add constraint issues_sync_source_valid
    check (sync_source is null or sync_source in ('tracker', 'github'));
