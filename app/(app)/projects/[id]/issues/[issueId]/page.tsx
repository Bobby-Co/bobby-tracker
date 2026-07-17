"use client"

import { notFound, useParams } from "next/navigation"
import Link from "next/link"
import { useApi } from "@/lib/hooks/use-api"
import { useAuth } from "@/lib/auth/auth-context"
import { IssueDetail } from "@/components/issues/issue-detail"
import { IssueSuggestions } from "@/components/issues/issue-suggestions"
import { IssueComments } from "@/components/issues/issue-comments"
import { SimilarIssuesCard } from "@/components/issues/similar-issues-card"
import type {
    Issue,
    IssueComment,
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
    comments: IssueComment[]
}

export default function IssueDetailPage() {
    const { id, issueId } = useParams<{ id: string; issueId: string }>()
    const { user } = useAuth()

    // One consolidated fetch instead of 7 parallel ones — the route
    // handler does the Promise.all server-side (1 Worker invocation).
    const { data, loading, error, refetch } = useApi<IssueView>(
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
                    // Imported GitHub issues don't auto-investigate on open —
                    // the user opts in per issue via the "Investigate" button.
                    autoInvestigate={issue.sync_source !== "github"}
                />
            ) : (
                <div className="skeleton h-40 w-full rounded-[16px]" />
            )}

            {/* GitHub comment thread — only for issues that exist on GitHub. */}
            {issue?.github_issue_number ? (
                <IssueComments
                    comments={data?.comments ?? []}
                    projectId={id}
                    issueId={issueId}
                    currentUserId={user?.id ?? null}
                    onChanged={refetch}
                />
            ) : null}
        </div>
    )
}
