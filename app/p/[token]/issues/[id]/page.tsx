import { Suspense } from "react"
import { notFound } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"
import type { IssueSuggestion, Project, ProjectAnalyser, PublicIssueReporter } from "@/lib/supabase/types"
import { checkInviteAccess, fetchPublicIssue, resolvePublicSession } from "@/lib/public-session"
import { PublicIssueView } from "@/components/public-issue-view"
import { PublicIssueDetailSkeleton } from "@/components/public-issue-detail-skeleton"
import { PublicSessionGate } from "@/components/public-session-gate"

export const dynamic = "force-dynamic"

// Per-issue detail page for the public submission flow. Wraps the
// data-fetch in a Suspense boundary so the skeleton renders the
// instant the user lands here on a soft navigation (clicked from
// the history list, etc.) — never blocked by the round-trip.
export default function PublicIssueDetail({
    params,
}: {
    params: Promise<{ token: string; id: string }>
}) {
    return (
        <Suspense fallback={<PublicIssueDetailSkeleton />}>
            <PublicIssueDetailContent params={params} />
        </Suspense>
    )
}

async function PublicIssueDetailContent({
    params,
}: {
    params: Promise<{ token: string; id: string }>
}) {
    const { token, id } = await params
    const svc = createServiceClient()

    const sess = await resolvePublicSession(svc, token, { requireOpen: false })
    if (sess.error) notFound()

    if (sess.session.access_mode === "invite") {
        const access = await checkInviteAccess(sess.session)
        if (!access.ok) {
            return (
                <PublicSessionGate
                    reason={access.reason}
                    email={"email" in access ? access.email : null}
                    nextPath={`/p/${token}/issues/${id}`}
                    heading={null}
                />
            )
        }
    }

    const found = await fetchPublicIssue(svc, id, sess.session.project_ids)
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

    const { data: reporter } = await svc
        .from("public_issue_reporters")
        .select("reporter_id,reporter_name")
        .eq("issue_id", issue.id)
        .maybeSingle<Pick<PublicIssueReporter, "reporter_id" | "reporter_name">>()

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
                reporter={{
                    id: reporter?.reporter_id ?? null,
                    name: reporter?.reporter_name ?? null,
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
