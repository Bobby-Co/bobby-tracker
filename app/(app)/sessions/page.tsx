import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import type { PublicSession } from "@/lib/supabase/types"
import { NewSessionButton } from "@/components/new-session-button"

export const dynamic = "force-dynamic"

// Top-level "Public sessions" list. A session is a shareable submission
// link that can cover one or more of the user's projects. From here
// owners create sessions and drill into one to manage it.
export default async function SessionsPage() {
    const supabase = await createClient()

    // Tolerate the table being absent (migration 0009 not yet applied)
    // — better to render a hint than 500 the page.
    const { data: sessions, error: sessErr } = await supabase
        .from("public_sessions")
        .select("*")
        .order("updated_at", { ascending: false })
        .returns<PublicSession[]>()

    if (sessErr) {
        return (
            <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
                <header>
                    <h1 className="text-[22px] font-bold tracking-[-0.012em]">Public sessions</h1>
                </header>
                <div className="mt-6 rounded-[16px] border border-dashed border-amber-300 bg-amber-50 p-5 text-[13px] text-amber-900">
                    <div className="text-[14px] font-bold">Pending migration</div>
                    <p className="mt-1">
                        Apply <code className="font-mono">supabase/migrations/0009_public_sessions_v2.sql</code> to enable shareable submission links.
                    </p>
                </div>
            </div>
        )
    }

    // Only enabled-integration projects are eligible for new sessions —
    // the inner-join filter via !inner ensures projects without a
    // matching project_public_integration row are excluded.
    const { data: enabledProjects } = await supabase
        .from("projects")
        .select("id,name,project_public_integration!inner(enabled)")
        .eq("project_public_integration.enabled", true)
        .order("name", { ascending: true })
    const projects = ((enabledProjects as unknown as { id: string; name: string }[]) ?? [])
        .map((p) => ({ id: p.id, name: p.name }))

    // Pull project counts per session via the junction. One round-trip;
    // we group client-side in this server component for simplicity.
    const sessionIds = (sessions ?? []).map((s) => s.id)
    const { data: links } = sessionIds.length
        ? await supabase
            .from("public_session_projects")
            .select("session_id,project_id,projects(name)")
            .in("session_id", sessionIds)
        : { data: [] as { session_id: string; project_id: string; projects: { name: string } | { name: string }[] | null }[] }

    const projectsBySession = new Map<string, string[]>()
    for (const link of links ?? []) {
        const proj = Array.isArray(link.projects) ? link.projects[0] : link.projects
        const name = proj && typeof proj === "object" && "name" in proj ? proj.name : ""
        if (!name) continue
        const list = projectsBySession.get(link.session_id) ?? []
        list.push(name)
        projectsBySession.set(link.session_id, list)
    }

    return (
        <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-[22px] font-bold tracking-[-0.012em]">Public sessions</h1>
                    <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                        Shareable submission links. One session can cover multiple projects — submitters pick which one their issue is for.
                    </p>
                </div>
                <NewSessionButton projects={projects ?? []} />
            </header>

            {(sessions?.length ?? 0) === 0 ? (
                <div className="mt-8 rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white p-8 text-center text-[13px] text-[color:var(--c-text-muted)]">
                    <div className="text-[14px] font-bold text-[color:var(--c-text)]">No sessions yet</div>
                    <p className="mt-1">Create one to get a public link you can share.</p>
                </div>
            ) : (
                <ul className="mt-6 flex flex-col gap-3">
                    {(sessions ?? []).map((s) => {
                        const projNames = projectsBySession.get(s.id) ?? []
                        return (
                            <li key={s.id}>
                                <Link
                                    href={`/sessions/${s.id}`}
                                    className="block rounded-[14px] border border-[color:var(--c-border)] bg-white p-4 transition-colors hover:border-[color:var(--c-border-strong)]"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate text-[15px] font-bold">{s.name}</span>
                                                <span
                                                    className={
                                                        s.enabled
                                                            ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-emerald-800"
                                                            : "rounded-full bg-zinc-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-zinc-700"
                                                    }
                                                >
                                                    {s.enabled ? "Live" : "Paused"}
                                                </span>
                                            </div>
                                            {s.description && (
                                                <p className="mt-1 line-clamp-2 text-[12.5px] text-[color:var(--c-text-muted)]">
                                                    {s.description}
                                                </p>
                                            )}
                                        </div>
                                        <span className="text-[11.5px] tabular-nums text-[color:var(--c-text-muted)]">
                                            {s.submission_count} submission{s.submission_count === 1 ? "" : "s"}
                                        </span>
                                    </div>
                                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                                        {projNames.length === 0 ? (
                                            <span className="text-[color:var(--c-text-dim)]">No projects yet</span>
                                        ) : (
                                            projNames.map((n) => (
                                                <span
                                                    key={n}
                                                    className="rounded-full bg-[color:var(--c-surface-2)] px-2 py-0.5 font-semibold text-[color:var(--c-text)]"
                                                >
                                                    {n}
                                                </span>
                                            ))
                                        )}
                                    </div>
                                </Link>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
