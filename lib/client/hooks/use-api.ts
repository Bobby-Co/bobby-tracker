"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// Minimal data-fetching hook for the client → route-handler → db flow.
// Deliberately dependency-free (no React Query): it fetches a JSON
// endpoint, tracks loading/error, and exposes refetch(). No caching or
// dedup — revisiting a page refetches. Cookies ride along automatically
// (same-origin), so the route handler's requireUser() authenticates.
//
// The endpoints in this app return either a payload object on success
// or `{ error: { code, message } }` with a non-2xx status on failure
// (see lib/api.ts jsonError). This hook surfaces that message in `error`.

interface ApiState<T> {
    data: T | null
    error: string | null
    loading: boolean
    /** Re-run the request. */
    refetch: () => void
}

interface Options {
    /** Pass null/false to skip fetching (e.g. until an id is known). */
    enabled?: boolean
}

export function useApi<T>(path: string | null, opts: Options = {}): ApiState<T> {
    const { enabled = true } = opts
    const [data, setData] = useState<T | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState<boolean>(Boolean(path) && enabled)
    const [nonce, setNonce] = useState(0)

    const refetch = useCallback(() => setNonce((n) => n + 1), [])

    // Track the latest request so a slow earlier response can't clobber
    // a newer one (and so unmount cancels in-flight work).
    const reqId = useRef(0)

    useEffect(() => {
        if (!path || !enabled) {
            setLoading(false)
            return
        }

        const id = ++reqId.current
        const controller = new AbortController()
        setLoading(true)
        setError(null)

        ;(async () => {
            try {
                const res = await fetch(path, {
                    credentials: "same-origin",
                    headers: { Accept: "application/json" },
                    signal: controller.signal,
                })
                const body = await res.json().catch(() => null)
                if (id !== reqId.current) return
                if (!res.ok) {
                    const msg =
                        body?.error?.message ??
                        body?.message ??
                        `Request failed (${res.status})`
                    setError(msg)
                    setData(null)
                } else {
                    setData(body as T)
                    setError(null)
                }
            } catch (e) {
                if (controller.signal.aborted || id !== reqId.current) return
                setError(e instanceof Error ? e.message : "Network error")
                setData(null)
            } finally {
                if (id === reqId.current) setLoading(false)
            }
        })()

        return () => controller.abort()
    }, [path, enabled, nonce])

    return { data, error, loading, refetch }
}
