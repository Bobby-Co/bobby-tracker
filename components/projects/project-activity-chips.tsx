"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { ProjectActivity } from "@/app/api/projects/[id]/activity/route"

// Ambient "something is running in the background" chips for the project
// header. Deliberately small and text-only: this is peripheral status, not a
// panel. The Knowledge tab's AnalyserPanel remains the place to actually watch
// an index run (phase, cost, elapsed, module progress) — these chips only tell
// you it's happening while you're on some other tab.
//
// Renders nothing when nothing is running, so a quiet project has no chrome.
//
// Two different clocks, because the two facts arrive differently:
//   - indexing   → realtime. tracker.project_analyser is already in the
//                  publication (0003), so status/phase flips arrive instantly
//                  and cost no polling.
//   - unembedded → polled. It's a COUNT over issues, not a row we can
//                  subscribe to, and each poll is also what SCHEDULES the next
//                  embedding batch (see the activity route). So the poll isn't
//                  just observation — it's the drain. It runs only while there
//                  IS a backlog and stops at zero.

const POLL_MS = 4000

export function ProjectActivityChips({ projectId }: { projectId: string }) {
    const [activity, setActivity] = useState<ProjectActivity | null>(null)
    // Kept in a ref so the poll effect doesn't re-subscribe every tick.
    const backlogRef = useRef(0)

    const refresh = useCallback(async () => {
        try {
            const res = await fetch(`/api/projects/${projectId}/activity`, {
                cache: "no-store",
                credentials: "same-origin",
            })
            if (!res.ok) return
            const { activity: next } = (await res.json()) as { activity: ProjectActivity }
            backlogRef.current = next.unembedded
            setActivity(next)
        } catch {
            // Ambient status — a failed poll just leaves the last known state up.
        }
    }, [projectId])

    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh() sets state after an awaited fetch, not synchronously
    useEffect(() => { void refresh() }, [refresh])

    // Poll ONLY while there's a backlog to drain. Once it hits zero the interval
    // clears and the project page goes quiet — no timer running on every project
    // page forever just to display nothing.
    useEffect(() => {
        if (!activity || activity.unembedded === 0) return
        const t = setInterval(() => {
            void refresh()
            // Stop the moment the backlog is gone; the effect re-runs on the
            // state change anyway, but this avoids one extra tick.
            if (backlogRef.current === 0) clearInterval(t)
        }, POLL_MS)
        return () => clearInterval(t)
    }, [activity, refresh])

    // Indexing arrives over realtime — no poll needed. RLS scopes the stream to
    // rows the caller owns (0005 denormalised user_id onto this table precisely
    // so the policy stays a flat, Realtime-evaluable check).
    useEffect(() => {
        const supabase = createClient()
        const channel = supabase
            .channel(`project-activity-${projectId}`)
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "tracker",
                    table: "project_analyser",
                    filter: `project_id=eq.${projectId}`,
                },
                // Re-read through the endpoint rather than trusting the payload:
                // the WAL row tells us about indexing, but the chip row also
                // carries the embedding backlog, and an index finishing is exactly
                // when that count is worth re-checking.
                () => { void refresh() },
            )
            .subscribe()
        return () => { void supabase.removeChannel(channel) }
    }, [projectId, refresh])

    if (!activity) return null
    const { indexing, unembedded } = activity
    if (!indexing && unembedded === 0) return null

    return (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {indexing && (
                <span className="pill pill-warn" title={indexing.phase ?? "Building the knowledge graph"}>
                    <Spinner />
                    {/* The phase can be long ("Embedding modules 3/12") and this
                        sits next to the project name — cap it and let the title
                        attribute carry the full text. */}
                    <span className="max-w-[160px] truncate">
                        {indexing.phase ? `Indexing — ${indexing.phase}` : "Indexing…"}
                    </span>
                </span>
            )}
            {unembedded > 0 && (
                <span className="pill" title="Building similarity vectors so these issues can be matched against duplicates">
                    <Spinner />
                    Embedding {unembedded} {unembedded === 1 ? "issue" : "issues"}…
                </span>
            )}
        </div>
    )
}

// Matches the pill's 11px text — a bare ring rather than a glyph, so it reads as
// motion rather than an icon competing with the label.
function Spinner() {
    return (
        <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-current border-t-transparent opacity-70"
        />
    )
}
