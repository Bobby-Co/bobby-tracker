// Issues module — the issue_suggestions repository PORT.
//
// Split out of IssuesRepository rather than living beside the issue reads,
// because `issue_suggestions` is one of only three tables in the
// `supabase_realtime` publication: the browser subscribes to it directly with
// postgres_changes (lib/client/hooks/use-investigation.ts) to show an analysis
// landing live.
//
// That makes it CONTROL-PLANE data under the regional split. A browser can only
// subscribe to a database whose JWTs it holds, so keeping every realtime table
// central means the client keeps a single Supabase connection — one CSP
// connect-src, one set of credentials — while the regional data plane stays
// server-accessed only. Leaving these two methods on IssuesRepository would have
// made that class straddle both planes for the sake of two queries.
//
// The table is already shaped for this: 0052 gave it a denormalised `team_id` so
// its RLS policy is a single-column check with no join to the content side.

import type { IssueSuggestion } from "@/lib/shared/types"

/** The columns needed to persist a fresh analyser suggestion. */
export type NewIssueSuggestion = {
    issue_id: string
    data: unknown
    markdown: string
    code_cites: { file: string; line?: number }[]
    graph_cites: string[]
    confidence: string | null
    cost_usd: number
    duration_ms: number
    graph_id: string | null
    /** The tree this analysis was computed from; null = the project default.
     *  Part of the cache key — see the column comment in 0094. */
    branch: string | null
}

export interface IssueSuggestionsRepository {
    /** The latest cached analyser suggestion for an issue, or null when none
     *  exists. Throws {@link RepositoryError} on query failure. */
    findLatest(issueId: string): Promise<IssueSuggestion | null>

    /** Persist a fresh analyser suggestion and return the stored row. Throws
     *  {@link RepositoryError} on failure. */
    insert(row: NewIssueSuggestion): Promise<IssueSuggestion>

    /** Remove every suggestion for these issues.
     *
     *  Exists because 0068 dropped issue_suggestions.issue_id → issues: this
     *  table is control-plane and the issues are regional, so no foreign key can
     *  span them and the ON DELETE CASCADE that used to do this is gone. A no-op
     *  on an empty list rather than a query with an empty IN clause. */
    deleteForIssues(issueIds: string[]): Promise<void>
}
