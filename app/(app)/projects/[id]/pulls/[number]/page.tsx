"use client"

import Link from "next/link"
import { notFound, useParams } from "next/navigation"
import { useApi } from "@/lib/hooks/use-api"
import { PrDetail } from "@/components/pulls/pr-detail"
import { PrReview } from "@/components/pulls/pr-review"
import { PrComments } from "@/components/pulls/pr-comments"
import type { PRComment, Project, PullRequest, PullRequestAnalysis } from "@/lib/supabase/types"

interface PullView {
    pull: PullRequest | null
    project: Pick<Project, "id" | "name" | "repo_url" | "repo_full_name"> | null
    analysis: PullRequestAnalysis | null
    comments: PRComment[]
}

export default function PullDetailPage() {
    const { id, number } = useParams<{ id: string; number: string }>()
    const { data, loading, error } = useApi<PullView>(`/api/projects/${id}/pulls/${number}`)

    const pull = data?.pull ?? null
    if (!loading && data && !pull) notFound()

    if (error) {
        return (
            <div className="flex flex-col gap-4 px-4">
                <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800">{error}</div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4 px-4">
            <Link href={`/projects/${id}/pulls`} className="text-xs text-zinc-500 hover:underline">
                ← Pull requests
            </Link>

            {pull ? (
                <>
                    <PrDetail pr={pull} reviewStatus={data?.analysis?.status ?? null} />
                    <PrReview analysis={data?.analysis ?? null} />
                    <PrComments comments={data?.comments ?? []} />
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
