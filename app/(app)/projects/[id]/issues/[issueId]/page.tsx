"use client"

import { notFound, useParams } from "next/navigation"
import Link from "next/link"
import { useApi } from "@/lib/hooks/use-api"
import { IssueDetail } from "@/components/issue-detail"
import { IssueSuggestions } from "@/components/issue-suggestions"
import { SimilarIssuesCard } from "@/components/similar-issues-card"
import type {
    Issue,
    IssueSuggestion,
    Project,
    ProjectAnalyser,
    ProjectLabelIcon,
    ProjectStatusColor,
} from "@/lib/supabase/types"

interface IssueView {
    issue: Issue | null
    project: Project | null
    analyser: ProjectAnalyser | null
    suggestion: IssueSuggestion | null
    peekOthers: Issue[]
    labelIcons: ProjectLabelIcon[]
    statusColors: ProjectStatusColor[]
}

export default function IssueDetailPage() {
    const { id, issueId } = useParams<{ id: string; issueId: string }>()

    // One consolidated fetch instead of 7 parallel ones — the route
    // handler does the Promise.all server-side (1 Worker invocation).
    const { data, loading, error } = useApi<IssueView>(
        `/api/projects/${id}/issues/${issueId}`,
    )

    const issue = data?.issue ?? null
    const project = data?.project ?? null
    // Only 404 once the fetch resolved without the issue — never while
    // it's still loading.
    if (!loading && data && (!issue || !project)) notFound()

    if (error) {
        return (
            <div className="flex flex-col gap-4 px-4">
                <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800">
                    {error}
                </div>
            </div>
        )
    }

    const analyser = data?.analyser ?? null
    const peekOthers = data?.peekOthers ?? []
    const labelIcons = data?.labelIcons ?? []
    const statusColors = data?.statusColors ?? []
    const suggestion = data?.suggestion ?? null
    const ready = !!analyser?.enabled && analyser?.status === "ready" && !!analyser?.graph_id

    return (
        <div className="flex flex-col gap-4 px-4">
            <Link href={`/projects/${id}/issues`} className="text-xs text-zinc-500 hover:underline">
                ← Issues
            </Link>

            {issue && project ? (
                <IssueDetail
                    issue={issue}
                    projectId={id}
                    peekOthers={peekOthers}
                    labelIcons={labelIcons}
                    statusColors={statusColors}
                />
            ) : (
                <div className="skeleton h-64 w-full rounded-[16px]" />
            )}

            {/* Kick the similarity check off immediately from the URL id
                so it's visibly running while the issue body is still
                loading. Keyed + kept in a fixed position so it stays
                mounted across the skeleton→content swap and its polling
                isn't restarted. */}
            <SimilarIssuesCard
                key="similar"
                issueId={issueId}
                variant="auth"
                projectId={id}
                duplicateOfIssueId={issue?.duplicate_of_issue_id ?? null}
            />

            {issue && project ? (
                <IssueSuggestions
                    issueId={issue.id}
                    projectId={id}
                    repo={project}
                    indexedSha={analyser?.last_indexed_sha ?? null}
                    initial={suggestion}
                    analyserReady={ready}
                    issueEffort={issue.analyse_effort ?? null}
                />
            ) : (
                <div className="skeleton h-40 w-full rounded-[16px]" />
            )}
        </div>
    )
}
