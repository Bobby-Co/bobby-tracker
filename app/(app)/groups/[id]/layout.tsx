import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { ProjectGroup } from "@/lib/supabase/types"
import { GroupTabs } from "@/components/group-tabs"

// Group layout — mirror of the project layout pattern. Header
// (group name + member count) is rendered inside <Suspense> so the
// tabs paint immediately and the data fetch streams underneath.
// Tabs route between Issues (default landing) and Settings (the
// management panel that used to be the entire page).
export default async function GroupLayout({
    children,
    params,
}: {
    children: React.ReactNode
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    return (
        <div className="flex min-h-full flex-col">
            <div className="border-b border-[color:var(--c-border)] bg-white">
                <div className="mx-auto flex w-full max-w-5xl items-start justify-between gap-4 px-4 pt-5 sm:px-6 sm:pt-6">
                    <div className="min-w-0 max-w-full">
                        <Link
                            href="/groups"
                            className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]"
                        >
                            ← Groups
                        </Link>
                        <Suspense fallback={<HeaderSkeleton />}>
                            <GroupHeader id={id} />
                        </Suspense>
                    </div>
                </div>
                <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
                    <GroupTabs groupId={id} />
                </div>
            </div>
            <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</div>
        </div>
    )
}

async function GroupHeader({ id }: { id: string }) {
    const supabase = await createClient()
    const [{ data: group }, { count }] = await Promise.all([
        supabase
            .from("project_groups")
            .select("id,name,description")
            .eq("id", id)
            .maybeSingle<Pick<ProjectGroup, "id" | "name" | "description">>(),
        supabase
            .from("project_group_members")
            .select("group_id", { count: "exact", head: true })
            .eq("group_id", id),
    ])
    if (!group) notFound()
    return (
        <>
            <h1 className="mt-1 truncate text-[20px] font-bold tracking-[-0.012em] sm:text-[22px]">
                {group.name}
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[color:var(--c-text-muted)]">
                <span>{count ?? 0} project{(count ?? 0) === 1 ? "" : "s"}</span>
                {group.description && (
                    <>
                        <span className="text-[color:var(--c-text-dim)]">·</span>
                        <span className="truncate">{group.description}</span>
                    </>
                )}
            </div>
        </>
    )
}

function HeaderSkeleton() {
    return (
        <>
            <div className="skeleton mt-1 h-6 w-48 rounded-[6px] sm:h-7" />
            <div className="skeleton mt-1.5 h-3 w-64 max-w-full rounded-[4px]" />
        </>
    )
}
