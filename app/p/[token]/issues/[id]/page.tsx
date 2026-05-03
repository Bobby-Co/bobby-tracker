import { notFound } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"
import type { IssueSuggestion, Project, ProjectAnalyser } from "@/lib/supabase/types"
import { fetchPublicIssue, resolvePublicSession } from "@/lib/public-session"
import { PublicIssueView } from "@/components/public-issue-view"

export const dynamic = "force-dynamic"

// Per-issue detail page for the public submission flow. Server-side
// resolution mirrors the GET /api/public-issues/[id] gate (token →
// project, public-session label) so an attacker can't fish around for
// other issue IDs.
export default async function PublicIssueDetail({
    params,
}: {
    params: Promise<{ token: string; id: string }>
}) {
    const { token, id } = await params
    const svc = createServiceClient()

    const sess = await resolvePublicSession(svc, token, { requireOpen: false })
    if (sess.error) notFound()

    const found = await fetchPublicIssue(svc, id, sess.session.project_id)
    if (found.error) notFound()
    const issue = found.issue

    const { data: project } = await svc
        .from("projects")
        .select("id,name")
        .eq("id", issue.project_id)
        .maybeSingle<Pick<Project, "id" | "name">>()

    const { data: suggestion } = await svc
        .from("issue_suggestions")
        .select("*")
        .eq("issue_id", issue.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<IssueSuggestion>()

    const { data: analyser } = await svc
        .from("project_analyser")
        .select("enabled,status,graph_id,last_indexed_sha")
        .eq("project_id", issue.project_id)
        .maybeSingle<Pick<ProjectAnalyser, "enabled" | "status" | "graph_id" | "last_indexed_sha">>()
    const analyserReady =
        !!analyser?.enabled && analyser.status === "ready" && !!analyser.graph_id

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:gap-6 sm:px-6 sm:py-12">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                {project?.name ?? "Project"}
            </div>
            <PublicIssueView
                token={token}
                issue={{
                    id: issue.id,
                    issue_number: issue.issue_number,
                    title: issue.title,
                    body: issue.body,
                    status: issue.status,
                    priority: issue.priority,
                    labels: issue.labels,
                    created_at: issue.created_at,
                    updated_at: issue.updated_at,
                }}
                initialSuggestion={suggestion ?? null}
                analyser={{
                    ready: analyserReady,
                    status: analyser?.status ?? "disabled",
                    indexed_sha: analyser?.last_indexed_sha ?? null,
                }}
            />
            <footer className="text-center text-[11px] text-[color:var(--c-text-dim)]">
                Bobby Tracker · public submission
            </footer>
        </main>
    )
}
