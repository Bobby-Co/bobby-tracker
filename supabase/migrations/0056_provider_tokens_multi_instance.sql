-- Upgrade tracker.provider_tokens to MULTI-INSTANCE (per-host) keying.
--
-- 0055 first shipped a single-instance shape — primary key (user_id, provider),
-- no host column — and some databases applied that form before it was revised.
-- This migration brings the table to (user_id, provider, host) with auth_kind +
-- api_base, IDEMPOTENTLY, so it is a no-op on databases that already got the
-- revised 0055 and a clean upgrade on those that got the original.
--
-- Why host is in the key: this is a public service. A user may connect public
-- gitlab.com (OAuth) AND their own self-managed instance(s) (a pasted token);
-- each instance is its own row, distinguished by host.

-- 1. New columns (skipped when already present).
alter table tracker.provider_tokens
    add column if not exists host      text not null default 'gitlab.com',
    add column if not exists auth_kind text not null default 'oauth',
    add column if not exists api_base  text;

-- 2. auth_kind domain, added once (guarded so a re-run doesn't error).
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'provider_tokens_auth_kind_chk'
    ) then
        alter table tracker.provider_tokens
            add constraint provider_tokens_auth_kind_chk check (auth_kind in ('oauth', 'pat'));
    end if;
end $$;

-- 3. Re-key to include host. Only acts when the current PK isn't already the
--    3-column form, so re-running (or a fresh 0055) is a no-op. provider_tokens
--    holds only GitLab rows and none have been created yet in practice, so the
--    default host ('gitlab.com') on any pre-existing row keeps the key unique.
do $$
declare
    pk_cols text;
begin
    select string_agg(a.attname, ',' order by array_position(c.conkey, a.attnum))
    into pk_cols
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'tracker.provider_tokens'::regclass and c.contype = 'p';

    if pk_cols is distinct from 'user_id,provider,host' then
        if pk_cols is not null then
            alter table tracker.provider_tokens drop constraint provider_tokens_pkey;
        end if;
        alter table tracker.provider_tokens add primary key (user_id, provider, host);
    end if;
end $$;
