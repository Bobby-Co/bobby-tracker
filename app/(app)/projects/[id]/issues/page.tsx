import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { NewIssueButton } from "@/components/new-issue-button"
import { IssueTile } from "@/components/issue-tile"
import { IssuesViewToggle, type IssuesView } from "@/components/issues-view-toggle"
import { PriorityChip, StatusChip } from "@/components/status-chip"
import type { Issue, ProjectAnalyser } from "@/lib/supabase/types"

export const dynamic = "force-dynamic"

export default async function IssuesPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>
    searchParams: Promise<{ view?: string }>
}) {
    const { id } = await params
    const { view: viewParam } = await searchParams
    const view: IssuesView = viewParam === "tile" ? "tile" : "list"

    const supabase = await createClient()
    const [{ data: issues }, { data: analyser }] = await Promise.all([
        supabase
            .from("issues")
            .select("*")
            .eq("project_id", id)
            .order("updated_at", { ascending: false })
            .returns<Issue[]>(),
        supabase
            .from("project_analyser")
            .select("*")
            .eq("project_id", id)
            .maybeSingle<ProjectAnalyser>(),
    ])

    const list = issues ?? []
    const open = list.filter((i) => i.status !== "done" && i.status !== "archived")
    const closed = list.filter((i) => i.status === "done" || i.status === "archived")

    // A freshly-created project has no analyser row, or one with status
    // pending/indexing/failed and no graph_id. Until the first index
    // completes, "issues" without graph context aren't useful — the
    // suggestion / ask flows can't cite anything. Block creation;
    // direct the user to the Knowledge tab.
    const ready =
        !!analyser?.enabled && analyser.status === "ready" && !!analyser.graph_id

    return (
        <div className="flex flex-col gap-6">
            {!ready && (
                <KnowledgeRequiredBanner projectId={id} state={analyser ?? null} />
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] text-[color:var(--c-text-muted)]">
                    <span className="font-semibold text-[color:var(--c-text)]">{open.length}</span> open ·{" "}
                    <span className="font-semibold text-[color:var(--c-text)]">{closed.length}</span> closed
                </p>
                <div className="flex items-center gap-2">
                    <IssuesViewToggle active={view} />
                    <NewIssueButton
                        projectId={id}
                        disabled={!ready}
                        disabledReason="Enable the analyser and run the first index on the Knowledge tab before creating issues."
                    />
                </div>
            </div>

            <IssueGroup title="Open" projectId={id} issues={open} view={view} />
            {closed.length > 0 && <IssueGroup title="Closed" projectId={id} issues={closed} view={view} muted />}
        </div>
    )
}

function KnowledgeRequiredBanner({
    projectId,
    state,
}: {
    projectId: string
    state: ProjectAnalyser | null
}) {
    const status = state?.status ?? "disabled"
    let message = "Enable the analyser and run the first index before creating issues."
    if (status === "indexing") {
        message = "Indexing is in progress — issues will unlock when the first graph is ready."
    } else if (status === "failed") {
        message = "The last indexing run failed. Re-index from the Knowledge tab to unlock issues."
    } else if (state?.enabled && !state?.graph_id) {
        message = "Run the first index on the Knowledge tab before creating issues."
    }
    return (
        <div className="anim-rise rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="font-semibold">Knowledge graph required</span>
                <span className="text-[12.5px] text-amber-800">{message}</span>
                <span className="ml-auto" />
                <Link
                    href={`/projects/${projectId}/knowledge`}
                    className="inline-flex items-center rounded-[10px] bg-amber-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-950"
                >
                    Go to Knowledge
                </Link>
            </div>
        </div>
    )
}

function IssueGroup({
    title,
    projectId,
    issues,
    view,
    muted,
}: {
    title: string
    projectId: string
    issues: Issue[]
    view: IssuesView
    muted?: boolean
}) {
    return (
        <section className={muted ? "opacity-90" : ""}>
            <h2 className="h-section mb-3">{title}</h2>

            {issues.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white px-5 py-8 text-center text-[13px] text-[color:var(--c-text-muted)]">
                    No issues here.
                </div>
            ) : view === "tile" ? (
                <ul
                    className="grid gap-3 stagger"
                    style={{
                        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                        ["--stagger-step" as string]: "55ms",
                    } as React.CSSProperties}
                >
                    {issues.map((i, idx) => (
                        <li key={i.id} className={muted ? "opacity-70" : undefined}>
                            <IssueTile issue={i} projectId={projectId} index={idx} />
                        </li>
                    ))}
                </ul>
            ) : (
                <ul className="overflow-hidden rounded-[16px] border border-[color:var(--c-border)] bg-white shadow-[var(--shadow-card)] divide-y divide-[color:var(--c-border)]">
                    {issues.map((i) => (
                        <li key={i.id} className={muted ? "opacity-70" : undefined}>
                            <Link
                                href={`/projects/${projectId}/issues/${i.id}`}
                                className="group flex items-center gap-2.5 px-3 py-3 transition-colors hover:bg-[color:var(--c-surface-2)] sm:gap-3 sm:px-4"
                            >
                                <span className="hidden font-mono text-[11.5px] text-[color:var(--c-text-dim)] transition-colors group-hover:text-[color:var(--c-text-muted)] sm:inline">
                                    #{i.issue_number}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium transition-transform group-hover:translate-x-px">
                                    <span className="mr-1.5 font-mono text-[11px] text-[color:var(--c-text-dim)] sm:hidden">
                                        #{i.issue_number}
                                    </span>
                                    {i.title}
                                </span>
                                <div className="flex shrink-0 items-center gap-1.5">
                                    {i.labels.slice(0, 3).map((l) => (
                                        <span
                                            key={l}
                                            className="hidden rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-2 py-[2px] text-[11px] font-semibold text-[color:var(--c-text-muted)] md:inline"
                                        >
                                            {l}
                                        </span>
                                    ))}
                                    <span className="hidden sm:inline">
                                        <PriorityChip priority={i.priority} />
                                    </span>
                                    <StatusChip status={i.status} />
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}
