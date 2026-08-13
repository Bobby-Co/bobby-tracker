"use client"

import { useEffect, useState } from "react"
import { flushSync } from "react-dom"
import { ScheduleOutbox, type SchedulePatch } from "./outbox"
import type { Issue } from "@/lib/shared/types"

const OUTBOX_FLUSH_MS = 2000

// Overlay any pending outbox patches on top of a freshly-loaded
// issues array, so local edits stay visible across refreshes until
// the patches flush to the server. (Mirrors the same-named helper
// in issue-timeline.tsx.)
function overlayOutbox(issues: Issue[], outbox: ScheduleOutbox | null): Issue[] {
    if (!outbox || outbox.size() === 0) return issues
    return issues.map((i) => {
        const entry = outbox.peek(i.id)
        return entry ? { ...i, ...entry.patch } : i
    })
}

// useScheduleSync — local-first schedule editing shared by the
// planning views. Owns a localStorage-backed outbox, an optimistic
// local mirror of the issues, and the background flush loop that
// PATCHes /api/issues/[id]/schedule every ~2s (and on tab hide via
// keepalive). Gestures call commitSchedule(); the network round trip
// is invisible to them. Extracted from issue-timeline.tsx so the
// LEGO board reuses the exact same write path.
//
// onPersisted fires once per flush cycle after edits reach the
// server, so the owner can revalidate its client data source
// (useApi refetch) — this view is hydrated via useApi, not server
// components, so router.refresh() would revert the just-saved tiles.
export function useScheduleSync(
    projectId: string,
    issues: Issue[],
    onPersisted?: () => void,
    /** When false, edits stay in local state: no outbox, no PATCH. Lets the
     *  board be mounted somewhere with no project behind it — the landing
     *  demo — without firing writes that would 401. */
    persist = true,
) {
    const [outbox] = useState<ScheduleOutbox | null>(() =>
        typeof window === "undefined" || !persist ? null : new ScheduleOutbox(projectId),
    )

    const [local, setLocal] = useState<Issue[]>(() => overlayOutbox(issues, outbox))
    const [seenIssues, setSeenIssues] = useState(issues)
    if (issues !== seenIssues) {
        setSeenIssues(issues)
        setLocal(overlayOutbox(issues, outbox))
    }

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
                for (const entry of outbox.snapshot()) {
                    try {
                        const res = await fetch(`/api/issues/${entry.issueId}/schedule`, {
                            method: "PATCH",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify(entry.patch),
                            keepalive: opts.keepalive,
                        })
                        if (res.ok) {
                            outbox.remove(entry.issueId)
                            synced++
                        } else if (res.status >= 400 && res.status < 500) {
                            outbox.remove(entry.issueId)
                        } else {
                            break
                        }
                    } catch {
                        break
                    }
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

    return { local, commitSchedule }
}

export type { SchedulePatch }
