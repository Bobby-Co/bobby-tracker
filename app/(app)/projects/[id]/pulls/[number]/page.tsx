"use client"

import Link from "next/link"
import { notFound, useParams } from "next/navigation"
import { useApi } from "@/lib/client/hooks/use-api"
import { useAuth } from "@/lib/client/auth/auth-context"
import { PrDetail } from "@/components/pulls/pr-detail"
import { PrMergeBar } from "@/components/pulls/pr-merge-bar"
import { PrReview } from "@/components/pulls/pr-review"
import { PrComments } from "@/components/pulls/pr-comments"
import type { PrComment, Project, PullRequest, PullRequestAnalysis } from "@/lib/shared/types"
import type { RoundSummary } from "@/components/pulls/pr-review"
import type { RoundDelta } from "@/modules/analysis/domain/ReviewRounds"
import type { PullRequestRound } from "@/modules/vcs/ports/PullRequestReadRepository"
import { findingState } from "@/lib/shared/rendering/finding-state"

interface PullView {
    pull: PullRequest | null
    project: Pick<Project, "id" | "name" | "repo_url" | "repo_full_name"> | null
    analysis: PullRequestAnalysis | null
    comments: PrComment[]
    /** Completed reviews of earlier heads, OLDEST first (0080). */
    rounds?: PullRequestRound[]
    /** How the current review compares with the round before it, computed
     *  server-side so the panel and the merge bar cannot disagree. */
    delta?: RoundDelta | null
}

export default function PullDetailPage() {
    const { id, number } = useParams<{ id: string; number: string }>()
    const { user } = useAuth()
    const { data, loading, error, refetch } = useApi<PullView>(`/api/projects/${id}/pulls/${number}`)

    const pull = data?.pull ?? null
    if (!loading && data && !pull) notFound()

    // Each round, as the strip and the round selector read it. The stored
    // SNAPSHOT is passed through whole — that is what lets selecting round 2
    // render round 2's answer rather than one rebuilt from a chain of diffs.
    //
    // The two counts are derived here rather than stored, with the SAME
    // normaliser the panel groups findings by, so a round summary can never
    // disagree with the findings underneath it.
    const rounds: RoundSummary[] = (data?.rounds ?? []).map((r) => ({
        headSha: r.headSha,
        round: r.round,
        verdict: r.verdict,
        score: r.score,
        scoreMax: r.scoreMax,
        findings: r.findings,
        degraded: r.degraded,
        scope: r.scope,
        scopeReason: r.scopeReason,
        commits: r.commits ?? [],
        carriedCount: r.carriedCount ?? 0,
        resolved: r.resolved ?? [],
        createdAt: r.createdAt,
        blockers: r.findings.filter((f) => findingState(f.severity) === "critical").length,
        // What this round closed, from its own record. A round that predates the
        // resolved column reports zero, which reads as "we did not track it"
        // rather than as "nothing was fixed" — the strip simply omits the chip.
        fixed: (r.resolved ?? []).length,
    }))
    const delta = data?.delta ?? null

    if (error) {
        return (
            <div className="flex flex-col gap-4 px-4">
                <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800">{error}</div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4 px-4">
            <Link href={`/projects/${id}/pulls`} className="text-xs text-[color:var(--c-text-muted)] hover:underline">
                ← Pull requests
            </Link>

            {pull ? (
                <>
                    <PrDetail pr={pull} reviewStatus={data?.analysis?.status ?? null} />
                    <PrMergeBar
                        projectId={id}
                        pull={pull}
                        analysis={data?.analysis ?? null}
                        progress={delta ? { fixed: delta.counts.fixed } : undefined}
                        onMerged={refetch}
                    />
                    <div id="pr-review" className="scroll-mt-20">
                        <PrReview analysis={data?.analysis ?? null} rounds={rounds} delta={delta} />
                    </div>
                    <PrComments
                        comments={data?.comments ?? []}
                        projectId={id}
                        prNumber={pull.pr_number}
                        currentUserId={user?.id ?? null}
                        onChanged={refetch}
                    />
                </>
            ) : (
                <>
                    <div className="skeleton h-40 w-full rounded-[16px]" />
                    <div className="skeleton h-48 w-full rounded-[16px]" />
                </>
            )}
        </div>
    )
}
