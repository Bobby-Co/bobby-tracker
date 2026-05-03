// Pure helpers for displaying public-session reporters. Lives outside
// any "use client" file so server components can call it directly
// when shaping data for the public listing.

export interface PublicListedIssue {
    id: string
    issue_number: number
    title: string
    project_name: string
    public_reporter_id: string | null
    public_reporter_name: string | null
    created_at: string
}

export interface ReporterGroup {
    /** Stable bucket key — reporter_id when present, "anon-no-id"
     *  otherwise (legacy rows from before migration 0010). */
    key: string
    reporter_id: string | null
    /** Most recent display name this reporter used. */
    display_name: string
    issues: PublicListedIssue[]
}

// Display label for a reporter on the public listing. Named submitters
// show their name; anonymous ones show "Anonymous · <short id>" using
// the first 6 chars of their stable browser id so different anonymous
// reporters stay visually distinct. Pre-migration rows (no id, no
// name) fall back to a generic "Anonymous" label.
export function reporterDisplay(id: string | null, name: string | null): string {
    if (name && name.trim()) return name.trim()
    if (id) return `Anonymous · ${id.replace(/-/g, "").slice(0, 6)}`
    return "Anonymous"
}

// Bucket flat issue rows into per-reporter groups. Caller passes rows
// pre-sorted descending by created_at; the returned groups are sorted
// by most-recently-active reporter first.
export function groupByReporter(rows: PublicListedIssue[]): ReporterGroup[] {
    const map = new Map<string, ReporterGroup>()
    for (const it of rows) {
        const key = it.public_reporter_id ?? "anon-no-id"
        let g = map.get(key)
        if (!g) {
            g = {
                key,
                reporter_id: it.public_reporter_id,
                display_name: reporterDisplay(it.public_reporter_id, it.public_reporter_name),
                issues: [],
            }
            map.set(key, g)
        } else if (it.public_reporter_name) {
            // If any submission by this id supplied a name, upgrade
            // the group label so the most recent one wins.
            g.display_name = it.public_reporter_name.trim()
        }
        g.issues.push(it)
    }
    return Array.from(map.values()).sort((a, b) => {
        const ta = Date.parse(a.issues[0]?.created_at ?? "")
        const tb = Date.parse(b.issues[0]?.created_at ?? "")
        return tb - ta
    })
}
