"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
import { createClient } from "@/lib/client/supabase"
import type { AnalyseEffort } from "@/modules/analysis"
import type { Issue, IssueSuggestion } from "@/lib/shared/types"

// useInvestigation — the analyser-run lifecycle for ONE issue, shared by every
// surface that shows "Investigate with analyser" (the issue-detail card and the
// timeline drawer). It owns the single rule those surfaces kept getting wrong:
//
//   a run is only over when a suggestion arrives that is NOT the one that was
//   on screen when the run started.
//
// Three independent paths can deliver that row — the awaited POST, the
// issue_suggestions realtime INSERT, and the polling fallback — and two of them
// (the poll and a page refetch) hand back "the latest row for this issue",
// which for a re-run is the PREVIOUS result until the new one is written. Left
// unguarded, the poll ends the wait ~3s in and re-displays the stale run while
// the real one is still going. Hence `baselineIdRef` + resolve() below: every
// delivery path funnels through one acceptance check.

/** How often the fallback poll asks for the issue's latest suggestion. */
const POLL_MS = 3000

/** How long to keep waiting on a detached run before giving up. Generous — a
 *  high-effort swarm can legitimately run for minutes — but bounded, so a run
 *  whose callback never lands can't spin the animation forever. */
const RUN_TIMEOUT_MS = 6 * 60 * 1000

type AnalysisStatus = Issue["analysis_status"]

interface SuggestionsPoll {
    suggestion: IssueSuggestion | null
    analysisStatus: AnalysisStatus
}

export interface Investigation {
    /** The suggestion to render. Never a half-written one: it only changes to a
     *  row that has actually been accepted as current. */
    suggestion: IssueSuggestion | null
    /** True from the moment a run is asked for until ITS result lands (or the
     *  run terminally fails). Drive the analysing animation off this. */
    pending: boolean
    error: string | null
    errorCode: string | null
    /** Start — or join — the single shared analysis run for this issue. Same run
     *  that feeds the VCS comment, so it never duplicates work. */
    investigate: () => void
    /** Force a fresh run that replaces the cached result. */
    regenerate: (effort?: AnalyseEffort | null) => void
}

/** CALLERS MUST KEY BY ISSUE. The hook holds one issue's run state in refs, and
 *  React keeps those across a prop change — so a surface that swaps `issueId` on
 *  a mounted instance (the drawer moving between tiles, the detail route
 *  navigating to a sibling issue) has to render it under `key={issue.id}`.
 *  Without that the previous issue's result stays on screen. */
export function useInvestigation({
    issueId,
    initial = null,
}: {
    issueId: string
    /** What the server already knows, when the caller has it. Adopted on arrival
     *  and on change — except while a run is in flight, where the row the run
     *  started from is ignored (see resolve). */
    initial?: IssueSuggestion | null
}): Investigation {
    const [suggestion, setSuggestion] = useState<IssueSuggestion | null>(initial)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [errorCode, setErrorCode] = useState<string | null>(null)

    // Guard state writes after unmount — the fetches deliberately outlive
    // navigation (the run keeps going in the background). Re-armed on mount so
    // a StrictMode remount doesn't leave the hook permanently deaf.
    const aliveRef = useRef(true)
    useEffect(() => {
        aliveRef.current = true
        return () => {
            aliveRef.current = false
        }
    }, [])

    // Mirrors of state for callbacks that outlive the render that created them
    // (the realtime handler subscribes once per issue).
    const suggestionRef = useRef<IssueSuggestion | null>(initial)
    const pendingRef = useRef(false)

    // The row on screen when the current run started. Anything still carrying
    // this id is the PREVIOUS run's output, not this one's.
    const baselineIdRef = useRef<string | null>(null)
    // Monotonic run token, bumped per run, so a late response from a superseded
    // run can't write into the current one.
    const runRef = useRef(0)
    // Only a detached /analyse run reports its terminal state through
    // issues.analysis_status. /suggest resolves inline and leaves that column
    // holding the PREVIOUS run's value, so honouring it there would end the
    // wait instantly on a stale "done".
    const detachedRef = useRef(false)
    const deadlineRef = useRef(0)

    const apply = useCallback((next: IssueSuggestion | null) => {
        suggestionRef.current = next
        setSuggestion(next)
    }, [])

    const settle = useCallback(() => {
        pendingRef.current = false
        setPending(false)
    }, [])

    /** Accept `next` as the current result, unless a run is in flight and this
     *  is the very row that run started from. Returns whether it was taken. */
    const resolve = useCallback(
        (next: IssueSuggestion | null | undefined): boolean => {
            if (!next) return false
            if (pendingRef.current && next.id === baselineIdRef.current) return false
            apply(next)
            settle()
            return true
        },
        [apply, settle],
    )

    const fail = useCallback(
        (e: unknown) => {
            if (e instanceof ApiError) {
                setError(e.message || `Failed (${e.status})`)
                setErrorCode(e.code || "unknown")
            } else {
                setError(e instanceof Error ? e.message : "Network error")
                setErrorCode("network_error")
            }
            settle()
        },
        [settle],
    )

    /** Open a run: snapshot what's on screen as the baseline, clear the last
     *  error, start the clock. Returns the token to check responses against. */
    const begin = useCallback((): number => {
        setError(null)
        setErrorCode(null)
        baselineIdRef.current = suggestionRef.current?.id ?? null
        detachedRef.current = false
        deadlineRef.current = Date.now() + RUN_TIMEOUT_MS
        pendingRef.current = true
        setPending(true)
        return ++runRef.current
    }, [])

    const current = useCallback((token: number) => aliveRef.current && runRef.current === token, [])

    const investigate = useCallback(() => {
        const token = begin()
        void (async () => {
            try {
                const body = await apiMutate<{ status?: string; suggestion?: IssueSuggestion | null }>(
                    `/api/issues/${issueId}/analyse`,
                    { method: "POST" },
                )
                if (!current(token)) return
                // A finished run answers inline; anything else means one is under
                // way and its row lands via realtime or the poll below.
                if (resolve(body?.suggestion)) return
                if (body?.status === "done") return settle() // nothing newer coming
                detachedRef.current = true
            } catch (e) {
                if (current(token)) fail(e)
            }
        })()
    }, [begin, current, fail, issueId, resolve, settle])

    const regenerate = useCallback(
        (effort?: AnalyseEffort | null) => {
            const token = begin()
            void (async () => {
                try {
                    const { suggestion: next } = await apiMutate<{ suggestion: IssueSuggestion | null }>(
                        `/api/issues/${issueId}/suggest`,
                        { method: "POST", body: effort ? { effort } : {} },
                    )
                    if (!current(token)) return
                    // /suggest is synchronous — the row it returns IS this run's
                    // result, so take it unconditionally (realtime may have landed
                    // the same row a moment earlier; same row either way).
                    if (next) apply(next)
                    settle()
                } catch (e) {
                    if (current(token)) fail(e)
                }
            })()
        },
        [apply, begin, current, fail, issueId, settle],
    )

    // Adopt what the server knows. A null is ignored on purpose: it means "the
    // server hasn't seen a row", which must never wipe a result this hook just
    // received. A non-null goes through resolve, so a page refetch that lands
    // mid-run can't put the previous result back on screen.
    useEffect(() => {
        if (initial) resolve(initial)
    }, [initial, resolve])

    // Realtime: the primary delivery path for a detached run, and it also picks
    // up rows written by another tab or by the VCS-comment flow.
    useEffect(() => {
        const supabase = createClient()
        const channel = supabase
            .channel(`issue-suggestions-${issueId}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "tracker",
                    table: "issue_suggestions",
                    filter: `issue_id=eq.${issueId}`,
                },
                (payload) => resolve(payload.new as IssueSuggestion),
            )
            .subscribe()
        return () => {
            void supabase.removeChannel(channel)
        }
    }, [issueId, resolve])

    // Polling fallback. Realtime should win the race, but if WAL events are
    // dropped — or the long /suggest POST is cut by a proxy after the row was
    // written — this is what gets the user off the animation. It also carries
    // the terminal-state signal for detached runs.
    useEffect(() => {
        if (!pending) return
        let cancelled = false
        const tick = async () => {
            try {
                const res = await fetch(`/api/issues/${issueId}/suggestions`, { cache: "no-store" })
                if (!res.ok || cancelled) return
                const { suggestion: latest, analysisStatus } = (await res.json()) as SuggestionsPoll
                if (cancelled) return
                if (resolve(latest)) return

                // A detached run that ended without writing a row — say so rather
                // than animate towards a result that will never arrive.
                if (detachedRef.current && (analysisStatus === "failed" || analysisStatus === "cancelled")) {
                    setError(
                        analysisStatus === "cancelled"
                            ? "The analyser run was cancelled."
                            : "The analyser run failed. Try again.",
                    )
                    setErrorCode(`analysis_${analysisStatus}`)
                    settle()
                    return
                }

                if (Date.now() > deadlineRef.current) {
                    setError("The analyser hasn't reported back yet. Try again.")
                    setErrorCode("analysis_timeout")
                    settle()
                }
            } catch {}
        }
        const id = setInterval(tick, POLL_MS)
        return () => {
            cancelled = true
            clearInterval(id)
        }
    }, [pending, issueId, resolve, settle])

    return { suggestion, pending, error, errorCode, investigate, regenerate }
}
