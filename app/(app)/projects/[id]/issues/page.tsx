import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { NewIssueButton } from "@/components/new-issue-button"
import { AiComposeButton } from "@/components/ai-compose-button"
import { IssueList, type ParentRow } from "@/components/issue-list"
import { IssueTile } from "@/components/issue-tile"
import { IssueFolderTile } from "@/components/issue-folder-tile"
import { IssuesViewToggle, type IssuesView } from "@/components/issues-view-toggle"
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
    // Build a parent → children tree. A "parent" is any issue
    // that isn't itself a duplicate; its children are the issues
    // pointing at it via duplicate_of_issue_id. We forbid chains in
    // the API (one level deep), so this single pass is enough.
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
        .map((parent) => ({
            parent,
            children: childrenByParent.get(parent.id) ?? [],
        }))

    // Bucketing happens on the parent's own status. Duplicated
    // children always render under their parent regardless of which
    // bucket the parent ends up in. "Duplicated" parents shouldn't
    // exist (chain-prevention in the API), so we don't need to
    // bucket them as a separate state.
    const isClosed = (s: Issue["status"]) => s === "done" || s === "archived" || s === "duplicated"
    const open = parentsAll.filter(({ parent }) => !isClosed(parent.status))
    const closed = parentsAll.filter(({ parent }) => isClosed(parent.status))

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
                    {childrenByParent.size > 0 && (
                        <>
                            {" · "}
                            <span className="font-semibold text-[color:var(--c-text)]">
                                {Array.from(childrenByParent.values()).reduce((n, a) => n + a.length, 0)}
                            </span>{" "}
                            duplicate{Array.from(childrenByParent.values()).reduce((n, a) => n + a.length, 0) === 1 ? "" : "s"}
                        </>
                    )}
                </p>
                <div className="flex items-center gap-2">
                    <IssuesViewToggle active={view} projectId={id} />
                    <AiComposeButton
                        projectId={id}
                        disabled={!ready}
                        disabledReason="Enable the analyser and run the first index on the Knowledge tab before creating issues."
                    />
                    <NewIssueButton
                        projectId={id}
                        disabled={!ready}
                        disabledReason="Enable the analyser and run the first index on the Knowledge tab before creating issues."
                    />
                </div>
            </div>

            <IssueGroup
                title="Open"
                projectId={id}
                parents={open}
                view={view}
            />
            {closed.length > 0 && (
                <IssueGroup
                    title="Closed"
                    projectId={id}
                    parents={closed}
                    view={view}
                    muted
                />
            )}
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
    parents,
    view,
    muted,
}: {
    title: string
    projectId: string
    parents: ParentRow[]
    view: IssuesView
    muted?: boolean
}) {
    return (
        <section className={muted ? "opacity-90" : ""}>
            <h2 className="h-section mb-3">{title}</h2>

            {parents.length === 0 ? (
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
                    {parents.map(({ parent, children }, idx) => (
                        <li key={parent.id} className={muted ? "opacity-70" : undefined}>
                            {children.length > 0 ? (
                                <IssueFolderTile
                                    parent={parent}
                                    duplicates={children}
                                    projectId={projectId}
                                    index={idx}
                                />
                            ) : (
                                <IssueTile issue={parent} projectId={projectId} index={idx} />
                            )}
                        </li>
                    ))}
                </ul>
            ) : (
                <IssueList projectId={projectId} parents={parents} muted={muted} />
            )}
        </section>
    )
}
