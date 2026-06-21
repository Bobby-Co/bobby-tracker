"use client"

import Link from "next/link"
import { useApi } from "@/lib/hooks/use-api"
import type { Project, ProjectGroup } from "@/lib/supabase/types"
import { NewGroupButton } from "@/components/new-group-button"
import { GroupsListSkeleton } from "@/components/groups-list-skeleton"
import { MiniCard, toneFromString } from "@/components/field-card"

type GroupWithMembers = ProjectGroup & { member_count: number; member_names: string[] }

// Top-level "Groups" list. A group is a user-defined collection of
// related projects so the AI compose flow can route an inbound issue
// to the right project (or fan it across several) inside a multi-repo
// product. From here owners create groups and drill into one to manage
// members + compose group-aware issues.
export default function GroupsPage() {
    const groupsQ = useApi<{ groups: GroupWithMembers[] }>("/api/groups")
    const projectsQ = useApi<{ projects: Project[] }>("/api/projects")

    if (groupsQ.loading) return <GroupsListSkeleton />

    const groups = groupsQ.data?.groups ?? []
    const allProjects = (projectsQ.data?.projects ?? []).map((p) => ({ id: p.id, name: p.name }))

    return (
        <div className="w-full px-5 py-6 sm:px-7 sm:py-7">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-[22px] font-bold tracking-[-0.012em]">Groups</h1>
                    <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                        Collections of related projects. AI compose inside a group routes the issue to the project that matches best — modules, overview, features, and stack are all weighed.
                    </p>
                </div>
                <NewGroupButton projects={allProjects} />
            </header>

            {groupsQ.error && (
                <div className="mt-6 rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800">
                    {groupsQ.error}
                </div>
            )}

            {groups.length === 0 ? (
                <div className="mt-8 rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white p-8 text-center text-[13px] text-[color:var(--c-text-muted)]">
                    <div className="text-[14px] font-bold text-[color:var(--c-text)]">No groups yet</div>
                    <p className="mt-1">Create one and pick a few related projects — the AI router needs at least two indexed projects to be useful.</p>
                </div>
            ) : (
                <ul
                    className="mt-6 grid gap-3"
                    style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}
                >
                    {groups.map((g) => {
                        const names = g.member_names ?? []
                        return (
                            <li key={g.id}>
                                <Link href={`/groups/${g.id}`} prefetch={false} className="block">
                                    <MiniCard
                                        tone={toneFromString(g.name)}
                                        icon={<FolderIcon />}
                                        title={g.name}
                                        subtitle={`${names.length} project${names.length === 1 ? "" : "s"}`}
                                    >
                                        {g.description && (
                                            <p className="line-clamp-2 text-[12.5px] leading-5 text-[color:var(--c-text-muted)]">
                                                {g.description}
                                            </p>
                                        )}
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {names.length === 0 ? (
                                                <span className="text-[11.5px] text-[color:var(--c-text-dim)]">
                                                    No projects yet
                                                </span>
                                            ) : (
                                                names.slice(0, 4).map((n) => (
                                                    <span key={n} className="chip-min max-w-[140px] truncate">
                                                        {n}
                                                    </span>
                                                ))
                                            )}
                                            {names.length > 4 && (
                                                <span className="text-[11px] text-[color:var(--c-text-dim)]">
                                                    +{names.length - 4}
                                                </span>
                                            )}
                                        </div>
                                    </MiniCard>
                                </Link>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}

function FolderIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
    )
}
