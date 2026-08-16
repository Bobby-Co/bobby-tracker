-- Minimal Supabase-shaped bootstrap so supabase/migrations can be replayed into a
-- bare Postgres. Stubs only what the migrations touch: the auth schema, the JWT
-- helpers RLS calls, the roles grants are made to, and pg_net's http_post (0051's
-- notification trigger). Not a Supabase emulator — just enough for DDL to apply.

create extension if not exists vector;
create extension if not exists pgcrypto;

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    -- Supabase grants service_role BYPASSRLS; the fuse check below depends on it.
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;

create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists net;

create table if not exists auth.users (
    id                  uuid primary key default gen_random_uuid(),
    email               text,
    raw_app_meta_data   jsonb default '{}'::jsonb,
    raw_user_meta_data  jsonb default '{}'::jsonb,
    created_at          timestamptz not null default now()
);

-- RLS predicates call these. Returning null is the anonymous case, which is what
-- we want while applying DDL as the owner.
create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function auth.role() returns text language sql stable as $$
    select nullif(current_setting('request.jwt.claim.role', true), '')
$$;

-- pg_net stub — 0051 attaches a trigger that calls this.
create or replace function net.http_post(
    url text,
    body jsonb default '{}'::jsonb,
    params jsonb default '{}'::jsonb,
    headers jsonb default '{}'::jsonb,
    timeout_milliseconds int default 5000
) returns bigint language sql as $$ select 0::bigint $$;
