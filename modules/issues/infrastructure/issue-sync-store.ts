// Issues infrastructure — service-role issue operations the GitHub-sync /
// analysis flow needs. Same convention as issue-store.ts: plain functions over
// the service client (not the RLS-scoped IssuesRepository port). These centralise
// all tracker.issues + issue_suggestions access for the sync engine so other
// modules never query those tables directly.
//
// NOTE: several columns written here (github_issue_number, github_node_id,
// sync_source, last_synced_hash, github_synced_at, github_analysis_comment_id,
// analysis_status) are GitHub-integration / analysis state that currently lives
// on the issues row. Exposing them as issues-owned operations is the LOGICAL
// ownership step; a later physical split (an integration-owned table/columns)
// would remove the shared-table coupling entirely.

import type { createServiceClient } from "@/lib/supabase/server"
import type { IssueStatus } from "@/lib/supabase/types"

type Svc = ReturnType<typeof createServiceClient>

// The subset of a tracker.issues row the analysis flow reads.
export type IssueAnalysisRow = {
    id: string
    project_id: string
    issue_number: number
    title: string
    body: string | null
    status: IssueStatus
    priority: string | null
    labels: string[] | null
    github_issue_number: number | null
    github_analysis_comment_id: number | null
    analysis_status: string | null
}

const ANALYSIS_ISSUE_COLS =
    "id,project_id,issue_number,title,body,status,priority,labels,github_issue_number,github_analysis_comment_id,analysis_status"

/** Read the analysis-flow view of an issue by id (or task id, which is the id). */
export async function findIssueAnalysisRow(svc: Svc, issueId: string): Promise<IssueAnalysisRow | null> {
    const { data } = await svc
        .from("issues")
        .select(ANALYSIS_ISSUE_COLS)
        .eq("id", issueId)
        .maybeSingle<IssueAnalysisRow>()
    return data ?? null
}

/** The GitHub issue numbers already linked in a project (for import de-dupe). */
export async function listLinkedGithubNumbers(svc: Svc, projectId: string): Promise<(number | null)[]> {
    const { data } = await svc
        .from("issues")
        .select("github_issue_number")
        .eq("project_id", projectId)
        .not("github_issue_number", "is", null)
    return ((data ?? []) as { github_issue_number: number | null }[]).map((r) => r.github_issue_number)
}

/** GitHub-integration / analysis columns on an issue row. */
export interface IssueSyncPatch {
    sync_source?: string
    last_synced_hash?: string
    github_synced_at?: string
    github_issue_number?: number | null
    github_node_id?: string | null
    github_analysis_comment_id?: number | null
    analysis_status?: string
}

export async function updateIssueSyncFields(svc: Svc, issueId: string, patch: IssueSyncPatch): Promise<void> {
    await svc.from("issues").update(patch).eq("id", issueId)
}

export type ImportedIssueInsert = {
    project_id: string
    user_id: string
    title: string
    body: string
    status: string
    github_issue_number: number
    github_node_id: string | null
    sync_source: string
    last_synced_hash: string
    github_synced_at: string
}

/** Insert an issue imported from GitHub. Returns true on success (the caller
 *  counts imports on a non-error, mirroring the previous inline insert). */
export async function insertImportedIssue(svc: Svc, row: ImportedIssueInsert): Promise<boolean> {
    const { error } = await svc.from("issues").insert(row)
    return !error
}

export async function countIssueSuggestions(svc: Svc, issueId: string): Promise<number> {
    const { count } = await svc.from("issue_suggestions").select("id", { count: "exact", head: true }).eq("issue_id", issueId)
    return count ?? 0
}

export type IssueSuggestionInsert = {
    issue_id: string
    data: unknown
    markdown: string
    code_cites: { file: string; line?: number }[]
    graph_cites: string[]
    confidence: string | null
    cost_usd: number
    duration_ms: number
    graph_id: string | null
}

export async function insertIssueSuggestion(svc: Svc, row: IssueSuggestionInsert): Promise<void> {
    await svc.from("issue_suggestions").insert(row)
}
