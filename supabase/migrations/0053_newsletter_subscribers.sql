-- Newsletter sign-ups from the landing page's footer.
--
-- Deliberately its own table rather than a column on a user: the whole point is
-- to hear from people who have NOT signed up. There is no account behind these
-- rows, so nothing here joins to auth.users.
--
-- Writes come from /api/newsletter via the service client, which bypasses RLS.
-- RLS is enabled with no policies at all, so the anon and authenticated roles
-- can neither read the list nor add to it directly — an email list is exactly
-- the kind of table that must not be readable from the browser.
--
-- `source` records which surface the address came from, so a later signup form
-- elsewhere doesn't need a schema change to be told apart.

create table if not exists tracker.newsletter_subscribers (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    source text not null default 'landing-footer',
    created_at timestamptz not null default now(),
    -- Set when someone asks to be removed; kept rather than deleted so a
    -- re-subscribe doesn't silently resurrect an old opt-out.
    unsubscribed_at timestamptz
);

-- Foo@x.com and foo@x.com are one person, so addresses are normalised to
-- lower case by the route before they get here and the index is a plain one on
-- the column. An expression index on lower(email) would be equivalent for
-- lookups but couldn't back an ON CONFLICT (email) upsert, which is how a
-- second submission updates the existing row instead of failing.
create unique index if not exists newsletter_subscribers_email_key
    on tracker.newsletter_subscribers (email);

alter table tracker.newsletter_subscribers enable row level security;
