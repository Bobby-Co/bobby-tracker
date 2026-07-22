// VCS module — the service-role Supabase adapter for PullRequestStore. The only
// place that touches tracker.pull_requests / pr_comments / pull_request_analyses.
// Upserts intentionally omit `undefined` fields (supabase-js drops them and
// PostgREST merge-duplicates only updates the columns it receives).

import { Supabase } from "@/lib/server/supabase"
import type { PRAnalysis } from "@/lib/shared/types"
import type {
    PRCommentSource,
    PRCommentUpsert,
    PRUpsert,
    PullRequestStore,
} from "../ports/PullRequestStore"

/** The service-role Supabase adapter for PullRequestStore. Construct via the
 *  factory below from a composition root (webhook / backfill / detached contexts
 *  that bypass RLS). */
export class SupabasePullRequestStore implements PullRequestStore {
    private readonly svc = Supabase.service()

    async upsertPullRequest(projectId: string, pr: PRUpsert): Promise<void> {
        await this.svc.from("pull_requests").upsert({ project_id: projectId, ...pr }, { onConflict: "project_id,pr_number" })
    }

    async upsertComment(projectId: string, comment: PRCommentUpsert): Promise<void> {
        await this.svc
            .from("pr_comments")
            .upsert({ project_id: projectId, ...comment }, { onConflict: "project_id,source,github_comment_id" })
    }

    async deleteComment(projectId: string, source: PRCommentSource, commentId: number): Promise<void> {
        await this.svc
            .from("pr_comments")
            .delete()
            .eq("project_id", projectId)
            .eq("source", source)
            .eq("github_comment_id", commentId)
    }

    async markMerged(projectId: string, prNumber: number, at: string): Promise<void> {
        // Partial upsert (merge-duplicates only touches the columns sent) so
        // nothing richer gets clobbered.
        await this.svc.from("pull_requests").upsert(
            { project_id: projectId, pr_number: prNumber, state: "closed", merged: true, merged_at: at, closed_at: at },
            { onConflict: "project_id,pr_number" },
        )
    }

    async findAnalysisResult(projectId: string, prNumber: number): Promise<PRAnalysis | null> {
        const { data } = await this.svc
            .from("pull_request_analyses")
            .select("result")
            .eq("project_id", projectId)
            .eq("pr_number", prNumber)
            .maybeSingle<{ result: PRAnalysis | null }>()
        return data?.result ?? null
    }
}

/** Composition seam: hands back the port, bound to a fresh service-role client. */
export function createServicePullRequestStore(): PullRequestStore {
    return new SupabasePullRequestStore()
}
