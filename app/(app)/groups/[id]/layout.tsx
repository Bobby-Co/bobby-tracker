"use client"

import { useParams } from "next/navigation"
import { useApi } from "@/lib/hooks/use-api"
import type { ProjectGroup } from "@/lib/supabase/types"
import { GroupTabs } from "@/components/group-tabs"
import { MiniIcon, toneFromString } from "@/components/field-card"

// Group detail shell — mirror of the project layout. Header (name +
// member count) loads via /api/groups/[id]; tabs paint immediately and
// route between Issues (default) and Settings.
export default function GroupLayout({ children }: { children: React.ReactNode }) {
    const { id } = useParams<{ id: string }>()
    return (
        <div className="flex min-h-full flex-col">
            <div className="border-b border-[color:var(--c-border)] bg-white">
                <div className="flex w-full max-w-5xl items-start justify-between gap-4 px-4 pt-5 sm:px-6 sm:pt-6">
                    <div className="min-w-0 max-w-full">
                        <GroupHeader id={id} />
                    </div>
                </div>
                <div className="w-full max-w-5xl px-4 sm:px-6">
                    <GroupTabs groupId={id} />
                </div>
            </div>
            <div className="w-full max-w-5xl flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</div>
        </div>
    )
}

function GroupHeader({ id }: { id: string }) {
    const { data, loading } = useApi<{
        group: Pick<ProjectGroup, "id" | "name" | "description"> | null
        members: unknown[]
    }>(`/api/groups/${id}`)

    if (loading) return <HeaderSkeleton />
    const group = data?.group
    if (!group) {
        return (
            <h1 className="mt-1 truncate text-[20px] font-bold tracking-[-0.012em] sm:text-[22px]">
                Group not found
            </h1>
        )
    }
    const count = data?.members?.length ?? 0
    return (
        <div className="mt-1.5 flex items-center gap-3">
            <MiniIcon tone={toneFromString(group.name)} size={40}>
                <FolderIcon size={19} />
            </MiniIcon>
            <div className="min-w-0">
                <h1 className="truncate text-[20px] font-bold tracking-[-0.012em] sm:text-[22px]">
                    {group.name}
                </h1>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[color:var(--c-text-muted)]">
                    <span>{count} project{count === 1 ? "" : "s"}</span>
                    {group.description && (
                        <>
                            <span className="text-[color:var(--c-text-dim)]">·</span>
                            <span className="truncate">{group.description}</span>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

function FolderIcon({ size = 13 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
    )
}

function HeaderSkeleton() {
    return (
        <div className="mt-1.5 flex items-center gap-3">
            <div className="skeleton h-10 w-10 rounded-full" />
            <div className="min-w-0">
                <div className="skeleton h-6 w-48 rounded-[6px] sm:h-7" />
                <div className="skeleton mt-1.5 h-3 w-64 max-w-full rounded-[4px]" />
            </div>
        </div>
    )
}
