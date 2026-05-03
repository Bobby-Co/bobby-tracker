-- Reporter identity for public-session issues.
--
-- Anonymous submitters get a stable client-generated id (UUID written
-- to localStorage on first visit) so multiple anonymous reporters
-- don't all collapse into one bucket on the public listing. Named
-- submitters also send a display name. Both columns are nullable —
-- owner-filed issues never set them.
--
-- We persist the structured values *in addition to* the existing
-- markdown stamp on the body, since the maintainer's authenticated
-- views still read the body verbatim.

alter table tracker.issues
    add column if not exists public_reporter_id   text,
    add column if not exists public_reporter_name text;

create index if not exists issues_public_reporter_idx
    on tracker.issues(project_id, public_reporter_id)
    where public_reporter_id is not null;
