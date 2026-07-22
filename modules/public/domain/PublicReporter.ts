// Shapes the public-session listing read-model: reporter display labels, the
// parent/children duplicate tree, and per-reporter grouping. Pure — lives outside
// any "use client" file so server components can call it directly.

// Local status vocabulary — kept in-domain (not @/lib/supabase/types) so this
// pure policy carries no SDK dependency; byte-identical to the stored IssueStatus.
export type PublicIssueStatus = "open" | "in_progress" | "blocked" | "done" | "archived" | "duplicated"

export interface PublicListedIssue {
    id: string
    issue_number: number
    title: string
    status: PublicIssueStatus
    project_name: string
    public_reporter_id: string | null
    public_reporter_name: string | null
    /** Set when this issue is a duplicate of another; the listing renders it as an
     *  indented child under its parent. */
    duplicate_of_issue_id: string | null
    created_at: string
}

export interface PublicParentRow {
    parent: PublicListedIssue
    /** Direct duplicates, oldest → newest (natural conversation order). */
    children: PublicListedIssue[]
}

export interface PublicReporterGroup {
    /** Stable bucket key — reporter_id, or "anon-no-id" for legacy rows. */
    key: string
    reporter_id: string | null
    display_name: string
    /** Parent rows owned by this reporter (children may be others' — they still
     *  nest here so each thread reads as one unit under whoever started it). */
    rows: PublicParentRow[]
}

export class PublicReporter {
    /** Named submitters show their name; anonymous show "Anonymous · <short id>"
     *  (first 6 chars of their stable browser id); pre-migration rows → "Anonymous". */
    display(id: string | null, name: string | null): string {
        if (name && name.trim()) return name.trim()
        if (id) return `Anonymous · ${id.replace(/-/g, "").slice(0, 6)}`
        return "Anonymous"
    }

    /** Parent → children tree from a flat list (caller passes rows sorted desc by
     *  created_at). Duplicates nest under their parent; a duplicate whose parent
     *  isn't in the visible set surfaces as its own parent so it can't vanish. */
    groupByParent(rows: PublicListedIssue[]): PublicParentRow[] {
        const childrenByParent = new Map<string, PublicListedIssue[]>()
        for (const it of rows) {
            if (!it.duplicate_of_issue_id) continue
            const arr = childrenByParent.get(it.duplicate_of_issue_id) ?? []
            arr.push(it)
            childrenByParent.set(it.duplicate_of_issue_id, arr)
        }
        for (const arr of childrenByParent.values()) {
            arr.sort((a, b) => a.created_at.localeCompare(b.created_at))
        }

        const parents: PublicParentRow[] = []
        for (const it of rows) {
            if (it.duplicate_of_issue_id) continue
            parents.push({ parent: it, children: childrenByParent.get(it.id) ?? [] })
        }

        const visibleParentIds = new Set(parents.map((p) => p.parent.id))
        for (const it of rows) {
            if (!it.duplicate_of_issue_id) continue
            if (visibleParentIds.has(it.duplicate_of_issue_id)) continue
            parents.push({ parent: it, children: [] })
        }
        parents.sort((a, b) => b.parent.created_at.localeCompare(a.parent.created_at))
        return parents
    }

    /** Bucket parent rows by the parent's reporter (that dictates the thread's
     *  group even if some duplicates were filed by others), most-recent first.
     *  Display name uses the most recent label that reporter chose. */
    groupParentsByReporter(parents: PublicParentRow[]): PublicReporterGroup[] {
        const map = new Map<string, PublicReporterGroup>()
        for (const row of parents) {
            const it = row.parent
            const key = it.public_reporter_id ?? "anon-no-id"
            let g = map.get(key)
            if (!g) {
                g = {
                    key,
                    reporter_id: it.public_reporter_id,
                    display_name: this.display(it.public_reporter_id, it.public_reporter_name),
                    rows: [],
                }
                map.set(key, g)
            } else if (it.public_reporter_name) {
                g.display_name = it.public_reporter_name.trim()
            }
            g.rows.push(row)
        }
        return Array.from(map.values()).sort((a, b) => {
            const ta = a.rows[0]?.parent.created_at ?? ""
            const tb = b.rows[0]?.parent.created_at ?? ""
            return tb.localeCompare(ta)
        })
    }
}
