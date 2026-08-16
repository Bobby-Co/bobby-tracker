// Issues infrastructure — the service-role issues store. ONE class owning all
// tracker.issues + issue_suggestions + issue_comments access the GitHub-sync /
// analysis flows need (they run in webhook / fire-and-forget contexts that bypass
// RLS, so they can't use the request-scoped IssuesRepository). Cross-module
// orchestrators depend on the IssueSyncStore PORT and obtain an instance from
// createServiceIssueSyncStore(), so their application layer never holds a
// Supabase client.
//
// TWO HANDLES, one client today — mirroring RequestContext. `issues` and
// `issue_comments` are DATA plane; `issue_suggestions` is CONTROL plane, because
// it is in the supabase_realtime publication and the browser subscribes to it
// directly (see ports/IssueSuggestionsRepository.ts for the full reasoning).
// This class is the service-role counterpart of that split: without it, the two
// suggestion methods below would keep writing to whichever database `issues`
// happens to live in, and would start missing the moment the planes separate.
//
// NOTE: several columns written here (github_issue_number, github_node_id,
// sync_source, last_synced_hash, github_synced_at, github_analysis_comment_id,
// analysis_status) are GitHub-integration / analysis state that currently lives
// on the issues row; a later physical split would remove the shared-table coupling.

import { Supabase, type SupabaseRlsClient } from "@/lib/server/supabase"
import type { IssueStatus } from "@/lib/shared/types"
import { RepositoryError } from "@/lib/shared/kernel"

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
    /** When the current run was dispatched (0071). Null = unknown, which the
     *  staleness guard reads as abandoned. */
    analysis_started_at: string | null
}

const ANALYSIS_ISSUE_COLS =
    "id,project_id,issue_number,title,body,status,priority,labels,github_issue_number,github_analysis_comment_id,analysis_status,analysis_started_at"

/** GitHub-integration / analysis columns on an issue row. */
export interface IssueSyncPatch {
    analysis_started_at?: string | null
    sync_source?: string
    last_synced_hash?: string
    github_synced_at?: string
    github_issue_number?: number | null
    github_node_id?: string | null
    github_analysis_comment_id?: number | null
    analysis_status?: string
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

/** The issue-comment mirror row (tracker.issue_comments) — written by the webhook
 *  + backfill (provenance 'github') and the authoring routes (provenance
 *  'tracker'). Undefined fields are dropped so a sparse source never clobbers a
 *  richer one. */
export type IssueCommentUpsert = {
    issue_number: number
    github_comment_id: number
    provenance?: "github" | "tracker"
    author_user_id?: string | null
    author_login?: string | null
    author_avatar_url?: string | null
    body?: string | null
    html_url?: string | null
    gh_created_at?: string | null
    gh_updated_at?: string | null
}

/** The service-role issues store — the injectable PORT the cross-module
 *  orchestrators (vcs' VcsAppService, the analysis flow) depend on. */
export interface IssueSyncStore {
    /** The analysis-flow view of an issue by id (or task id, which is the id). */
    findAnalysisRow(issueId: string): Promise<IssueAnalysisRow | null>
    /** GitHub issue numbers already linked in a project (import de-dupe). */
    listLinkedGithubNumbers(projectId: string): Promise<(number | null)[]>
    /** Patch the GitHub-integration / analysis columns on an issue row. */
    updateSyncFields(issueId: string, patch: IssueSyncPatch): Promise<void>
    /** Insert an issue imported from GitHub. True on success. */
    insertImportedIssue(row: ImportedIssueInsert): Promise<boolean>
    /** How many cached suggestions an issue has. */
    countSuggestions(issueId: string): Promise<number>
    /** Cache an analyser suggestion. */
    insertSuggestion(row: IssueSuggestionInsert): Promise<void>
    /** Upsert an issue-comment mirror row. */
    upsertComment(projectId: string, comment: IssueCommentUpsert): Promise<void>
    /** Delete an issue-comment mirror row. */
    deleteComment(projectId: string, commentId: number): Promise<void>
}

type ServiceDb = ReturnType<typeof Supabase.service>

/** The Supabase service-role implementation. Construct via the factory below.
 *
 *  `controlDb` defaults to `dataDb` so a single-database host is unchanged. */
export class ServiceIssueSyncStore implements IssueSyncStore {
    constructor(
        private readonly svc: ServiceDb,
        private readonly controlDb: ServiceDb = svc,
    ) {}

    async findAnalysisRow(issueId: string): Promise<IssueAnalysisRow | null> {
        const { data } = await this.svc
            .from("issues")
            .select(ANALYSIS_ISSUE_COLS)
            .eq("id", issueId)
            .maybeSingle<IssueAnalysisRow>()
        return data ?? null
    }

    async listLinkedGithubNumbers(projectId: string): Promise<(number | null)[]> {
        const { data } = await this.svc
            .from("issues")
            .select("github_issue_number")
            .eq("project_id", projectId)
            .not("github_issue_number", "is", null)
        return ((data ?? []) as { github_issue_number: number | null }[]).map((r) => r.github_issue_number)
    }

    async updateSyncFields(issueId: string, patch: IssueSyncPatch): Promise<void> {
        // .select() so we learn how many rows this MATCHED, not just whether the
        // statement was accepted.
        //
        // An UPDATE against the wrong region is the failure this exists to catch:
        // it matches zero rows, returns no error, and looks exactly like success.
        // That is how a lost analysis_status turned into a page that re-dispatched
        // a paid analysis on every refresh — the write "worked" every time and
        // changed nothing. Silence is the bug; the throw is the fix.
        const { data, error } = await this.svc.from("issues").update(patch).eq("id", issueId).select("id")
        if (error) throw new RepositoryError(`issue sync update failed: ${error.message}`, { cause: error })
        if (!data || data.length === 0) {
            throw new RepositoryError(
                `issue ${issueId} matched no rows — it is not in the database this request is bound to ` +
                    `(wrong region, or the issue was deleted)`,
            )
        }
    }

    async insertImportedIssue(row: ImportedIssueInsert): Promise<boolean> {
        const { error } = await this.svc.from("issues").insert(row)
        return !error
    }

    // ── control plane: issue_suggestions (realtime) ──────────────────────────

    async countSuggestions(issueId: string): Promise<number> {
        const { count } = await this.controlDb
            .from("issue_suggestions")
            .select("id", { count: "exact", head: true })
            .eq("issue_id", issueId)
        return count ?? 0
    }

    async insertSuggestion(row: IssueSuggestionInsert): Promise<void> {
        // Also formerly silent. A dropped suggestion is the analysis result
        // itself: the work ran, was paid for, and the only copy of it vanished
        // with no trace in any log.
        const { error } = await this.controlDb.from("issue_suggestions").insert(row)
        if (error) throw new RepositoryError(`suggestion insert failed: ${error.message}`, { cause: error })
    }

    async upsertComment(projectId: string, comment: IssueCommentUpsert): Promise<void> {
        await this.svc
            .from("issue_comments")
            .upsert({ project_id: projectId, ...comment }, { onConflict: "project_id,github_comment_id" })
    }

    async deleteComment(projectId: string, commentId: number): Promise<void> {
        await this.svc.from("issue_comments").delete().eq("project_id", projectId).eq("github_comment_id", commentId)
    }
}

/** Composition seam: an IssueSyncStore bound to service-role clients. Call from a
 *  composition root (fire-and-forget / webhook contexts that bypass RLS).
 *
 *  Both planes are the same client today. Splitting them means resolving the
 *  project's region here and passing that region's service client as `dataDb`,
 *  leaving the control client pointed at the central database. */
export function createServiceIssueSyncStore(dataDb?: SupabaseRlsClient): IssueSyncStore {
    const svc = Supabase.service()
    return new ServiceIssueSyncStore(dataDb ?? svc, svc)
}
