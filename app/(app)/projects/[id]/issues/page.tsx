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
            <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] text-[color:var(--c-text-muted)]">
                    <span className="font-semibold text-[color:var(--c-text)]">{open.length}</span> open ·{" "}
                    <span className="font-semibold text-[color:var(--c-text)]">{closed.length}</span> closed
                </p>
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
            <h2 className="h-section mb-3">{title}</h2>
            <ul className="overflow-hidden rounded-[16px] border border-[color:var(--c-border)] bg-white shadow-[var(--shadow-card)] divide-y divide-[color:var(--c-border)]">
                {issues.length === 0 && (
                    <li className="px-5 py-8 text-center text-[13px] text-[color:var(--c-text-muted)]">No issues here.</li>
                )}
                {issues.map((i) => (
                    <li key={i.id} className={muted ? "opacity-70" : ""}>
                        <Link
                            href={`/projects/${projectId}/issues/${i.id}`}
                            className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--c-surface-2)]"
                        >
                            <span className="font-mono text-[11.5px] text-[color:var(--c-text-dim)] transition-colors group-hover:text-[color:var(--c-text-muted)]">
                                #{i.issue_number}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium transition-transform group-hover:translate-x-px">
                                {i.title}
                            </span>
                            <div className="flex items-center gap-1.5">
                                {i.labels.slice(0, 3).map((l) => (
                                    <span
                                        key={l}
                                        className="rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-2 py-[2px] text-[11px] font-semibold text-[color:var(--c-text-muted)]"
                                    >
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
