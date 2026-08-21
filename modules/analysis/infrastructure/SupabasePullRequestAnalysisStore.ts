// Analysis infrastructure — the Supabase adapter for PullRequestAnalysisStore.
// The ONLY place that touches the pull_request_analyses table. Always bound to
// the service-role client (the analyser callback + webhook contexts have no
// signed-in user). Swapping persistence means replacing this file.

import type { SupabaseClient } from "@supabase/supabase-js"
import { Supabase, type SupabaseRlsClient } from "@/lib/server/supabase"
import type { PrAnalysis, ReviewRunProfile } from "@/lib/shared/types"
import type {
    PullRequestAnalysisResultRow,
    PullRequestAnalysisStore,
    PullRequestAnalysisTracking,
    PullRequestAnalysisUpsert,
} from "../ports/PullRequestAnalysisStore"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabasePullRequestAnalysisStore implements PullRequestAnalysisStore {
    constructor(private readonly db: AnyDb) {}

    async findTracking(projectId: string, prNumber: number): Promise<PullRequestAnalysisTracking | null> {
        const { data } = await this.db
            .from("pull_request_analyses")
            .select("id,status,github_comment_id,head_sha")
            .eq("project_id", projectId)
            .eq("pr_number", prNumber)
            .maybeSingle<{ id: string; status: string | null; github_comment_id: number | null; head_sha: string | null }>()
        if (!data) return null
        return { id: data.id, status: data.status, githubCommentId: data.github_comment_id, headSha: data.head_sha }
    }

    async upsertTracking(input: PullRequestAnalysisUpsert): Promise<{ id: string } | null> {
        const { data } = await this.db
            .from("pull_request_analyses")
            .upsert(
                {
                    project_id: input.projectId,
                    pr_number: input.prNumber,
                    github_comment_id: input.githubCommentId,
                    head_sha: input.headSha,
                    status: input.status,
                    // Attribution travels with the run (0079). On a re-run the
                    // upsert overwrites it, which is right: the row describes the
                    // review currently on the PR, and a re-run under a changed
                    // profile is a different review.
                    review_profile_id: input.reviewProfileId,
                    review_profile: input.reviewProfile,
                },
                { onConflict: "project_id,pr_number" },
            )
            .select("id")
            .single<{ id: string }>()
        return data ?? null
    }

    async findResultRow(taskId: string): Promise<PullRequestAnalysisResultRow | null> {
        const { data } = await this.db
            .from("pull_request_analyses")
            .select("id,project_id,pr_number,github_comment_id,review_profile")
            .eq("id", taskId)
            .maybeSingle<{
                id: string
                project_id: string
                pr_number: number
                github_comment_id: number | null
                review_profile: ReviewRunProfile | null
            }>()
        if (!data) return null
        return {
            id: data.id,
            projectId: data.project_id,
            prNumber: data.pr_number,
            githubCommentId: data.github_comment_id,
            reviewProfile: data.review_profile ?? null,
        }
    }

    async saveResult(taskId: string, status: string, result: PrAnalysis | null): Promise<void> {
        // This UPDATE also fires the 'pr_analysis_ready' feed notification (trigger
        // in migration 0049) → review email via notifications.
        await this.db.from("pull_request_analyses").update({ status, result: result ?? null }).eq("id", taskId)
    }
}

/** Composition seam: bind the store to the SERVICE-ROLE client. pull_request_analyses
 *  is REGIONAL — pass the project's data client where the project is known. */
export function createServicePullRequestAnalysisStore(dataDb?: SupabaseRlsClient): PullRequestAnalysisStore {
    return new SupabasePullRequestAnalysisStore(dataDb ?? Supabase.service())
}
