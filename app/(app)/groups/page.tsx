import { Suspense } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import type { ProjectGroup } from "@/lib/supabase/types"
import { NewGroupButton } from "@/components/new-group-button"
import { GroupsListSkeleton } from "@/components/groups-list-skeleton"

export const dynamic = "force-dynamic"

// Top-level "Groups" list. A group is a user-defined collection of
// related projects so the AI compose flow can route an inbound issue
// to the right project (or fan it across several) inside a multi-
// repo product. From here owners create groups and drill into one
// to manage members + compose group-aware issues.
//
// Sync shell wraps a streaming <Suspense> boundary so soft sidebar
// clicks paint the skeleton instantly instead of stalling on the
// Supabase round-trips.
export default function GroupsPage() {
    return (
        <Suspense fallback={<GroupsListSkeleton />}>
            <GroupsContent />
        </Suspense>
    )
}

async function GroupsContent() {
    const supabase = await createClient()

    const { data: groups } = await supabase
        .from("project_groups")
        .select("*")
        .order("updated_at", { ascending: false })
        .returns<ProjectGroup[]>()

    // Eligible projects for picker = anything the user owns. Members
    // get RLS-filtered automatically.
    const { data: projects } = await supabase
        .from("projects")
        .select("id,name")
        .order("name", { ascending: true })
    const allProjects = (projects ?? []).map((p) => ({ id: p.id, name: p.name }))

    // Member counts per group, grouped client-side from one round-trip.
    const groupIds = (groups ?? []).map((g) => g.id)
    const { data: links } = groupIds.length
        ? await supabase
            .from("project_group_members")
            .select("group_id,project_id,projects(name)")
            .in("group_id", groupIds)
        : { data: [] as { group_id: string; project_id: string; projects: { name: string } | { name: string }[] | null }[] }

    const namesByGroup = new Map<string, string[]>()
    for (const l of links ?? []) {
        const proj = Array.isArray(l.projects) ? l.projects[0] : l.projects
        const name = proj && typeof proj === "object" && "name" in proj ? proj.name : ""
        if (!name) continue
        const list = namesByGroup.get(l.group_id) ?? []
        list.push(name)
        namesByGroup.set(l.group_id, list)
    }

    return (
        <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-[22px] font-bold tracking-[-0.012em]">Groups</h1>
                    <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                        Collections of related projects. AI compose inside a group routes the issue to the project that matches best — modules, overview, features, and stack are all weighed.
                    </p>
                </div>
                <NewGroupButton projects={allProjects} />
            </header>

            {(groups?.length ?? 0) === 0 ? (
                <div className="mt-8 rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white p-8 text-center text-[13px] text-[color:var(--c-text-muted)]">
                    <div className="text-[14px] font-bold text-[color:var(--c-text)]">No groups yet</div>
                    <p className="mt-1">Create one and pick a few related projects — the AI router needs at least two indexed projects to be useful.</p>
                </div>
            ) : (
                <ul className="mt-6 flex flex-col gap-3">
                    {(groups ?? []).map((g) => {
                        const names = namesByGroup.get(g.id) ?? []
                        return (
                            <li key={g.id}>
                                <Link
                                    href={`/groups/${g.id}`}
                                    className="block rounded-[14px] border border-[color:var(--c-border)] bg-white p-4 transition-colors hover:border-[color:var(--c-border-strong)]"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="truncate text-[15px] font-bold">{g.name}</div>
                                            {g.description && (
                                                <p className="mt-1 line-clamp-2 text-[12.5px] text-[color:var(--c-text-muted)]">
                                                    {g.description}
                                                </p>
                                            )}
                                        </div>
                                        <span className="text-[11.5px] tabular-nums text-[color:var(--c-text-muted)]">
                                            {names.length} project{names.length === 1 ? "" : "s"}
                                        </span>
                                    </div>
                                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                                        {names.length === 0 ? (
                                            <span className="text-[color:var(--c-text-dim)]">No projects yet</span>
                                        ) : (
                                            names.map((n) => (
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
