-- Denormalise user_id onto realtime-published tables so RLS evaluation
-- doesn't have to JOIN out to tracker.projects. Supabase Realtime can
-- evaluate single-table policies directly from WAL records, but a
-- cross-table EXISTS check is silently dropped in many setups, so
-- subscribers never receive UPDATE events even though the row updated
-- on disk.
--
-- After this migration the policies on project_analyser and
-- issue_suggestions become `user_id = auth.uid()` — Realtime-friendly,
-- equivalent semantically (since user_id is auto-populated from the
-- parent project on insert and never changes).

-- ─── project_analyser ──────────────────────────────────────────────────────

alter table tracker.project_analyser
    add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Backfill from the parent project for any existing rows.
update tracker.project_analyser pa
set user_id = p.user_id
from tracker.projects p
where pa.project_id = p.id
  and pa.user_id is null;

-- Auto-populate on insert so the tracker route doesn't have to know
-- about it. Triggered BEFORE INSERT, only when caller didn't supply it.
create or replace function tracker.fill_project_analyser_user_id()
returns trigger language plpgsql security definer as $$
begin
    if new.user_id is null then
        select user_id into new.user_id from tracker.projects where id = new.project_id;
    end if;
    return new;
end $$;

drop trigger if exists fill_user_id on tracker.project_analyser;
create trigger fill_user_id
    before insert on tracker.project_analyser
    for each row execute function tracker.fill_project_analyser_user_id();

-- Simplify the policy. The cross-table version is dropped; replaced
-- with a single-column check Realtime can evaluate.
drop policy if exists project_analyser_owner_all on tracker.project_analyser;
create policy project_analyser_owner_all on tracker.project_analyser
    for all
    using      (user_id = auth.uid())
    with check (user_id = auth.uid());

alter table tracker.project_analyser
    alter column user_id set not null;

-- ─── issue_suggestions ─────────────────────────────────────────────────────

alter table tracker.issue_suggestions
    add column if not exists user_id uuid references auth.users(id) on delete cascade;

update tracker.issue_suggestions s
set user_id = p.user_id
from tracker.issues i
join tracker.projects p on p.id = i.project_id
where s.issue_id = i.id
  and s.user_id is null;

create or replace function tracker.fill_issue_suggestion_user_id()
returns trigger language plpgsql security definer as $$
begin
    if new.user_id is null then
        select p.user_id
        into new.user_id
        from tracker.issues i
        join tracker.projects p on p.id = i.project_id
        where i.id = new.issue_id;
    end if;
    return new;
end $$;

drop trigger if exists fill_user_id on tracker.issue_suggestions;
create trigger fill_user_id
    before insert on tracker.issue_suggestions
    for each row execute function tracker.fill_issue_suggestion_user_id();

drop policy if exists issue_suggestions_owner_all on tracker.issue_suggestions;
create policy issue_suggestions_owner_all on tracker.issue_suggestions
    for all
    using      (user_id = auth.uid())
    with check (user_id = auth.uid());

alter table tracker.issue_suggestions
    alter column user_id set not null;
