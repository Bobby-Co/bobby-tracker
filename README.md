# bobby-tracker

Smart issue tracker for Bobby projects. Powered by Supabase (shared with Bobby CI for SSO) and the bobby-analyser microservice (for issue → file/line suggestions, Phase 3).

## Stack

- Next.js 16 (App Router, Turbopack, `proxy.ts` middleware)
- React 19, TypeScript, Tailwind v4
- Supabase Postgres (`tracker` schema) + Supabase Auth
- WebSocket client → bobby-analyser `/jobs`, HTTP client → `/query`

## Setup

1. **Same Supabase project as Bobby CI.** No new project — bobby-tracker uses the existing one so users get single sign-on.

2. **Apply the schema:**

   ```bash
   supabase db push --file supabase/migrations/0001_tracker_schema.sql
   ```
   …or paste it into the Supabase SQL editor. Then in **Supabase → Settings → API → Exposed schemas**, add `tracker` alongside `public`.

3. **Configure auth:** Supabase → Authentication → Providers → GitHub. Already set up for Bobby CI? Same setting is reused. Add this app's redirect to the allowed list:
   - `https://your-tracker-domain/auth/callback`
   - `http://localhost:3000/auth/callback` (dev)

4. **Env:**

   ```bash
   cp .env.local.example .env.local
   # fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
   # BOBBY_ANALYSER_URL, BOBBY_ANALYSER_TOKEN
   # In production set NEXT_PUBLIC_AUTH_COOKIE_DOMAIN to the parent
   # domain shared with Bobby CI for SSO.
   ```

5. **Run:**

   ```bash
   npm run dev    # http://localhost:3000
   ```

## Deploy

Run `next start` on a Node host. The `/api/projects/[id]/analyser/index` route holds an analyser WebSocket open for the entire indexing run (potentially several minutes), so do **not** deploy this route to a serverless platform with short request timeouts (Vercel functions, Lambda). A small VPS or container next to bobby-analyser-server is the right shape.

## Architecture

- `app/(app)/` — authenticated routes, gated by `proxy.ts` and the `(app)/layout.tsx` server check.
- `lib/supabase/{client,server}.ts` — `db: { schema: "tracker" }` so calls land on `tracker.*`. `cookieOptions.domain` enables shared-session SSO with Bobby CI when `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN` is set.
- `lib/analyser.ts` — server-only HTTP/WS client to bobby-analyser. Reads `BOBBY_ANALYSER_URL` + `BOBBY_ANALYSER_TOKEN` from the env; never imported into client components.
- `proxy.ts` — refreshes the Supabase auth cookie and redirects unauthenticated requests to `/login`.

## Phase 3 (next session)

- Issue detail "Investigate with analyser" button → caches a `tracker.issue_suggestions` row → renders file/line cards.
- GitHub Issues two-way sync (per-project toggle on the Integrations page).

## Conventions

- See [`AGENTS.md`](AGENTS.md): Next 16 has breaking changes from training-data Next; check `node_modules/next/dist/docs` before writing new patterns.
