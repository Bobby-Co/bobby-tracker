import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { IssueForm } from "@/components/issue-form"
import { PriorityChip, StatusChip } from "@/components/status-chip"
import type { Issue } from "@/lib/supabase/types"

export const dynamic = "force-dynamic"

export default async function IssuesPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const supabase = await createClient()
    const { data: issues } = await supabase
        .from("issues")
        .select("*")
        .eq("project_id", id)
        .order("updated_at", { ascending: false })
        .returns<Issue[]>()

    const list = issues ?? []
    const open = list.filter((i) => i.status !== "done" && i.status !== "archived")
    const closed = list.filter((i) => i.status === "done" || i.status === "archived")

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-xs text-zinc-500">{open.length} open · {closed.length} closed</p>
                </div>
                <IssueForm projectId={id} />
            </div>

            <IssueGroup title="Open" projectId={id} issues={open} />
            {closed.length > 0 && <IssueGroup title="Closed" projectId={id} issues={closed} muted />}
        </div>
    )
}

function IssueGroup({ title, projectId, issues, muted }: { title: string; projectId: string; issues: Issue[]; muted?: boolean }) {
    return (
        <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">{title}</h2>
            <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
                {issues.length === 0 && (
                    <li className="px-4 py-6 text-center text-sm text-zinc-500">No issues here.</li>
                )}
                {issues.map((i) => (
                    <li key={i.id} className={muted ? "opacity-70" : ""}>
                        <Link
                            href={`/projects/${projectId}/issues/${i.id}`}
                            className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                        >
                            <span className="font-mono text-xs text-zinc-400 transition-colors group-hover:text-zinc-600 dark:group-hover:text-zinc-300">#{i.issue_number}</span>
                            <span className="min-w-0 flex-1 truncate text-sm transition-transform group-hover:translate-x-px">{i.title}</span>
                            <div className="flex items-center gap-1.5">
                                {i.labels.slice(0, 3).map((l) => (
                                    <span key={l} className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                        {l}
                                    </span>
                                ))}
                                <PriorityChip priority={i.priority} />
                                <StatusChip status={i.status} />
                            </div>
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    )
}
