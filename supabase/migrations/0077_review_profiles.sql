-- 0077_review_profiles.sql — a team can say what kind of PR reviewer it wants.
--
-- ─── What this stores ────────────────────────────────────────────────────────
--
-- A REVIEW PROFILE: the dials (how strict, what may block a merge, how much
-- evidence a blocker needs), the lenses (security, performance, migrations…),
-- and the team's own written instructions. The analyser compiles all of it into
-- one ReviewPolicy per run; see its ADR-0065.
--
-- ─── Why the team owns it and the project points at it ───────────────────────
--
-- The alternative — a profile per project — is the thing teams outgrow first.
-- A team with fifteen services has one opinion about code review, not fifteen,
-- and the second time somebody retypes "we wrap errors with %w" into a settings
-- box the feature has failed. So profiles are a team LIBRARY and each project
-- names one, which also makes "what changed about our reviews last month" a
-- question with one place to look.
--
-- projects.review_profile_id is NULLABLE and null means the built-in default —
-- the reviewer exactly as it behaved before profiles existed. That is the same
-- reason the analyser treats an absent policy as the default rather than as an
-- empty one: no row anywhere has to be backfilled for this migration to be
-- correct, and deleting a profile degrades its projects to the default instead
-- of breaking them (hence ON DELETE SET NULL).
--
-- ─── Why the dials are a jsonb blob and the lenses are an array ──────────────
--
-- The dials are a closed set TODAY and will not stay closed; every one added as
-- a column is a migration plus a deploy ordering dance for what is, to the
-- database, an opaque value it never filters on. The domain
-- (modules/analysis/domain/ReviewProfile.ts) owns the vocabulary and validates
-- it, exactly as DuplicateSensitivity owns its thresholds (0072) — the database
-- stores the choice, not the meaning.
--
-- Lenses are a text[] rather than jsonb because they ARE queried as a set: "how
-- many teams turned security on" is the first question this feature will be
-- asked, and `where 'security' = any(lenses)` beats digging through json.
--
-- ─── Why editing is privileged, and audited ──────────────────────────────────
--
-- The blocking dial decides what counts as a merge-blocking finding, and
-- modules/vcs/domain/MergeGate.ts refuses an in-app merge while any exist. So
-- editing a profile can loosen who is allowed to merge what. That makes it an
-- admin action (enforced in the route via AccessService — RLS is a fuse here,
-- not an authorization system, see 0067) and it makes updated_by worth keeping:
-- when a review gets quieter, somebody needs to be able to find out why.
--
-- ─── Grants ──────────────────────────────────────────────────────────────────
--
-- 0001's `grant on ALL TABLES` was a snapshot, not a rule, and two later tables
-- were missed and failed at runtime until 0073 repaired them. New table, own
-- grant. RLS enabled with no policies keeps it unreachable with the public key.

create table if not exists tracker.review_profiles (
    id            uuid primary key default gen_random_uuid(),
    team_id       uuid not null references tracker.teams(id) on delete cascade,

    name          text not null,
    -- The preset this profile started from ('balanced', 'gatekeeper', …), kept
    -- for the UI ("Custom, based on Gatekeeper") and so we can tell an untouched
    -- preset from a hand-tuned profile when asking whether presets are any good.
    preset        text,

    -- The dials, as {strictness, evidence, blocking, positivity, verbosity,
    -- voice, depth}. Unknown or missing keys resolve to the default ANALYSER-side
    -- as well, so a value written by a newer app never breaks an older cell.
    dials         jsonb not null default '{}'::jsonb,

    -- Enabled optional lenses. An EMPTY array is meaningful and distinct from
    -- null: it means "every optional lens off", which the analyser honours by
    -- running only the three that have deterministic enforcement behind them.
    lenses        text[] not null default '{}',

    -- The team's free text, and the glob-scoped kind as [{glob, text}]. Bounded
    -- and sanitised in the domain before it ever gets here; bounded AGAIN
    -- analyser-side, because a service does not trust its caller.
    instructions  text not null default '',
    path_rules    jsonb not null default '[]'::jsonb,

    created_by    uuid references auth.users(id) on delete set null,
    updated_by    uuid references auth.users(id) on delete set null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    constraint review_profiles_name_len check (char_length(name) between 1 and 60),
    -- The domain caps this at 2000 with a friendly error; this is the backstop
    -- that stops a direct writer parking a novel in a prompt.
    constraint review_profiles_instructions_len check (char_length(instructions) <= 2000),
    constraint review_profiles_lenses_len check (array_length(lenses, 1) is null or array_length(lenses, 1) <= 32),
    -- One name per team: the profile is chosen from a dropdown, and two
    -- "Strict"s in it is a support ticket.
    constraint review_profiles_name_unique unique (team_id, name)
);

create index if not exists review_profiles_team_idx on tracker.review_profiles(team_id);

alter table tracker.projects
    add column if not exists review_profile_id uuid
        references tracker.review_profiles(id) on delete set null;

create index if not exists projects_review_profile_idx
    on tracker.projects(review_profile_id)
    where review_profile_id is not null;

comment on table tracker.review_profiles is
    'A team''s saved PR-reviewer configuration: dials, lenses and instructions. '
    'The vocabulary lives in modules/analysis/domain/ReviewProfile.ts so it can be '
    'extended without a migration; this table stores the choice, not the meaning. '
    'Projects point at one (projects.review_profile_id); null means the built-in default.';

comment on column tracker.review_profiles.lenses is
    'Enabled OPTIONAL lenses. Empty array = all optional lenses off, which is '
    'distinct from the project having no profile at all. The three lenses with '
    'deterministic enforcement behind them (correctness, blast radius, test gaps) '
    'run regardless and are not listed here.';

comment on column tracker.projects.review_profile_id is
    'Which team review profile this project''s PR reviews run under. Null = the '
    'built-in default, i.e. the reviewer as it behaved before profiles existed. '
    'ON DELETE SET NULL so deleting a profile degrades its projects to the default '
    'rather than breaking their reviews.';

-- Keep updated_at honest without every writer remembering to.
create or replace function tracker.touch_review_profile()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists review_profiles_touch on tracker.review_profiles;
create trigger review_profiles_touch
    before update on tracker.review_profiles
    for each row execute function tracker.touch_review_profile();

-- Reachability fuse, per 0067: enabled, no policies, so the public key reads
-- nothing. Authorization is the app's job (AccessService), not the database's.
alter table tracker.review_profiles enable row level security;

grant all on tracker.review_profiles to authenticated, service_role;
