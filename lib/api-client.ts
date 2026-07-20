// The single client-side mutation path. Mirrors the app's response envelope —
// success is a bare payload object (e.g. `{ project }`), failure is a non-2xx
// response with body `{ error: { code, message } }` (see lib/api.ts jsonError).
// Keeping that shape in one place means a future contract change touches one
// file instead of the ~40 hand-rolled fetch() calls scattered across components.
//
// Reads go through lib/hooks/use-api.ts; this is the write-side counterpart.

/** Error thrown by {@link apiMutate} on a non-2xx response. Carries the
 * server's error `code` and the HTTP `status` alongside the message. */
export class ApiError extends Error {
    code: string
    status: number

    constructor(message: string, code: string, status: number) {
        super(message)
        this.name = "ApiError"
        this.code = code
        this.status = status
    }
}

interface MutateOptions {
    method?: "POST" | "PATCH" | "PUT" | "DELETE"
    body?: unknown
    signal?: AbortSignal
}

/**
 * Perform a mutating request (POST/PATCH/PUT/DELETE) against a route handler.
 * Cookies ride along (same-origin) so the handler's requireUser() authenticates.
 *
 * On success returns the parsed JSON payload (or `undefined` for a 204).
 * On a non-2xx response throws {@link ApiError} carrying the envelope's
 * `error.code` / `error.message` and the HTTP status.
 */
export async function apiMutate<T = unknown>(path: string, opts: MutateOptions): Promise<T> {
    const { method = "POST", body, signal } = opts

    const res = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
    })

    if (!res.ok) {
        // Parse defensively: a non-2xx body may be empty or non-JSON.
        const errBody = await res.json().catch(() => null)
        throw new ApiError(
            errBody?.error?.message ?? errBody?.message ?? res.statusText,
            errBody?.error?.code ?? "error",
            res.status,
        )
    }

    return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}
