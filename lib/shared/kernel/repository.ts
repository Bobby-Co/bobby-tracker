// Repository failure signalling for the strangler-fig migration.
//
// A repository port returns `T | null` for a legitimately-absent row, but a
// genuine infrastructure failure (a DB/query error) is EXCEPTIONAL — it is thrown
// as RepositoryError so a caller can't silently mistake "the store is broken" for
// "the row isn't there". The interface layer maps it to a 500; a fail-safe caller
// that intentionally treats "can't read" the same as "no row" uses tryOrNull to
// fold it back to null on purpose.
//
// Part of the shared kernel (see modules/README.md). Pure: no Next/Workers/SDK
// imports — the eslint boundary rule enforces it.

/** An infrastructure-level failure from a repository adapter (e.g. a Supabase
 *  query error). The underlying cause is carried on the standard Error `cause`. */
export class RepositoryError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options)
        this.name = "RepositoryError"
    }
}

/** Run a repository call, folding a RepositoryError back to `null` — for callers
 *  whose original behaviour treated "can't read the row" identically to "no row"
 *  (fail-safe gates). A non-RepositoryError (a real bug) still propagates. */
export async function tryOrNull<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
        return await fn()
    } catch (e) {
        if (e instanceof RepositoryError) return null
        throw e
    }
}
