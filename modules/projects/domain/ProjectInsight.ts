// The ProjectInsight domain object — the projects context's read-model aggregate
// for a project tile's live status.
//
// "Which footer a tile shows, and for how long" (insight rows 0047/0048) is a
// pure BEHAVIOUR of the insight — a function of (its fields, now). So it belongs
// TO the insight, expressed as `ProjectInsight.of(row).status(now)`, not a loose
// `pickStatus` free function floating beside the type it reads.
//
// Pure domain: no I/O, framework, or SDK. ProjectInsightState is kept local (not
// the DB `ProjectInsight` row) so the aggregate carries no persistence
// dependency; a drift guard in ../infrastructure keeps it aligned with the row.

/** The minimal insight state the status rule reads. Fields are the raw signals
 *  (timestamps, not counts) so the window filtering can happen at read time — see
 *  `status()`. */
export interface ProjectInsightState {
    open_total: number
    done_total: number
    urgent_open: number
    last_urgent_at: string | null
    last_issue_created_at: string | null
    recent_pr_opens: string[]
}

/** The footer a project tile shows. Each variant carries its own `at` — the
 *  timestamp of the thing the footer is actually reporting — so the time text
 *  always agrees with the text beside it. */
export type ProjectStatus =
    | { kind: "progress"; done: number; total: number; at: string | null }
    | { kind: "clear"; at: string | null }
    | { kind: "critical"; count: number; at: string | null }
    | { kind: "pr"; count: number; at: string | null }

const HOUR = 3_600_000


export class ProjectInsight {
    /** How long a newly-urgent issue outranks everything else on the tile. */
    static readonly URGENT_WINDOW_MS = 24 * HOUR
    /** How long a freshly-opened PR outranks the default done/total footer. */
    static readonly PR_WINDOW_MS = 6 * HOUR

    private constructor(private readonly state: ProjectInsightState | null) {}

    /** Build the aggregate from a project's insight row. Null-safe — a project
     *  with no insight row yet reads as `clear`. */
    static of(state: ProjectInsightState | null | undefined): ProjectInsight {
        return new ProjectInsight(state ?? null)
    }

    /** The tile footer to show at `now`. Strict priority — first match wins: a
     *  louder signal (a fresh critical, then a fresh PR) outranks a quieter one
     *  until its window lapses, then the tile decays on its own with no cron and
     *  no refetch (the "show it for a while, then go back" behaviour is a pure
     *  function of the raw timestamps, so nothing needs to fire to flip it back). */
    status(now = Date.now()): ProjectStatus {
        const s = this.state
        if (!s) return { kind: "clear", at: null }

        if (s.urgent_open > 0 && this.age(s.last_urgent_at, now) < ProjectInsight.URGENT_WINDOW_MS) {
            return { kind: "critical", count: s.urgent_open, at: s.last_urgent_at }
        }

        const recentPrs = (s.recent_pr_opens ?? []).filter((t) => this.age(t, now) < ProjectInsight.PR_WINDOW_MS)
        if (recentPrs.length > 0) {
            // max(), not [0] — the trigger prepends, but webhook deliveries can
            // arrive out of order, so newest-first isn't guaranteed.
            const latest = recentPrs.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a))
            return { kind: "pr", count: recentPrs.length, at: latest }
        }

        const total = s.open_total + s.done_total
        if (total === 0) return { kind: "clear", at: s.last_issue_created_at }

        return { kind: "progress", done: s.done_total, total, at: s.last_issue_created_at }
    }

    private age(ts: string | null | undefined, now: number): number {
        if (!ts) return Infinity
        const t = Date.parse(ts)
        return Number.isNaN(t) ? Infinity : now - t
    }
}
