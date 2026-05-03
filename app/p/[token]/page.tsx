import { notFound } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"
import type { Project, ProjectPublicSession } from "@/lib/supabase/types"
import { PublicIssueForm } from "@/components/public-issue-form"

export const dynamic = "force-dynamic"

// Public issue submission page. Anyone with the link can file an issue
// against the linked project — no login required. Reads use the
// service role (the table has owner-only RLS) so we never expose the
// project list or other tokens. Layout is mobile-first; the form
// owns the busy/skeleton/success states.
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
            <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-4 py-10 sm:px-6">
                <div className="anim-rise rounded-[14px] border border-[color:var(--c-border)] bg-white p-6 text-center shadow-sm sm:p-8">
                    <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-zinc-100 text-zinc-600">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                            <rect x="6" y="5" width="4" height="14" rx="1" />
                            <rect x="14" y="5" width="4" height="14" rx="1" />
                        </svg>
                    </div>
                    <h1 className="mt-3 text-[18px] font-bold sm:text-[20px]">Submissions paused</h1>
                    <p className="mt-2 text-[13px] text-[color:var(--c-text-muted)]">
                        This public submission link has been disabled by the project owner. Check back later or reach out to them directly.
                    </p>
                </div>
            </main>
        )
    }

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:gap-6 sm:px-6 sm:py-12">
            <header className="anim-fade">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                    <span className="grid h-5 w-5 place-items-center rounded-md bg-zinc-900 text-white">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                            <circle cx="12" cy="12" r="9" />
                        </svg>
                    </span>
                    <span className="truncate">{project.name}</span>
                </div>
                <h1 className="mt-2 text-[22px] font-bold leading-tight tracking-[-0.012em] sm:text-[28px]">
                    {session.title || "Report an issue"}
                </h1>
                {session.description && (
                    <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[color:var(--c-text-muted)] sm:text-[14px]">
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
