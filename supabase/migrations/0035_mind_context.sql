-- 0035_mind_context.sql
--
-- Managed-context store for the Mind chat's background context agent
-- (analyser ADR-0049).
--
-- The analyser splits chat memory in two: a short TEMPORAL buffer (the last few
-- raw turns, client-carried) and this durable MANAGED store. After each answer,
-- a background agent in the analyser rationalizes the turn into a compact,
-- structured memory — current goals, cited files with a short "why", issues in
-- focus — pruning stale entries. The next turn's thinker + finaliser read it so
-- follow-ups reuse context instead of re-retrieving.
--
-- Ownership + access: the analyser reads/writes this table over PostgREST with
-- the SERVICE-ROLE key (same trust level it already uses for issue embeddings
-- and progress). The tracker UI never touches it — it's internal plumbing — so
-- RLS is enabled with NO policies: anon/authenticated get nothing, and
-- service_role bypasses RLS. One row per conversation, upserted on
-- conversation_id.
--
-- conversation_id is generated client-side per conversation. Rows are not tied
-- to a persisted chat (the chat itself lives in client state today), so on a
-- fresh conversation a new id is minted; old rows are harmless orphans. A future
-- cleanup sweep can prune by updated_at if needed.

create table if not exists tracker.mind_context (
    conversation_id uuid        primary key,
    project_id      uuid        references tracker.projects(id) on delete cascade,
    context         jsonb       not null default '{}'::jsonb,
    turn            int         not null default 0,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- Helps a future TTL/cleanup sweep and per-project inspection.
create index if not exists mind_context_project_idx on tracker.mind_context (project_id);

alter table tracker.mind_context enable row level security;
-- No policies on purpose: only the service-role backend (which bypasses RLS)
-- may read or write this internal store.
