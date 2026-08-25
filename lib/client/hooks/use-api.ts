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
    /** A failure with NOTHING to show. A refresh that fails while data is on
     *  screen does not set this — see the fetch effect for why. */
    error: string | null
    /** True only while there is nothing to render yet. A refetch over existing
     *  data leaves it false, so a poll cannot flash a skeleton. */
    loading: boolean
    /** True while a refresh runs UNDER existing data. For a subtle indicator;
     *  never for hiding content. */
    refreshing: boolean
    /** Re-run the request. */
    refetch: () => void
}

interface Options {
    /** Pass null/false to skip fetching (e.g. until an id is known). */
    enabled?: boolean
    /** Re-fetch on this interval, in ms. Omit for a one-shot read.
     *
     *  Polling PAUSES while the tab is hidden and fires once on return. A
     *  background tab left open for hours would otherwise keep a request going
     *  every interval forever, and every one of those answers is discarded —
     *  nobody is looking at it. Coming back triggers a single immediate refresh,
     *  which is the moment the value actually matters. */
    refreshMs?: number
}

export function useApi<T>(path: string | null, opts: Options = {}): ApiState<T> {
    const { enabled = true, refreshMs } = opts
    const [data, setData] = useState<T | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState<boolean>(Boolean(path) && enabled)
    const [refreshing, setRefreshing] = useState(false)
    const [nonce, setNonce] = useState(0)

    // What is currently on screen, readable synchronously inside the fetch.
    // setState is async, so the effect cannot ask "do we already have something
    // to show?" any other way — and that question decides whether a failure is
    // an ERROR or merely a refresh that did not land.
    const dataRef = useRef<T | null>(null)

    // And WHICH path it belongs to. Navigating between two pull requests keeps
    // this hook mounted, so without it the previous page's data would make the
    // next one look like a refresh rather than a first load — and a failure on
    // the new path would then be swallowed while the old page's content stayed
    // on screen.
    const dataPath = useRef<string | null>(null)

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
        // Loading means "nothing to render"; refreshing means "something is on
        // screen and being replaced". Conflating them is what makes a polled
        // page flicker: every tick would unmount the content it just drew.
        const first = dataRef.current === null || dataPath.current !== path
        setLoading(first)
        setRefreshing(!first)
        if (first) setError(null)

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
                    // Only a failure with nothing behind it is the page's error.
                    // A poll that 500s once must not replace a review someone is
                    // reading with a banner, and must not blank it either: the
                    // data on screen was true a moment ago and is still the best
                    // thing we have.
                    if (first) {
                        setError(msg)
                        setData(null)
                        dataRef.current = null
                        dataPath.current = null
                    }
                } else {
                    dataRef.current = body as T
                    dataPath.current = path
                    setData(body as T)
                    setError(null)
                }
            } catch (e) {
                if (controller.signal.aborted || id !== reqId.current) return
                // Same rule: a dropped connection mid-poll is not a page error.
                if (first) {
                    setError(e instanceof Error ? e.message : "Network error")
                    setData(null)
                    dataRef.current = null
                    dataPath.current = null
                }
            } finally {
                if (id === reqId.current) {
                    setLoading(false)
                    setRefreshing(false)
                }
            }
        })()

        return () => controller.abort()
    }, [path, enabled, nonce])

    // Polling. Separate from the fetching effect so a re-fetch does not reset the
    // interval — otherwise a slow response would keep pushing the next poll out.
    useEffect(() => {
        if (!path || !enabled || !refreshMs) return

        const tick = () => {
            // A hidden tab's answer is discarded, so don't ask.
            if (typeof document !== "undefined" && document.hidden) return
            refetch()
        }
        const id = setInterval(tick, refreshMs)

        const onVisible = () => {
            if (typeof document !== "undefined" && !document.hidden) refetch()
        }
        document.addEventListener("visibilitychange", onVisible)
        return () => {
            clearInterval(id)
            document.removeEventListener("visibilitychange", onVisible)
        }
    }, [path, enabled, refreshMs, refetch])

    return { data, error, loading, refreshing, refetch }
}
