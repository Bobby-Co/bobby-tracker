import { notFound } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { IssueDetail } from "@/components/issue-detail"
import { IssueSuggestions } from "@/components/issue-suggestions"
import { SimilarIssuesCard } from "@/components/similar-issues-card"
import type { Issue, IssueSuggestion, Project, ProjectAnalyser } from "@/lib/supabase/types"

export const dynamic = "force-dynamic"

export default async function IssueDetailPage({
    params,
}: {
    params: Promise<{ id: string; issueId: string }>
}) {
    const { id, issueId } = await params
    const supabase = await createClient()

    const [issueRes, projectRes, analyserRes, suggestionRes] = await Promise.all([
        supabase.from("issues")
            .select("*")
            .eq("id", issueId)
            .eq("project_id", id)
            .single<Issue>(),
        supabase.from("projects")
            .select("repo_url,repo_full_name")
            .eq("id", id)
            .single<Pick<Project, "repo_url" | "repo_full_name">>(),
        supabase.from("project_analyser")
            .select("*")
            .eq("project_id", id)
            .maybeSingle<ProjectAnalyser>(),
        supabase.from("issue_suggestions")
            .select("*")
            .eq("issue_id", issueId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle<IssueSuggestion>(),
    ])

    if (!issueRes.data || !projectRes.data) notFound()

    const analyser = analyserRes.data
    const ready = !!analyser?.enabled && analyser?.status === "ready" && !!analyser?.graph_id

    return (
        <div className="flex flex-col gap-4">
            <Link href={`/projects/${id}/issues`} className="text-xs text-zinc-500 hover:underline">
                ← Issues
            </Link>
            <IssueDetail issue={issueRes.data} />
            <SimilarIssuesCard
                issueId={issueRes.data.id}
                variant="auth"
                projectId={id}
                duplicateOfIssueId={issueRes.data.duplicate_of_issue_id}
            />
            <IssueSuggestions
                issueId={issueRes.data.id}
                repo={projectRes.data}
                indexedSha={analyser?.last_indexed_sha ?? null}
                initial={suggestionRes.data ?? null}
                analyserReady={ready}
            />
        </div>
    )
}
