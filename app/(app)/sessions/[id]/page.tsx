import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { Project, PublicSession } from "@/lib/supabase/types"
import { SessionManagePanel } from "@/components/session-manage-panel"

export const dynamic = "force-dynamic"

// Per-session management page. Owners edit the public title/description,
// time window, project membership, and toggle pause/regenerate/delete
// from here. The single "session shape" (one or many projects) lives
// entirely in this view; the project's Integrations tab only links
// back to the sessions covering it.
export default async function SessionDetailPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const supabase = await createClient()

    const { data: session } = await supabase
        .from("public_sessions")
        .select("*")
        .eq("id", id)
        .maybeSingle<PublicSession>()
    if (!session) notFound()

    const { data: links } = await supabase
        .from("public_session_projects")
        .select("project_id,projects(id,name)")
        .eq("session_id", id)
    const sessionProjects = (links ?? [])
        .map((r: { project_id: string; projects: unknown }) => {
            const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects
            const name = (proj && typeof proj === "object" && "name" in proj) ? (proj as { name: string }).name : ""
            return { id: r.project_id, name }
        })
        .filter((p) => p.name)

    const { data: allProjects } = await supabase
        .from("projects")
        .select("id,name")
        .order("name", { ascending: true })
        .returns<Pick<Project, "id" | "name">[]>()

    return (
        <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
            <Link
                href="/sessions"
                className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]"
            >
                ← Sessions
            </Link>
            <h1 className="mt-2 truncate text-[22px] font-bold tracking-[-0.012em]">{session.name}</h1>
            <SessionManagePanel
                session={session}
                sessionProjects={sessionProjects}
                allProjects={allProjects ?? []}
            />
        </div>
    )
}
