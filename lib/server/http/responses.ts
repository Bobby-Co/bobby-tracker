// Pure response builders for tracker API route handlers. These are plumbing —
// they construct a Response from a shape, with no behaviour or ownership — so they
// stay free functions (the ApiContext guard class is where request-authorization
// behaviour lives). Re-exported from ./api, which is the stable import surface the
// routes use.

import { RepositoryError } from "@/lib/shared/kernel"

export function jsonError(code: string, message: string, status: number) {
    return Response.json({ error: { code, message } }, { status })
}

/** 403 for an authenticated caller who lacks the required role/access. */
export function forbidden(message = "you don't have access to this resource") {
    return jsonError("forbidden", message, 403)
}

/** Run a repository read and map a RepositoryError to a `db_error` 500 Response,
 *  so a handler can early-return it. Mirrors the `{ data, error }` shape of the
 *  raw supabase call it replaces: `data` is the row (or null when absent), `error`
 *  is a ready-to-return Response on infrastructure failure. A non-repository error
 *  (a real bug) still throws. */
export async function repoRead<T>(
    fn: () => Promise<T>,
): Promise<{ data: T; error: null } | { data: null; error: Response }> {
    try {
        return { data: await fn(), error: null }
    } catch (e) {
        if (e instanceof RepositoryError) return { data: null, error: jsonError("db_error", e.message, 500) }
        throw e
    }
}
