// Analysis infrastructure — the Supabase adapter for PullRequestAnalysisStore.
// The ONLY place that touches the pull_request_analyses table. Always bound to
// the service-role client (the analyser callback + webhook contexts have no
// signed-in user). Swapping persistence means replacing this file.

import type { SupabaseClient } from "@supabase/supabase-js"
import { Supabase, type SupabaseRlsClient } from "@/lib/server/supabase"
import type { PrAnalysis, PrFinding, ReviewRunProfile } from "@/lib/shared/types"
import type {
    PullRequestAnalysisResultRow,
    PullRequestAnalysisStore,
    PullRequestAnalysisTracking,
    PullRequestAnalysisUpsert,
    ReviewRound,
    ReviewRoundInsert,
} from "../ports/PullRequestAnalysisStore"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabasePullRequestAnalysisStore implements PullRequestAnalysisStore {
    constructor(private readonly db: AnyDb) {}

    async findTracking(projectId: string, prNumber: number): Promise<PullRequestAnalysisTracking | null> {
        const { data } = await this.db
            .from("pull_request_analyses")
            .select("id,status,github_comment_id,head_sha,pending_head_sha")
            .eq("project_id", projectId)
            .eq("pr_number", prNumber)
            .maybeSingle<{
                id: string
                status: string | null
                github_comment_id: number | null
                head_sha: string | null
                pending_head_sha: string | null
            }>()
        if (!data) return null
        return {
            id: data.id,
            status: data.status,
            githubCommentId: data.github_comment_id,
            headSha: data.head_sha,
            pendingHeadSha: data.pending_head_sha ?? null,
        }
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
            .select("id,project_id,pr_number,github_comment_id,review_profile,head_sha,pending_head_sha")
            .eq("id", taskId)
            .maybeSingle<{
                id: string
                project_id: string
                pr_number: number
                github_comment_id: number | null
                review_profile: ReviewRunProfile | null
                head_sha: string | null
                pending_head_sha: string | null
            }>()
        if (!data) return null
        return {
            id: data.id,
            projectId: data.project_id,
            prNumber: data.pr_number,
            githubCommentId: data.github_comment_id,
            reviewProfile: data.review_profile ?? null,
            headSha: data.head_sha,
            pendingHeadSha: data.pending_head_sha ?? null,
        }
    }

    async saveResult(taskId: string, status: string, result: PrAnalysis | null): Promise<void> {
        // This UPDATE also fires the 'pr_analysis_ready' feed notification (trigger
        // in migration 0049) → review email via notifications.
        await this.db.from("pull_request_analyses").update({ status, result: result ?? null }).eq("id", taskId)
    }

    // ── rounds (0080) ───────────────────────────────────────────────────────

    async appendRound(input: ReviewRoundInsert): Promise<void> {
        // The ordinal is derived here, under the unique (project, pr, round)
        // constraint, so two callbacks racing produce one insert and one
        // conflict rather than two rounds numbered the same.
        const { data: last } = await this.db
            .from("pull_request_analysis_rounds")
            .select("round")
            .eq("project_id", input.projectId)
            .eq("pr_number", input.prNumber)
            .order("round", { ascending: false })
            .limit(1)
            .maybeSingle<{ round: number }>()

        await this.db.from("pull_request_analysis_rounds").insert({
            project_id: input.projectId,
            pr_number: input.prNumber,
            head_sha: input.headSha,
            round: (last?.round ?? 0) + 1,
            status: input.status,
            verdict: input.result?.verdict ?? null,
            score: input.result?.score ?? null,
            score_max: input.result?.score_max ?? null,
            findings: input.result?.findings ?? [],
            degraded: input.result?.degraded === true,
            review_profile: input.reviewProfile,
            analyser_build: input.result?.analyser_build ?? null,
        })
    }

    async listRounds(projectId: string, prNumber: number, limit: number): Promise<ReviewRound[]> {
        const { data } = await this.db
            .from("pull_request_analysis_rounds")
            .select("head_sha,round,status,verdict,score,score_max,findings,degraded,review_profile,analyser_build,created_at")
            .eq("project_id", projectId)
            .eq("pr_number", prNumber)
            .order("round", { ascending: false })
            .limit(limit)
        return (data ?? []).map((r: RoundRow) => ({
            headSha: r.head_sha,
            round: r.round,
            status: r.status,
            verdict: r.verdict,
            score: r.score,
            scoreMax: r.score_max,
            findings: (r.findings ?? []) as PrFinding[],
            degraded: r.degraded === true,
            reviewProfile: r.review_profile ?? null,
            analyserBuild: r.analyser_build ?? null,
            createdAt: r.created_at,
        }))
    }

    async setPendingHead(projectId: string, prNumber: number, headSha: string): Promise<void> {
        await this.db
            .from("pull_request_analyses")
            .update({ pending_head_sha: headSha })
            .eq("project_id", projectId)
            .eq("pr_number", prNumber)
    }

    async clearPendingHead(projectId: string, prNumber: number): Promise<void> {
        await this.db
            .from("pull_request_analyses")
            .update({ pending_head_sha: null })
            .eq("project_id", projectId)
            .eq("pr_number", prNumber)
    }
}

interface RoundRow {
    head_sha: string
    round: number
    status: string
    verdict: string | null
    score: number | null
    score_max: number | null
    findings: unknown
    degraded: boolean
    review_profile: ReviewRunProfile | null
    analyser_build: string | null
    created_at: string
}

/** Composition seam: bind the store to the SERVICE-ROLE client. pull_request_analyses
 *  is REGIONAL — pass the project's data client where the project is known. */
export function createServicePullRequestAnalysisStore(dataDb?: SupabaseRlsClient): PullRequestAnalysisStore {
    return new SupabasePullRequestAnalysisStore(dataDb ?? Supabase.service())
}
