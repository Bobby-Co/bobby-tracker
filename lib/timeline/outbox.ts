import type { Issue } from "@/lib/supabase/types"

// Subset of Issue that the timeline can mutate via the schedule
// endpoint. Pulled out of the component file so the outbox can
// own the type without an import cycle.
export type SchedulePatch = Partial<
    Pick<Issue, "starts_at" | "ends_at" | "lane_y" | "color">
>

export interface OutboxEntry {
    issueId: string
    patch: SchedulePatch
    queuedAt: number
}

const STORAGE_PREFIX = "bobby-tracker:schedule-outbox:"

// ScheduleOutbox — local-first write buffer for the planning
// timeline. Drag / resize / unschedule gestures call enqueue()
// instead of hitting the API directly; a background loop in the
// component flushes entries to PATCH /api/issues/[id]/schedule on
// a 2s cadence and on tab-hide. Merge semantics are last-write-
// wins per issue id, so a flurry of micro-adjustments collapses
// into one PATCH per affected issue.
//
// Storage is keyed by project so two open projects don't trample
// each other's queues. Failures keep the entry around for retry;
// 4xx responses are dropped (the patch is wrong, retrying won't
// help) while 5xx and network errors leave it pending.
export class ScheduleOutbox {
    private entries: Map<string, OutboxEntry> = new Map()
    private readonly storageKey: string

    constructor(projectId: string) {
        this.storageKey = STORAGE_PREFIX + projectId
        this.load()
    }

    private load(): void {
        if (typeof window === "undefined") return
        try {
            const raw = window.localStorage.getItem(this.storageKey)
            if (!raw) return
            const arr = JSON.parse(raw) as OutboxEntry[]
            for (const e of arr) {
                if (e && typeof e.issueId === "string" && e.patch) {
                    this.entries.set(e.issueId, e)
                }
            }
        } catch {
            // Corrupt entry — start fresh rather than wedge.
            try { window.localStorage.removeItem(this.storageKey) } catch { /* ignore */ }
        }
    }

    private persist(): void {
        if (typeof window === "undefined") return
        try {
            const arr = Array.from(this.entries.values())
            if (arr.length === 0) {
                window.localStorage.removeItem(this.storageKey)
            } else {
                window.localStorage.setItem(this.storageKey, JSON.stringify(arr))
            }
        } catch {
            // Quota exceeded etc — non-fatal; in-memory queue still
            // works, we just won't survive a reload.
        }
    }

    /** Enqueue a patch. If an entry already exists for this issue,
     *  the new patch is merged on top (last-write-wins per field). */
    enqueue(issueId: string, patch: SchedulePatch): void {
        const existing = this.entries.get(issueId)?.patch ?? {}
        this.entries.set(issueId, {
            issueId,
            patch: { ...existing, ...patch },
            queuedAt: Date.now(),
        })
        this.persist()
    }

    peek(issueId: string): OutboxEntry | null {
        return this.entries.get(issueId) ?? null
    }

    remove(issueId: string): void {
        this.entries.delete(issueId)
        this.persist()
    }

    snapshot(): OutboxEntry[] {
        return Array.from(this.entries.values())
    }

    size(): number {
        return this.entries.size
    }
}
