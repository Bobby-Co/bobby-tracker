// A New Issue composition that survives being minimized and navigated away from.
//
// The composer no longer discards what you were writing when you close it or
// jump to another tab: a draft with any content is KEPT — persisted per project
// in the browser — and re-openable from a peeking tab on the right edge. Only a
// truly blank draft is thrown away. This module is the pure shape + the rules
// that decide "is this worth keeping?" and "what do we call it in the tab?"; the
// React layer owns the storage I/O and the ids.

import type { AnalyseEffort } from "@/modules/analysis/domain/ProjectAnalyser"

// The domain layer can't import server-side lib/shared/types, so the issue enums
// are mirrored here (as Issue.ts already mirrors IssueStatusValue). A compile-time
// drift guard in issue-form.tsx keeps these in lock-step with the real enums.
export type DraftStatus = "open" | "in_progress" | "blocked" | "done" | "archived" | "duplicated"
export type DraftPriority = "low" | "medium" | "high" | "urgent"

// "" on effort = inherit the project default (mirrors the form's EffortChoice).
export type DraftEffort = "" | AnalyseEffort

// The persisted fields — exactly what the form edits and what a POST needs.
export interface DraftFields {
    title: string
    body: string
    status: DraftStatus
    priority: DraftPriority
    labels: string
    effort: DraftEffort
    /** Which indexed tree the issue is about, and therefore what its
     *  investigation reads. THREE states, and the third is the point:
     *    null — not chosen yet. The composer will not submit on it when the
     *           project offers a real choice, because picking the tree an issue
     *           is about is a decision, not a default.
     *    ""   — chosen: the project's default branch.
     *    name — chosen: that tracked branch.
     *  Kept as a plain string rather than a union: the valid values are a
     *  project's tracked branches, which are data, not a type. */
    branch: string | null
}

// A stored draft: fields + identity + recency (for stable tab ordering).
export interface IssueDraft extends DraftFields {
    id: string
    projectId: string
    updatedAt: number
}

export const EMPTY_DRAFT_FIELDS: DraftFields = {
    title: "",
    body: "",
    status: "open",
    priority: "medium",
    labels: "",
    effort: "",
    // Unchosen, not "the default" — see DraftFields.branch.
    branch: null,
}

/** The localStorage key. One entry holds every project's drafts, grouped by
 *  project id, so opening a different project shows only its own drafts. The
 *  `v1` guards against a future shape change reading stale JSON as valid. */
export const DRAFTS_STORAGE_KEY = "issue-drafts:v1"

/** A draft is worth keeping only if the author actually WROTE something — a
 *  title, a body, or labels. Status/priority/effort/branch left at (or even
 *  moved from) their defaults don't make an otherwise-blank draft worth a tab:
 *  there's nothing to come back to. Blank drafts are discarded on
 *  minimize/navigation. */
export function draftIsEmpty(f: DraftFields): boolean {
    return !f.title.trim() && !f.body.trim() && !f.labels.trim()
}

/** What the peeking tab reads. The title if there is one; else the first
 *  non-blank line of the body (markdown syntax and all — it's a hint, not a
 *  render); else a neutral placeholder so a body-only draft still has a label. */
export function draftSummary(f: DraftFields): string {
    const title = f.title.trim()
    if (title) return title
    const firstLine = f.body
        .split("\n")
        .map((l) => l.replace(/^#+\s*/, "").trim())
        .find((l) => l.length > 0)
    return firstLine || "Untitled draft"
}

type DraftStore = Record<string, IssueDraft[]>

/** Parse the stored blob defensively — anything malformed becomes an empty
 *  store rather than throwing into render. Non-array project buckets and
 *  non-object roots are dropped. */
export function parseDraftStore(raw: string | null): DraftStore {
    if (!raw) return {}
    try {
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
        const out: DraftStore = {}
        for (const [projectId, list] of Object.entries(parsed as Record<string, unknown>)) {
            if (Array.isArray(list)) out[projectId] = list as IssueDraft[]
        }
        return out
    } catch {
        return {}
    }
}
