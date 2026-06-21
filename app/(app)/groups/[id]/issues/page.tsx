"use client"

import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { useApi } from "@/lib/hooks/use-api"
import type { Issue } from "@/lib/supabase/types"
import { IssueList, type ParentRow } from "@/components/issue-list"
import { IssueTile } from "@/components/issue-tile"
import { IssueFolderTile } from "@/components/issue-folder-tile"
import { IssuesViewToggle, type IssuesView } from "@/components/issues-view-toggle"
import { GroupAiComposeButton } from "@/components/group-ai-compose-button"
import { GroupNewIssueButton } from "@/components/group-new-issue-button"
import { GroupIssuesSkeleton } from "@/components/group-issues-skeleton"

interface MemberInfo {
    id: string
    name: string
    analyser_ready: boolean
    has_summary: boolean
}

// Group Issues tab — same row/tile UI a single project gets, but
// the list is grouped by project (each member project becomes its
// own subsection with its own header). Default view is List; the
// existing IssuesViewToggle drives the choice via the `view` query
// param like the project page does.
//
// Inside a project section, the duplicate-tree treatment carries
// over: parents render as cards, children indent underneath.
export default function GroupIssuesPage() {
    const { id } = useParams<{ id: string }>()
    const searchParams = useSearchParams()
    const view: IssuesView = searchParams.get("view") === "tile" ? "tile" : "list"

    const { data, error, loading } = useApi<{
        group: { id: string; name: string }
        members: MemberInfo[]
        issues: Issue[]
    }>(`/api/groups/${id}/issues`)

    if (loading) return <GroupIssuesSkeleton />

    if (error || !data) {
        return (
            <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800">
                {error ?? "Group not found."}
            </div>
        )
    }

    const members = data.members
    const allIssues = data.issues

    // Bucket by project, then derive parent/child trees per bucket
    // — same shape the per-project Issues page uses.
    const issuesByProject = new Map<string, Issue[]>()
    for (const it of allIssues) {
        const arr = issuesByProject.get(it.project_id) ?? []
        arr.push(it)
        issuesByProject.set(it.project_id, arr)
    }
    interface ProjectSection {
        member: MemberInfo
        open: ParentRow[]
        closed: ParentRow[]
        tileOpen: Issue[]
        tileClosed: Issue[]
        totalCount: number
    }
    const isClosed = (s: Issue["status"]) =>
        s === "done" || s === "archived" || s === "duplicated"
    const sections: ProjectSection[] = members.map((m) => {
        const list = issuesByProject.get(m.id) ?? []
        const childrenByParent = new Map<string, Issue[]>()
        for (const i of list) {
            if (!i.duplicate_of_issue_id) continue
            const arr = childrenByParent.get(i.duplicate_of_issue_id) ?? []
            arr.push(i)
            childrenByParent.set(i.duplicate_of_issue_id, arr)
        }
        for (const arr of childrenByParent.values()) {
            arr.sort((a, b) => a.created_at.localeCompare(b.created_at))
        }
        const parentsAll: ParentRow[] = list
            .filter((i) => !i.duplicate_of_issue_id)
            .map((parent) => ({ parent, children: childrenByParent.get(parent.id) ?? [] }))
        const open = parentsAll.filter(({ parent }) => !isClosed(parent.status))
        const closed = parentsAll.filter(({ parent }) => isClosed(parent.status))
        const tileIssues = list.filter((i) => !i.duplicate_of_issue_id)
        return {
            member: m,
            open,
            closed,
            tileOpen: tileIssues.filter((i) => !isClosed(i.status)),
            tileClosed: tileIssues.filter((i) => isClosed(i.status)),
            totalCount: list.length,
        }
    })

    const totalIssues = sections.reduce((n, s) => n + s.totalCount, 0)
    const totalOpen = sections.reduce((n, s) => n + s.open.length, 0)
    const totalClosed = sections.reduce((n, s) => n + s.closed.length, 0)

    return (
        <div className="flex flex-col gap-6">
            {members.length === 0 ? (
                <EmptyMembers groupId={id} />
            ) : (
                <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[12px] text-[color:var(--c-text-muted)]">
                            <span className="font-semibold text-[color:var(--c-text)]">{totalOpen}</span> open ·{" "}
                            <span className="font-semibold text-[color:var(--c-text)]">{totalClosed}</span> closed
                            {" · across "}
                            <span className="font-semibold text-[color:var(--c-text)]">{members.length}</span> project{members.length === 1 ? "" : "s"}
                        </p>
                        <div className="flex items-center gap-2">
                            <IssuesViewToggle active={view} />
                            <GroupAiComposeButton
                                groupId={id}
                                members={members}
                                disabled={members.length === 0}
                            />
                            <GroupNewIssueButton members={members} />
                        </div>
                    </div>

                    {totalIssues === 0 ? (
                        <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white px-5 py-12 text-center text-[13px] text-[color:var(--c-text-muted)]">
                            <div className="text-[14px] font-bold text-[color:var(--c-text)]">No issues yet</div>
                            <p className="mt-1">Use AI compose to draft and route an issue across this group, or pick a project to file one directly.</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-7">
                            {sections.map((s) => (
                                <ProjectSectionView
                                    key={s.member.id}
                                    section={s}
                                    view={view}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

function ProjectSectionView({
    section,
    view,
}: {
    section: {
        member: { id: string; name: string; analyser_ready: boolean }
        open: ParentRow[]
        closed: ParentRow[]
        tileOpen: Issue[]
        tileClosed: Issue[]
        totalCount: number
    }
    view: IssuesView
}) {
    const { member, open, closed, tileOpen, tileClosed, totalCount } = section
    return (
        <section className="flex flex-col gap-3">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Link
                        href={`/projects/${member.id}/issues`}
                        className="h-section hover:underline"
                    >
                        {member.name}
                    </Link>
                    {!member.analyser_ready && (
                        <span
                            className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-amber-800"
                            title="Analyser isn't ready — index this project before filing here."
                        >
                            not indexed
                        </span>
                    )}
                </div>
                <span className="text-[11.5px] tabular-nums text-[color:var(--c-text-dim)]">
                    {totalCount} issue{totalCount === 1 ? "" : "s"}
                </span>
            </header>

            {totalCount === 0 ? (
                <div className="rounded-[14px] border border-dashed border-[color:var(--c-border)] bg-white px-4 py-3 text-[12.5px] text-[color:var(--c-text-muted)]">
                    No issues in this project yet.
                </div>
            ) : view === "tile" ? (
                <>
                    {tileOpen.length > 0 && (
                        <ul
                            className="grid gap-3"
                            style={{
                                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                            }}
                        >
                            {tileOpen.map((i) => {
                                const dupes = section.open.find((p) => p.parent.id === i.id)?.children ?? []
                                return (
                                    <li key={i.id}>
                                        {dupes.length > 0 ? (
                                            <IssueFolderTile
                                                parent={i}
                                                duplicates={dupes}
                                                projectId={member.id}
                                            />
                                        ) : (
                                            <IssueTile issue={i} projectId={member.id} />
                                        )}
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                    {tileClosed.length > 0 && (
                        <details className="opacity-90">
                            <summary className="cursor-pointer text-[12px] font-semibold text-[color:var(--c-text-muted)]">
                                {tileClosed.length} closed
                            </summary>
                            <ul
                                className="mt-3 grid gap-3 opacity-80"
                                style={{
                                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                                }}
                            >
                                {tileClosed.map((i) => {
                                    const dupes = section.closed.find((p) => p.parent.id === i.id)?.children ?? []
                                    return (
                                        <li key={i.id}>
                                            {dupes.length > 0 ? (
                                                <IssueFolderTile
                                                    parent={i}
                                                    duplicates={dupes}
                                                    projectId={member.id}
                                                />
                                            ) : (
                                                <IssueTile issue={i} projectId={member.id} />
                                            )}
                                        </li>
                                    )
                                })}
                            </ul>
                        </details>
                    )}
                </>
            ) : (
                <div className="flex flex-col gap-3">
                    {open.length > 0 && <IssueList projectId={member.id} parents={open} />}
                    {closed.length > 0 && (
                        <details className="opacity-90">
                            <summary className="cursor-pointer text-[12px] font-semibold text-[color:var(--c-text-muted)]">
                                {closed.length} closed
                            </summary>
                            <div className="mt-3">
                                <IssueList projectId={member.id} parents={closed} muted />
                            </div>
                        </details>
                    )}
                </div>
            )}
        </section>
    )
}

function EmptyMembers({ groupId }: { groupId: string }) {
    return (
        <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white px-5 py-12 text-center">
            <div className="text-[14px] font-bold">No projects in this group yet</div>
            <p className="mt-1 text-[12.5px] text-[color:var(--c-text-muted)]">
                Add at least one project to enable AI compose and start filing group-aware issues.
            </p>
            <div className="mt-4 flex justify-center">
                <Link
                    href={`/groups/${groupId}/settings`}
                    className="btn-primary"
                >
                    Manage members
                </Link>
            </div>
        </div>
    )
}
