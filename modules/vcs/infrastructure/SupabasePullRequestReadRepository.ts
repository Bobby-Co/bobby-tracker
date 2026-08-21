// VCS infrastructure — the Supabase adapter for PullRequestReadRepository. The
// RLS-scoped read side of the PR mirror; bound to the caller's client so an
// unowned project/PR is simply not found.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { PrComment, PrFinding, PullRequest, PullRequestAnalysis, ReviewRunProfile } from "@/lib/shared/types"
import type { CommentOwnership, PullRequestReadRepository, PullRequestRound } from "../ports/PullRequestReadRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabasePullRequestReadRepository implements PullRequestReadRepository {
    constructor(private readonly db: AnyDb) {}

    async listForProject(projectId: string): Promise<PullRequest[]> {
        const { data, error } = await this.db
            .from("pull_requests")
            .select("*")
            .eq("project_id", projectId)
            .order("gh_updated_at", { ascending: false, nullsFirst: false })
            .limit(500)
            .returns<PullRequest[]>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? []
    }

    async listAnalysisStatuses(projectId: string): Promise<Pick<PullRequestAnalysis, "pr_number" | "status">[]> {
        const { data, error } = await this.db
            .from("pull_request_analyses")
            .select("pr_number,status")
            .eq("project_id", projectId)
            .returns<Pick<PullRequestAnalysis, "pr_number" | "status">[]>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? []
    }

    async listAnalysisRounds(projectId: string, prNumber: number, limit: number): Promise<PullRequestRound[]> {
        const { data, error } = await this.db
            .from("pull_request_analysis_rounds")
            .select("head_sha,round,verdict,findings,degraded,review_profile,created_at")
            .eq("project_id", projectId)
            .eq("pr_number", prNumber)
            .order("round", { ascending: false })
            .limit(limit)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data ?? []).map((r: RoundRow) => ({
            headSha: r.head_sha,
            round: r.round,
            verdict: r.verdict,
            findings: (r.findings ?? []) as PrFinding[],
            degraded: r.degraded === true,
            reviewProfile: r.review_profile ?? null,
            createdAt: r.created_at,
        }))
    }

    async findByNumber(projectId: string, prNumber: number): Promise<PullRequest | null> {
        const { data, error } = await this.db
            .from("pull_requests")
            .select("*")
            .eq("project_id", projectId)
            .eq("pr_number", prNumber)
            .maybeSingle<PullRequest>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? null
    }

    async findAnalysis(projectId: string, prNumber: number): Promise<PullRequestAnalysis | null> {
        const { data, error } = await this.db
            .from("pull_request_analyses")
            .select("*")
            .eq("project_id", projectId)
            .eq("pr_number", prNumber)
            .maybeSingle<PullRequestAnalysis>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? null
    }

    async findAnalysisStatus(projectId: string, prNumber: number): Promise<PullRequestAnalysis["status"] | null> {
        const { data, error } = await this.db
            .from("pull_request_analyses")
            .select("status")
            .eq("project_id", projectId)
            .eq("pr_number", prNumber)
            .maybeSingle<Pick<PullRequestAnalysis, "status">>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data?.status ?? null
    }

    async listComments(projectId: string, prNumber: number): Promise<PrComment[]> {
        const { data, error } = await this.db
            .from("pr_comments")
            .select("*")
            .eq("project_id", projectId)
            .eq("pr_number", prNumber)
            .order("gh_created_at", { ascending: true, nullsFirst: true })
            .returns<PrComment[]>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? []
    }

    async findCommentOwnership(projectId: string, githubCommentId: number): Promise<CommentOwnership | null> {
        // Fail-safe (null on error), matching loadOwned's ignored-error read.
        const { data } = await this.db
            .from("pr_comments")
            .select("provenance,author_user_id,pr_number")
            .eq("project_id", projectId)
            .eq("github_comment_id", githubCommentId)
            .maybeSingle<CommentOwnership>()
        return data ?? null
    }
}

/** Composition seam: bind a PullRequestReadRepository to a specific client. */
export function createSupabasePullRequestReadRepository(db: AnyDb): PullRequestReadRepository {
    return new SupabasePullRequestReadRepository(db)
}

interface RoundRow {
    head_sha: string
    round: number
    verdict: string | null
    findings: unknown
    degraded: boolean
    review_profile: ReviewRunProfile | null
    created_at: string
}
