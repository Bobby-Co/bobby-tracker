-- Live GitHub analysis comment: track the placeholder comment we post on an
-- issue and the state of the (durable, analyser-owned) analysis run so the
-- callback can edit that comment in place.
--
--   * github_analysis_comment_id — the GitHub comment id of the "analysing…"
--     placeholder we posted; the analyser's result callback edits it in place.
--   * analysis_status — lifecycle of the detached run:
--       'analysing' → 'done' | 'failed' | 'cancelled' (cancelled = issue closed
--       mid-run). Null for issues that never triggered an analysis.
-- Both nullable so existing issues are untouched.

alter table tracker.issues
    add column if not exists github_analysis_comment_id bigint,
    add column if not exists analysis_status            text;

alter table tracker.issues
    drop constraint if exists issues_analysis_status_valid;
alter table tracker.issues
    add constraint issues_analysis_status_valid
    check (analysis_status is null or analysis_status in ('analysing', 'done', 'failed', 'cancelled'));
