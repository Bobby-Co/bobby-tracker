-- The tile footer's timestamp should describe whatever the footer is talking
-- about, rather than being the same number regardless of variant:
--
--   pr        → when the latest PR opened      (already derivable: max(recent_pr_opens))
--   critical  → when the latest urgent landed  (already have: last_urgent_at)
--   progress  → when the latest issue was created   ← needs this column
--   clear     → when the latest issue was created   ← needs this column
--
-- last_activity_at is the newest issue/PR *update*, which is a different fact
-- and reads wrong under "2 / 7" — an edit to a months-old issue would report
-- the project as active minutes ago. Hence a dedicated created-at high-water
-- mark. It stays useful for the "Updated" field row.

alter table tracker.project_insight
    add column if not exists last_issue_created_at timestamptz;

-- Replaces the 0047 function; the trigger binding is unchanged.
create or replace function tracker.apply_issue_insight()
returns trigger language plpgsql security definer as $$
declare
    d_open   int := 0;
    d_done   int := 0;
    d_urgent int := 0;
begin
    -- Re-parenting an issue would have to decrement one project and increment
    -- another. Nothing in the app does this; fail loudly rather than drift.
    if tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
        raise exception 'project_insight: moving an issue between projects is not supported';
    end if;

    -- The old row stops contributing...
    if tg_op in ('UPDATE', 'DELETE') then
        d_open   := d_open   - (old.status in ('open', 'in_progress', 'blocked'))::int;
        d_done   := d_done   - (old.status = 'done')::int;
        d_urgent := d_urgent - (old.priority = 'urgent'
                                and old.status in ('open', 'in_progress', 'blocked'))::int;
    end if;

    -- ...and the new row starts. INSERT/DELETE simply skip one side, so every
    -- status and priority transition falls out of the same two blocks.
    if tg_op in ('INSERT', 'UPDATE') then
        d_open   := d_open   + (new.status in ('open', 'in_progress', 'blocked'))::int;
        d_done   := d_done   + (new.status = 'done')::int;
        d_urgent := d_urgent + (new.priority = 'urgent'
                                and new.status in ('open', 'in_progress', 'blocked'))::int;
    end if;

    update tracker.project_insight set
        open_total       = greatest(open_total  + d_open,   0),
        done_total       = greatest(done_total  + d_done,   0),
        urgent_open      = greatest(urgent_open + d_urgent, 0),
        -- Rises on "urgent issue created" AND "issue escalated to urgent" —
        -- both are d_urgent > 0, so neither needs special-casing.
        last_urgent_at   = case when d_urgent > 0 then now() else last_urgent_at end,
        last_issue_created_at = case
            -- Monotonic high-water mark on insert...
            when tg_op = 'INSERT' then greatest(last_issue_created_at, new.created_at)
            -- ...but a delete can remove the very issue it points at, so
            -- recompute. AFTER DELETE, so the row is already gone and max() is
            -- the correct post-delete answer. Deletes are rare; the scan is
            -- covered by issues_project_idx.
            when tg_op = 'DELETE' then
                (select max(created_at) from tracker.issues where project_id = old.project_id)
            else last_issue_created_at
        end,
        last_activity_at = greatest(last_activity_at, now()),
        updated_at       = now()
    where project_id = coalesce(new.project_id, old.project_id);

    return null;
end $$;

-- Backfill the new column for rows 0047 already created.
update tracker.project_insight pi
set last_issue_created_at = i.max_created
from (
    select project_id, max(created_at) as max_created
    from tracker.issues
    group by project_id
) i
where i.project_id = pi.project_id
  and pi.last_issue_created_at is distinct from i.max_created;
