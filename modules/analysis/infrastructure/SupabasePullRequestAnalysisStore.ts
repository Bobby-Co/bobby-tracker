// Analysis infrastructure — the Supabase adapter for PullRequestAnalysisStore.
// The ONLY place that touches the pull_request_analyses table. Always bound to
// the service-role client (the analyser callback + webhook contexts have no
// signed-in user). Swapping persistence means replacing this file.

import type { SupabaseClient } from "@supabase/supabase-js"
import { Supabase, type SupabaseRlsClient } from "@/lib/server/supabase"
import type { PrAnalysis, PrFinding, ReviewRoundCommit, ReviewRunProfile, ReviewRunScope } from "@/lib/shared/types"
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
        const { data, error } = await this.db
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
        if (error) {
            // null here means "this pull request has never been reviewed", and
            // the caller acts on that: the same-head skip stops firing, so every
            // `reopened`/`edited`/`labeled` event re-bills a review; the
            // in-flight guard stops firing, so a push during a review starts a
            // SECOND one instead of coalescing; and the comment id is lost, so
            // each round posts a new comment instead of editing one.
            console.error(
                `[pr-review] could not read the tracking row for project ${projectId} pr ${prNumber} — ` +
                    `this pull request will be treated as never reviewed. Cause: ${error.message}`,
            )
        }
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
        const { data, error } = await this.db
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
                    // The scope decision travels with the run for the same
                    // reason (0081) — and the callback READS it back, so a
                    // re-run must overwrite rather than accumulate.
                    review_scope: input.reviewScope,
                },
                { onConflict: "project_id,pr_number" },
            )
            .select("id")
            .single<{ id: string }>()
        if (error) {
            // The caller returns on null — AFTER the "analysing…" comment is up.
            // So the pull request keeps a spinner nothing ever comes back to
            // edit, and no analyser run is ever started. This is the loudest
            // failure in the file and was the quietest.
            console.error(
                `[pr-review] could not write the tracking row for project ${input.projectId} pr ${input.prNumber} — ` +
                    `NO REVIEW WILL RUN and the loading comment will never be replaced. Cause: ${error.message}`,
            )
        }
        return data ?? null
    }

    async findResultRow(taskId: string): Promise<PullRequestAnalysisResultRow | null> {
        const { data, error } = await this.db
            .from("pull_request_analyses")
            .select("id,project_id,pr_number,github_comment_id,review_profile,review_scope,head_sha,pending_head_sha")
            .eq("id", taskId)
            .maybeSingle<{
                id: string
                project_id: string
                pr_number: number
                github_comment_id: number | null
                review_profile: ReviewRunProfile | null
                review_scope: ReviewRunScope | null
                head_sha: string | null
                pending_head_sha: string | null
            }>()
        if (error) {
            // The callback returns on null, having done nothing: no comment
            // update, no stored result, no round. A review that ran, cost money
            // and finished is discarded on the doorstep, and the pull request
            // still shows "analysing".
            console.error(
                `[pr-review] could not read the tracking row for task ${taskId} — ` +
                    `a COMPLETED review is being dropped. Cause: ${error.message}`,
            )
        }
        if (!data) return null
        return {
            id: data.id,
            projectId: data.project_id,
            prNumber: data.pr_number,
            githubCommentId: data.github_comment_id,
            reviewProfile: data.review_profile ?? null,
            reviewScope: data.review_scope ?? null,
            headSha: data.head_sha,
            pendingHeadSha: data.pending_head_sha ?? null,
        }
    }

    async saveResult(taskId: string, status: string, result: PrAnalysis | null): Promise<void> {
        // This UPDATE also fires the 'pr_analysis_ready' feed notification (trigger
        // in migration 0049) → review email via notifications.
        const { error } = await this.db
            .from("pull_request_analyses")
            .update({ status, result: result ?? null })
            .eq("id", taskId)
        if (error) {
            // The review is gone. The comment on the pull request may already
            // have been edited to show it, so the two surfaces now disagree, and
            // the panel keeps rendering "analysing" forever because the status
            // never moved off it.
            console.error(
                `[pr-review] could not store the ${status} result for task ${taskId} — ` +
                    `the review is LOST and the panel will keep showing "analysing". Cause: ${error.message}`,
            )
        }
    }

    // ── rounds (0080) ───────────────────────────────────────────────────────

    async appendRound(input: ReviewRoundInsert): Promise<void> {
        // The ordinal is derived here, under the unique (project, pr, round)
        // constraint, so two callbacks racing produce one insert and one
        // conflict rather than two rounds numbered the same.
        const { data: last, error: lastErr } = await this.db
            .from("pull_request_analysis_rounds")
            .select("round")
            .eq("project_id", input.projectId)
            .eq("pr_number", input.prNumber)
            .order("round", { ascending: false })
            .limit(1)
            .maybeSingle<{ round: number }>()
        if (lastErr) {
            // Unread, the ordinal restarts at 1 and the unique (project, pr,
            // round) constraint rejects the insert — so the round is lost to a
            // constraint violation rather than to the read that actually failed.
            console.error(
                `[pr-review] could not read the last round number for project ${input.projectId} ` +
                    `pr ${input.prNumber} — the insert below will collide. Cause: ${lastErr.message}`,
            )
        }

        const { error } = await this.db.from("pull_request_analysis_rounds").insert({
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
            // Scope + provenance (0081). A round that cannot say it was scoped
            // records itself as full, which is the only honest default: the
            // reader of this row has to be able to trust that "full" means the
            // reviewer saw everything.
            scope: input.scope ?? "full",
            scope_reason: input.scopeReason ?? null,
            prev_head_sha: input.prevHeadSha ?? null,
            base_sha: input.baseSha ?? null,
            commits: input.commits ?? [],
            carried_count: input.carriedCount ?? 0,
            reviewed_files: input.reviewedFiles ?? null,
            resolved: input.resolved ?? [],
        })
        if (error) {
            // A round that fails to record is not cosmetic. The NEXT round reads
            // this table to find its baseline, so a silent failure here makes
            // every subsequent round look like a first round — permanently full,
            // nothing carried, and no way to tell that from a working pipeline
            // that simply chose full. An unapplied migration looks exactly like
            // correct behaviour. Say so.
            console.error(
                `[pr-review] could not record round ${(last?.round ?? 0) + 1} for project ${input.projectId} ` +
                    `pr ${input.prNumber} — the NEXT round will see no baseline and review everything. ` +
                    `Cause: ${error.message}`,
            )
        }
    }

    async listRounds(projectId: string, prNumber: number, limit: number): Promise<ReviewRound[]> {
        const { data, error } = await this.db
            .from("pull_request_analysis_rounds")
            .select("head_sha,round,status,verdict,score,score_max,findings,degraded,review_profile,analyser_build,created_at,scope,scope_reason,prev_head_sha,base_sha,commits,carried_count,reviewed_files,resolved")
            .eq("project_id", projectId)
            .eq("pr_number", prNumber)
            .order("round", { ascending: false })
            .limit(limit)
        if (error) {
            // Same trap as appendRound, from the read side: an empty list means
            // "first review of this pull request", which is a full review with
            // nothing carried. A query that fails — a column this build selects
            // and the database does not have, most likely — is indistinguishable
            // from that, and produces a pipeline that works exactly as it did
            // before incremental review while reporting no error anywhere.
            console.error(
                `[pr-review] could not read the round history for project ${projectId} pr ${prNumber} — ` +
                    `this round will be treated as the FIRST and will review everything. Cause: ${error.message}`,
            )
        }
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
            scope: r.scope === "incremental" ? "incremental" : "full",
            scopeReason: r.scope_reason ?? null,
            prevHeadSha: r.prev_head_sha ?? null,
            baseSha: r.base_sha ?? null,
            commits: (r.commits ?? []) as ReviewRoundCommit[],
            carriedCount: r.carried_count ?? 0,
            reviewedFiles: r.reviewed_files ?? null,
            resolved: (r.resolved ?? []) as PrFinding[],
        }))
    }

    async setPendingHead(projectId: string, prNumber: number, headSha: string): Promise<void> {
        const { error } = await this.db
            .from("pull_request_analyses")
            .update({ pending_head_sha: headSha })
            .eq("project_id", projectId)
            .eq("pr_number", prNumber)
        if (error) {
            // The push is dropped. The running review finishes describing an
            // older head, the comment describes code no longer in the pull
            // request, the merge gate judges that, and nothing is left to
            // trigger a re-run — the exact hole 0080 was written to close.
            console.error(
                `[pr-review] could not record the pending head ${headSha.slice(0, 7)} for project ${projectId} ` +
                    `pr ${prNumber} — this push will NOT be reviewed. Cause: ${error.message}`,
            )
        }
    }

    async clearPendingHead(projectId: string, prNumber: number): Promise<void> {
        const { error } = await this.db
            .from("pull_request_analyses")
            .update({ pending_head_sha: null })
            .eq("project_id", projectId)
            .eq("pr_number", prNumber)
        if (error) {
            // Left set, the continuation re-triggers on every callback and the
            // pull request reviews itself in a loop.
            console.error(
                `[pr-review] could not clear the pending head for project ${projectId} pr ${prNumber} — ` +
                    `this pull request may re-review in a loop. Cause: ${error.message}`,
            )
        }
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
    scope: string | null
    scope_reason: string | null
    prev_head_sha: string | null
    base_sha: string | null
    commits: unknown
    carried_count: number | null
    reviewed_files: number | null
    resolved: unknown
}

/** Composition seam: bind the store to the SERVICE-ROLE client. pull_request_analyses
 *  is REGIONAL — pass the project's data client where the project is known. */
export function createServicePullRequestAnalysisStore(dataDb?: SupabaseRlsClient): PullRequestAnalysisStore {
    return new SupabasePullRequestAnalysisStore(dataDb ?? Supabase.service())
}
