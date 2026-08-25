"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { ScheduleOutbox, type SchedulePatch } from "./outbox"
import type { Issue } from "@/lib/shared/types"

const OUTBOX_FLUSH_MS = 2000

// How long a just-flushed patch keeps overriding the server's copy of an
// issue. It's dropped as soon as the server echoes it back (the normal
// case, one refetch later); the timer only matters if the row is changed
// somewhere else entirely, where pinning our value forever would be worse
// than accepting theirs.
const SETTLED_TTL_MS = 20_000

// Patch fields, compared the way the DB round-trips them: timestamps come
// back in a different ISO shape than we send, and lane_y is a `real`, so
// neither survives ===.
export function patchApplied(issue: Issue, patch: SchedulePatch): boolean {
    for (const key of Object.keys(patch) as (keyof SchedulePatch)[]) {
        const want = patch[key]
        const got = issue[key]
        if (want === undefined) continue
        if (want === null || got == null) {
            if (want !== got) return false
            continue
        }
        if (key === "starts_at" || key === "ends_at") {
            if (Date.parse(String(want)) !== Date.parse(String(got))) return false
        } else if (key === "lane_y") {
            if (Math.abs(Number(want) - Number(got)) > 1e-4) return false
        } else if (want !== got) {
            return false
        }
    }
    return true
}

// Pending (not yet sent) patches laid over freshly-loaded rows. Used for
// the first render, where nothing has been flushed yet — see `reconcile`
// for the full version.
function overlayOutbox(rows: Issue[], outbox: ScheduleOutbox | null): Issue[] {
    if (!outbox || outbox.size() === 0) return rows
    return rows.map((row) => {
        const queued = outbox.peek(row.id)
        return queued ? { ...row, ...queued.patch } : row
    })
}

// useScheduleSync — local-first schedule editing for the planning board.
// Owns a localStorage-backed outbox, an optimistic local mirror of the
// issues, and the background flush loop that PATCHes
// /api/issues/[id]/schedule every ~2s (and on tab hide via keepalive).
// Gestures call commitSchedule(); the network round trip is invisible to
// them.
//
// onPersisted fires once per flush cycle after edits reach the server, so
// the owner can revalidate its client data source (useApi refetch) — this
// view is hydrated via useApi, not server components, so router.refresh()
// would revert the just-saved tiles.
//
// That refetch is also the thing most likely to make the board flicker, so
// incoming server data is reconciled rather than trusted outright:
//
//   • pending outbox patches are overlaid (the edit hasn't been sent yet);
//   • just-flushed patches stay overlaid until the server's copy actually
//     shows them, so a response that raced the write can't rewind a tile;
//   • while a gesture is in flight, server data isn't applied at all; the
//     release re-runs that effect and takes whatever arrived meanwhile, so
//     nothing moves under the cursor mid-drag.
export function useScheduleSync(
    projectId: string,
    issues: Issue[],
    onPersisted?: () => void,
    /** When false, edits stay in local state: no outbox, no PATCH. Lets the
     *  board be mounted somewhere with no project behind it — the landing
     *  demo — without firing writes that would 401. */
    persist = true,
    /** True while the user is dragging / resizing. Server data that lands
     *  during a gesture is held until it ends. */
    hold = false,
) {
    const [outbox] = useState<ScheduleOutbox | null>(() =>
        typeof window === "undefined" || !persist ? null : new ScheduleOutbox(projectId),
    )

    // Patches the server has accepted but may not have echoed back yet.
    const settled = useRef(new Map<string, { patch: SchedulePatch; at: number }>())

    // Server rows + everything we know is newer than them. Settled patches
    // go on first so a still-pending outbox edit wins over the older value.
    const reconcile = useCallback(
        (rows: Issue[]): Issue[] => {
            const now = Date.now()
            // Sweep first, so an entry whose issue has since left the board
            // (deleted, filtered out) can't sit in the map forever.
            for (const [id, s] of settled.current) {
                if (now - s.at > SETTLED_TTL_MS) settled.current.delete(id)
            }
            return rows.map((row) => {
                const s = settled.current.get(row.id)
                if (s) {
                    // The server has caught up (or we've waited long enough
                    // to stop insisting) — let its copy through.
                    if (patchApplied(row, s.patch) || now - s.at > SETTLED_TTL_MS) {
                        settled.current.delete(row.id)
                    }
                }
                const pending = settled.current.get(row.id)
                const queued = outbox?.peek(row.id)
                if (!pending && !queued) return row
                return { ...row, ...pending?.patch, ...queued?.patch }
            })
        },
        [outbox],
    )

    // Nothing has been flushed at mount, so the outbox (restored from
    // localStorage) is the only thing to lay over the server's rows.
    const [local, setLocal] = useState<Issue[]>(() => overlayOutbox(issues, outbox))
    // The props array `local` was last built from, so a re-render that
    // didn't bring new data doesn't rebuild it.
    const applied = useRef(issues)

    // Take server data — unless a gesture is running, in which case this
    // effect simply doesn't apply it. `hold` is a dependency, so releasing
    // re-runs it and whatever arrived meanwhile lands then.
    useEffect(() => {
        if (hold || applied.current === issues) return
        applied.current = issues
        setLocal(reconcile(issues))
    }, [issues, hold, reconcile])

    // Set when a patch is rejected outright (a 4xx — retrying can't help,
    // so it's dropped and the tile will spring back on the next refetch).
    // The board surfaces it rather than letting the board silently disagree
    // with the database. Cleared by the next successful flush.
    const [syncError, setSyncError] = useState<string | null>(null)

    function commitSchedule(issueId: string, patch: SchedulePatch) {
        // flushSync so the DOM reflects the new placement before a
        // caller resets any drag transform.
        flushSync(() => {
            setLocal((prev) => prev.map((i) => (i.id === issueId ? { ...i, ...patch } : i)))
        })
        outbox?.enqueue(issueId, patch)
    }

    useEffect(() => {
        if (!outbox) return
        let inFlight = false

        async function flush(opts: { keepalive?: boolean } = {}) {
            if (inFlight) return
            if (!outbox || outbox.size() === 0) return
            inFlight = true
            try {
                let synced = 0
                let rejected = 0
                for (const entry of outbox.snapshot()) {
                    try {
                        const res = await fetch(`/api/issues/${entry.issueId}/schedule`, {
                            method: "PATCH",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify(entry.patch),
                            keepalive: opts.keepalive,
                        })
                        if (res.ok) {
                            // Conditional: if the tile was moved again while
                            // this was in flight, that newer patch stays
                            // queued instead of being wiped by this reply.
                            if (outbox.remove(entry.issueId, entry.seq)) {
                                settled.current.set(entry.issueId, {
                                    patch: entry.patch,
                                    at: Date.now(),
                                })
                            }
                            synced++
                        } else if (res.status >= 400 && res.status < 500) {
                            outbox.remove(entry.issueId, entry.seq)
                            rejected++
                        } else {
                            break
                        }
                    } catch {
                        break
                    }
                }
                if (rejected > 0) {
                    setSyncError(
                        `${rejected} change${rejected === 1 ? "" : "s"} couldn't be saved`,
                    )
                } else if (synced > 0) {
                    setSyncError(null)
                }
                if (synced > 0) onPersisted?.()
            } finally {
                inFlight = false
            }
        }

        const intervalId = window.setInterval(flush, OUTBOX_FLUSH_MS)

        function onHide() {
            if (document.visibilityState === "hidden") void flush({ keepalive: true })
        }
        document.addEventListener("visibilitychange", onHide)
        window.addEventListener("pagehide", onHide)
        void flush()

        return () => {
            window.clearInterval(intervalId)
            document.removeEventListener("visibilitychange", onHide)
            window.removeEventListener("pagehide", onHide)
        }
    }, [outbox, onPersisted])

    return { local, commitSchedule, syncError }
}

export type { SchedulePatch }
