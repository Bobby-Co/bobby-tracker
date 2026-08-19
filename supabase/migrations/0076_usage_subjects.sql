-- 0076_usage_subjects.sql — usage stops belonging to teams.
--
-- ─── The problem this fixes ──────────────────────────────────────────────────
--
-- Prowl's free allowance is per TEAM per month, and a team is free to create and
-- free to delete. Both ends of that leak:
--
--   delete the ACCOUNT, sign up again   → new team, allowance reset
--   delete the TEAM, create another     → new team, allowance reset
--   just create a SECOND team           → another whole allowance, no deletion
--
-- 0075 patched the first case with a 30-day tombstone. It is superseded here,
-- and dropped at the bottom of this file: patching one door while two others
-- stand open was the wrong shape.
--
-- ─── The model ───────────────────────────────────────────────────────────────
--
-- Usage belongs to a USAGE SUBJECT — a durable billing identity keyed by the
-- owner's email, which is never deleted. Teams BIND to a subject:
--
--   usage_subjects        who the spend belongs to. Permanent.
--   usage_subject_teams   which team(s) have ever spent against that subject.
--
-- Deleting a team unbinds it; the subject, its ledger and its balance stay.
-- Creating a team binds it to the SAME subject, so the balance carries straight
-- over — automatically, with nothing to copy and nothing to expire.
--
-- Each email gets exactly two reserved slots:
--
--   personal   the personal team, bootstrapped with the account
--   free       the one free (Kit) team they may create
--
-- and one subject per PAID team beyond those. That is the whole quota, and it
-- survives every deletion, so "delete and recreate" stops being a reset and
-- becomes what it looks like: the same billing identity, continuing.
--
-- ─── Why the email, and why hashed ───────────────────────────────────────────
--
-- The email is the only identifier that survives an account being deleted and
-- recreated — user ids do not. It is stored as SHA-256 (peppered via
-- BOBBY_ACCOUNT_PEPPER) because this table now keeps rows FOREVER: it must be
-- able to answer "is this the same person?" without being a permanent list of
-- everyone who ever signed up. The hash answers that question and nothing else.
--
-- ─── Suspension ──────────────────────────────────────────────────────────────
--
-- A subject can be suspended: its data stays, its team can be read, and no new
-- usage may be recorded against it. Two ways in — the owner pausing a team to
-- free their one free slot for another team, and a paid plan ending with no free
-- slot available to fall back into. Both are the same state, so both leave by the
-- same door (resume, or subscribe).

-- ─── the durable billing identity ────────────────────────────────────────────
create table if not exists tracker.usage_subjects (
    id          uuid        primary key default gen_random_uuid(),
    -- SHA-256 of the lower-cased email (+ pepper). NOT a foreign key to
    -- auth.users, and that is the entire point: it outlives the account.
    owner_hash  text        not null,
    -- 'personal' and 'free' are the two reserved slots; 'paid' subjects are
    -- created per paid team and are not limited.
    slot        text        not null,
    -- 'active'   usage may be recorded
    -- 'suspended' data kept, nothing may be spent — see the header
    status      text        not null default 'active',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),

    constraint usage_subjects_slot_chk   check (slot in ('personal', 'free', 'paid')),
    constraint usage_subjects_status_chk check (status in ('active', 'suspended')),
    constraint usage_subjects_hash_chk   check (owner_hash ~ '^[0-9a-f]{64}$')
);

-- The quota, enforced by the database rather than by remembering to check: one
-- personal and one free subject per email, forever. Partial, so 'paid' subjects
-- are unconstrained.
create unique index if not exists usage_subjects_reserved_slot_key
    on tracker.usage_subjects (owner_hash, slot)
    where slot in ('personal', 'free');

create index if not exists usage_subjects_owner_idx on tracker.usage_subjects (owner_hash);

drop trigger if exists touch_usage_subjects on tracker.usage_subjects;
create trigger touch_usage_subjects before update on tracker.usage_subjects
    for each row execute function tracker.touch_updated_at();

-- ─── which teams have spent against a subject ────────────────────────────────
-- team_id carries NO foreign key on purpose. The row has to outlive the team —
-- that is what makes the balance survive a deletion — and a cascade would take
-- the mapping down with it, orphaning the very ledger rows it explains.
create table if not exists tracker.usage_subject_teams (
    team_id    uuid        primary key,
    subject_id uuid        not null references tracker.usage_subjects(id) on delete cascade,
    bound_at   timestamptz not null default now(),
    -- Set when the team is deleted or unbound. The row stays: it is how a
    -- subject's spend is found across every team it has ever had.
    unbound_at timestamptz
);

create index if not exists usage_subject_teams_subject_idx
    on tracker.usage_subject_teams (subject_id);

-- ─── break the cascades that were deleting the evidence ──────────────────────
--
-- prowl_usage_events.team_id and prowl_usage_period.team_id referenced
-- tracker.teams(id) ON DELETE CASCADE, so deleting a team erased its usage. Under
-- this model the team is a label on the spend, not its owner. The columns stay
-- (the analyser keeps writing team_id, unchanged — see internal/server/usage.go)
-- but they become SOFT references, resolved through usage_subject_teams.
do $$
declare c record;
begin
    for c in
        select conrelid::regclass as tbl, conname
        from pg_constraint
        where contype = 'f'
          and confrelid = 'tracker.teams'::regclass
          and conrelid in ('tracker.prowl_usage_events'::regclass, 'tracker.prowl_usage_period'::regclass)
    loop
        execute format('alter table %s drop constraint %I', c.tbl, c.conname);
        raise notice '0076: dropped %.% → teams cascade', c.tbl, c.conname;
    end loop;
end $$;

comment on column tracker.prowl_usage_events.team_id is
    'The team the spend was recorded against. SOFT reference since 0076 — no FK, '
    'because the row must survive the team being deleted. Ownership is '
    'usage_subject_teams → usage_subjects.';
comment on column tracker.prowl_usage_period.team_id is
    'See prowl_usage_events.team_id — soft reference since 0076.';

-- ─── suspension needs a status the subscription can hold too ─────────────────
-- team_subscriptions.status was ('active','past_due','canceled'). A suspended
-- team keeps its row and its tier history; it simply may not spend.
do $$ begin
    if exists (select 1 from pg_constraint where conname = 'team_subscriptions_status_chk') then
        alter table tracker.team_subscriptions drop constraint team_subscriptions_status_chk;
    end if;
    alter table tracker.team_subscriptions
        add constraint team_subscriptions_status_chk
        check (status in ('active', 'past_due', 'canceled', 'suspended'));
end $$;

alter table tracker.usage_subjects   enable row level security;
alter table tracker.usage_subject_teams enable row level security;

grant all on tracker.usage_subjects      to authenticated, service_role;
grant all on tracker.usage_subject_teams to authenticated, service_role;

comment on table tracker.usage_subjects is
    'Durable billing identity: who a team''s Prowl spend belongs to, keyed by a '
    'SHA-256 of the owner''s email so it survives the account and the team being '
    'deleted. Two reserved slots per email (personal, free) plus one per paid '
    'team. See modules/billing/domain/TeamSlots.ts.';
comment on table tracker.usage_subject_teams is
    'Every team that has ever spent against a usage subject. team_id is a SOFT '
    'reference — the row outlives the team, which is what makes a balance survive '
    'a team deletion and reattach to its replacement.';

-- ─── supersede 0075 ──────────────────────────────────────────────────────────
-- The 30-day, hash-keyed tombstone of a deleted account's spend. Same goal,
-- narrower mechanism: it only covered account deletion, only for a month, and it
-- copied numbers around instead of giving them an owner. Everything it did is a
-- consequence of the subject model above. Dropped rather than left dormant, so
-- there is one answer to "where does usage live".
drop table if exists tracker.deleted_account_usage;
