"use client"

import Link from "next/link"
import { useApi } from "@/lib/hooks/use-api"
import { NewProjectButton } from "@/components/new-project-button"
import { NewGroupButton } from "@/components/new-group-button"
import { MiniCard, FieldTable, FieldRow, toneFromString } from "@/components/field-card"
import { shortDate, timeAgo } from "@/components/issue-meta"
import type { Project, ProjectGroup } from "@/lib/supabase/types"

type GroupWithCount = ProjectGroup & { member_count: number }

export default function ProjectsPage() {
    const projectsQ = useApi<{ projects: Project[] }>("/api/projects")
    const groupsQ = useApi<{ groups: GroupWithCount[] }>("/api/groups")

    const list = projectsQ.data?.projects ?? []
    const groupList = groupsQ.data?.groups ?? []
    const allProjectsForPicker = list.map((p) => ({ id: p.id, name: p.name }))

    const error = projectsQ.error || groupsQ.error

    return (
        <div className="flex w-full flex-col gap-6 px-5 py-6 sm:px-7 sm:py-7">
            <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                <div className="min-w-0">
                    <h1 className="h-page">Projects</h1>
                    <p className="mt-1 max-w-prose text-[13.5px] text-[color:var(--c-text-muted)]">
                        One project per repository. Issues, integrations, and the analyser knowledge base hang off it.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                    <NewGroupButton projects={allProjectsForPicker} />
                    <NewProjectButton />
                </div>
            </header>

            {error && (
                <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800">
                    {error}
                </div>
            )}

            {/* Groups strip — placed above the projects grid so the
                cross-project surface (AI routing across a multi-repo
                product) is discoverable from the page that owns the
                repos themselves. */}
            <section className="flex flex-col gap-2">
                <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="h-section">Groups</h2>
                        <p className="mt-0.5 text-[12px] text-[color:var(--c-text-muted)]">
                            Bundle related projects so AI compose can route an issue to the best match.
                        </p>
                    </div>
                </div>
                {groupsQ.loading ? (
                    <div className="flex flex-wrap gap-2">
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="skeleton h-9 w-32 rounded-[12px]" />
                        ))}
                    </div>
                ) : groupList.length === 0 ? (
                    <div className="rounded-[12px] border border-dashed border-[color:var(--c-border)] bg-white px-4 py-3 text-[12.5px] text-[color:var(--c-text-muted)]">
                        No groups yet — create one once you have a couple of related projects to bundle.
                    </div>
                ) : (
                    <ul className="flex flex-wrap gap-2">
                        {groupList.map((g) => (
                            <li key={g.id}>
                                <Link
                                    href={`/groups/${g.id}`}
                                    prefetch={false}
                                    className="group inline-flex items-center gap-2 rounded-[12px] border border-[color:var(--c-border)] bg-white px-3 py-2 text-[13px] transition-colors hover:border-[color:var(--c-border-strong)] hover:bg-[color:var(--c-surface-2)]"
                                >
                                    <FolderIcon />
                                    <span className="font-semibold">{g.name}</span>
                                    <span className="rounded-full bg-[color:var(--c-surface-2)] px-1.5 py-0.5 text-[10.5px] font-bold text-[color:var(--c-text-muted)] tabular-nums group-hover:bg-white">
                                        {g.member_count}
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {projectsQ.loading ? (
                <ul
                    className="grid gap-3"
                    style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
                >
                    {[0, 1, 2, 3].map((i) => (
                        <li key={i} className="skeleton h-40 w-full rounded-[16px]" />
                    ))}
                </ul>
            ) : list.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white px-5 py-16 text-center">
                    <div className="mx-auto grid h-10 w-10 place-items-center rounded-[10px] bg-[color:var(--c-surface-2)] text-[color:var(--c-text-dim)]">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <rect x="3" y="3" width="18" height="18" rx="3" />
                            <path d="M3 9h18M9 21V9" />
                        </svg>
                    </div>
                    <p className="mt-3 text-[14px] font-semibold">No projects yet</p>
                    <p className="mt-1 text-[12.5px] text-[color:var(--c-text-muted)]">
                        Create one to start tracking issues against a repo.
                    </p>
                    <div className="mt-4 flex justify-center">
                        <NewProjectButton />
                    </div>
                </div>
            ) : (
                <ul
                    className="grid gap-3 stagger"
                    style={{
                        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                        ["--stagger-step" as string]: "60ms",
                    } as React.CSSProperties}
                >
                    {list.map((p, i) => (
                        <li
                            key={p.id}
                            className="anim-rise"
                            style={{ ["--i" as string]: i } as React.CSSProperties}
                        >
                            <Link href={`/projects/${p.id}/issues`} prefetch={false} className="block">
                                <MiniCard
                                    tone={toneFromString(p.name)}
                                    icon={<RepoIcon />}
                                    iconSolid
                                    title={p.name}
                                    footer={
                                        <span className="ml-auto inline-flex items-center gap-1">
                                            <ClockIcon />
                                            {timeAgo(p.updated_at)}
                                        </span>
                                    }
                                >
                                    <FieldTable>
                                        <FieldRow icon={<RepoMiniIcon />} label="Repo">
                                            <span className="font-mono text-[11.5px]">
                                                {p.repo_full_name ? p.repo_full_name : p.repo_url}
                                            </span>
                                        </FieldRow>
                                        <FieldRow icon={<ClockIcon />} label="Updated">
                                            {shortDate(p.updated_at)}
                                        </FieldRow>
                                    </FieldTable>
                                    {p.description && (
                                        <p className="line-clamp-2 text-[12.5px] leading-5 text-[color:var(--c-text-muted)]">
                                            {p.description}
                                        </p>
                                    )}
                                </MiniCard>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

function RepoIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 4h12a4 4 0 014 4v12H8a4 4 0 01-4-4V4z" />
            <path d="M4 16a4 4 0 014-4h12" />
        </svg>
    )
}
function RepoMiniIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 4h12a4 4 0 014 4v12H8a4 4 0 01-4-4V4z" />
            <path d="M4 16a4 4 0 014-4h12" />
        </svg>
    )
}
function ClockIcon() {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
        </svg>
    )
}
function FolderIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-[color:var(--c-text-dim)]">
            <path d="M3 7h7l1.5 2H21v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
    )
}
