import { notFound } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"
import type { Project, ProjectPublicSession } from "@/lib/supabase/types"
import { PublicIssueForm } from "@/components/public-issue-form"

export const dynamic = "force-dynamic"

// Public issue submission page. Anyone with the link can file an issue
// against the linked project — no login required. Reads use the
// service role (the table has owner-only RLS) so we never expose the
// project list or other tokens.
export default async function PublicSessionPage({
    params,
}: {
    params: Promise<{ token: string }>
}) {
    const { token } = await params
    const svc = createServiceClient()

    const { data: session } = await svc
        .from("project_public_sessions")
        .select("project_id,enabled,title,description")
        .eq("token", token)
        .maybeSingle<Pick<ProjectPublicSession, "project_id" | "enabled" | "title" | "description">>()

    if (!session) notFound()

    const { data: project } = await svc
        .from("projects")
        .select("id,name")
        .eq("id", session.project_id)
        .maybeSingle<Pick<Project, "id" | "name">>()
    if (!project) notFound()

    if (!session.enabled) {
        return (
            <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-4 py-10">
                <div className="rounded-[14px] border border-[color:var(--c-border)] bg-white p-6 text-center">
                    <h1 className="text-[18px] font-bold">Submissions paused</h1>
                    <p className="mt-2 text-[13px] text-[color:var(--c-text-muted)]">
                        This public submission link has been disabled by the project owner.
                    </p>
                </div>
            </main>
        )
    }

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-5 px-4 py-10">
            <header>
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                    {project.name}
                </div>
                <h1 className="mt-1 text-[24px] font-bold tracking-[-0.012em]">
                    {session.title || "Report an issue"}
                </h1>
                {session.description && (
                    <p className="mt-2 whitespace-pre-wrap text-[13.5px] text-[color:var(--c-text-muted)]">
                        {session.description}
                    </p>
                )}
            </header>
            <PublicIssueForm token={token} />
            <footer className="text-center text-[11px] text-[color:var(--c-text-dim)]">
                Bobby Tracker · public submission
            </footer>
        </main>
    )
}
