// Pure helpers for shaping data on the public-session listing.
// Lives outside any "use client" file so server components can call
// it directly when prepping data for the public submissions panel.

import type { IssueStatus } from "@/lib/supabase/types"

export interface PublicListedIssue {
    id: string
    issue_number: number
    title: string
    status: IssueStatus
    project_name: string
    public_reporter_id: string | null
    public_reporter_name: string | null
    /** Set when this issue was marked as a duplicate of another;
     *  the listing renders such issues as indented children under
     *  their parent rather than as standalone cards. */
    duplicate_of_issue_id: string | null
    created_at: string
}

export interface PublicParentRow {
    parent: PublicListedIssue
    /** Direct duplicates of this parent. Sorted oldest → newest so
     *  the most recent submission stays at the bottom of the
     *  expanded list, matching natural conversation order. */
    children: PublicListedIssue[]
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

// Build a parent → children tree from a flat issue list. Mirrors the
// auth-side issues page so the public listing reads with the same
// hierarchy: top-level rows for non-duplicate issues, indented
// children for the duplicates pointing at them. Cross-reporter
// links are honored — a duplicate appears under its parent
// regardless of who reported either issue, and never twice.
//
// Caller passes rows pre-sorted descending by created_at; parent
// order is preserved (newest parents first), child order is
// flipped to ascending so they read in submission order under
// their parent.
export function groupByParent(rows: PublicListedIssue[]): PublicParentRow[] {
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

    // Orphan-duplicate guard: if a child's parent isn't in the
    // visible set (e.g. filtered out by own-visibility), surface
    // the child as its own top-level parent so it doesn't vanish.
    const visibleParentIds = new Set(parents.map((p) => p.parent.id))
    for (const it of rows) {
        if (!it.duplicate_of_issue_id) continue
        if (visibleParentIds.has(it.duplicate_of_issue_id)) continue
        parents.push({ parent: it, children: [] })
    }
    parents.sort((a, b) => b.parent.created_at.localeCompare(a.parent.created_at))
    return parents
}
