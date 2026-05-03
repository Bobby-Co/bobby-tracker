import { Suspense } from "react"
import { notFound } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/server"
import type { Issue, PublicSession, PublicSessionAccessMode } from "@/lib/supabase/types"
import { PublicIssueForm } from "@/components/public-issue-form"
import { PublicProfileBadge } from "@/components/public-profile-badge"
import { PublicSessionSubmissions } from "@/components/public-session-submissions"
import { PublicSessionSkeleton } from "@/components/public-session-skeleton"
import { PublicSessionGate } from "@/components/public-session-gate"
import { checkInviteAccess } from "@/lib/public-session"
import { groupByReporter, type PublicListedIssue } from "@/lib/public-reporter"

export const dynamic = "force-dynamic"

type Window = "open" | "not_yet" | "closed"

function windowState(s: { start_at: string | null; end_at: string | null }): Window {
    const now = Date.now()
    if (s.start_at && Date.parse(s.start_at) > now) return "not_yet"
    if (s.end_at && Date.parse(s.end_at) <= now) return "closed"
    return "open"
}

function fmt(iso: string) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

// Public submission page. Synchronous shell wraps a streaming
// <Suspense> boundary, so the skeleton renders the moment the user
// navigates here (back from an issue detail, fresh visit, etc.) —
// the data-fetching never blocks the initial paint.
export default function PublicSessionPage({
    params,
}: {
    params: Promise<{ token: string }>
}) {
    return (
        <Suspense fallback={<PublicSessionSkeleton />}>
            <PublicSessionContent params={params} />
        </Suspense>
    )
}

async function PublicSessionContent({
    params,
}: {
    params: Promise<{ token: string }>
}) {
    const { token } = await params
    const svc = createServiceClient()

    const { data: session } = await svc
        .from("public_sessions")
        .select("id,enabled,access_mode,name,title,description,start_at,end_at")
        .eq("token", token)
        .maybeSingle<Pick<PublicSession, "id" | "enabled" | "access_mode" | "name" | "title" | "description" | "start_at" | "end_at">>()

    if (!session) notFound()

    // Invite-only sessions are gated *before* we leak any submission
    // data. We still render the public heading so the visitor knows
    // which session they're being invited into.
    if (session.enabled && session.access_mode === "invite") {
        const access = await checkInviteAccess({
            id: session.id,
            access_mode: session.access_mode as PublicSessionAccessMode,
        })
        if (!access.ok) {
            return (
                <PublicSessionGate
                    reason={access.reason}
                    email={"email" in access ? access.email : null}
                    nextPath={`/p/${token}`}
                    heading={session.title || session.name}
                />
            )
        }
    }

    const { data: links } = await svc
        .from("public_session_projects")
        .select("project_id,projects(id,name)")
        .eq("session_id", session.id)
    const projects = (links ?? [])
        .map((r: { project_id: string; projects: unknown }) => {
            const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects
            const name = (proj && typeof proj === "object" && "name" in proj) ? (proj as { name: string }).name : ""
            return { id: r.project_id, name }
        })
        .filter((p) => p.name)
        .sort((a, b) => a.name.localeCompare(b.name))

    const projectIds = projects.map((p) => p.id)
    const projectNameById = new Map(projects.map((p) => [p.id, p.name]))

    type ListedIssueRow = Pick<Issue, "id" | "issue_number" | "title" | "project_id" | "created_at">
    const { data: issueRows } = projectIds.length
        ? await svc
            .from("issues")
            .select("id,issue_number,title,project_id,created_at")
            .in("project_id", projectIds)
            .contains("labels", ["public-session"])
            .order("created_at", { ascending: false })
            .limit(200)
            .returns<ListedIssueRow[]>()
        : { data: [] as ListedIssueRow[] }

    const issueIds = (issueRows ?? []).map((r) => r.id)
    const { data: reporterRows } = issueIds.length
        ? await svc
            .from("public_issue_reporters")
            .select("issue_id,reporter_id,reporter_name")
            .in("issue_id", issueIds)
            .returns<{ issue_id: string; reporter_id: string | null; reporter_name: string | null }[]>()
        : { data: [] as { issue_id: string; reporter_id: string | null; reporter_name: string | null }[] }

    const reporterByIssue = new Map<string, { id: string | null; name: string | null }>()
    for (const r of reporterRows ?? []) {
        reporterByIssue.set(r.issue_id, { id: r.reporter_id, name: r.reporter_name })
    }

    const listedIssues: PublicListedIssue[] = (issueRows ?? []).map((r) => {
        const rep = reporterByIssue.get(r.id)
        return {
            id: r.id,
            issue_number: r.issue_number,
            title: r.title,
            project_name: projectNameById.get(r.project_id) ?? "",
            public_reporter_id: rep?.id ?? null,
            public_reporter_name: rep?.name ?? null,
            created_at: r.created_at,
        }
    })
    const groups = groupByReporter(listedIssues)

    const win = session.enabled ? windowState(session) : "closed"
    const heading = session.title || session.name

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:gap-6 sm:px-6 sm:py-12">
            <header className="anim-fade flex flex-col gap-3">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                    <span className="grid h-5 w-5 place-items-center rounded-md bg-zinc-900 text-white">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                            <circle cx="12" cy="12" r="9" />
                        </svg>
                    </span>
                    <span>Public submission</span>
                </div>
                <div>
                    <h1 className="text-[22px] font-bold leading-tight tracking-[-0.012em] sm:text-[28px]">
                        {heading}
                    </h1>
                    {session.description && (
                        <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[color:var(--c-text-muted)] sm:text-[14px]">
                            {session.description}
                        </p>
                    )}
                </div>
                {projects.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-[color:var(--c-text-muted)]">
                        <span>Covers:</span>
                        {projects.map((p) => (
                            <span
                                key={p.id}
                                className="rounded-full bg-[color:var(--c-surface-2)] px-2 py-0.5 font-semibold text-[color:var(--c-text)]"
                            >
                                {p.name}
                            </span>
                        ))}
                    </div>
                )}
                {(session.start_at || session.end_at) && win === "open" && (
                    <div className="text-[11.5px] text-[color:var(--c-text-dim)]">
                        {session.start_at && session.end_at
                            ? <>Open · closes <time dateTime={session.end_at}>{fmt(session.end_at)}</time></>
                            : session.end_at
                                ? <>Closes <time dateTime={session.end_at}>{fmt(session.end_at)}</time></>
                                : <>Open since <time dateTime={session.start_at!}>{fmt(session.start_at!)}</time></>}
                    </div>
                )}
                {win === "open" && <PublicProfileBadge />}
            </header>

            {win === "open" ? (
                projects.length === 0 ? (
                    <ClosedCard
                        title="No projects in this session yet"
                        body="The owner hasn't added any projects to this submission link. Reach out to them and ask them to add at least one."
                    />
                ) : (
                    <>
                        <PublicIssueForm token={token} projects={projects} />
                        <PublicSessionSubmissions token={token} groups={groups} />
                    </>
                )
            ) : !session.enabled ? (
                <ClosedCard
                    title="Submissions paused"
                    body="This public submission link has been disabled by the owner. Check back later or reach out to them directly."
                />
            ) : win === "not_yet" ? (
                <ClosedCard
                    title="Not open yet"
                    body={`Submissions open ${session.start_at ? fmt(session.start_at) : "soon"}.`}
                />
            ) : (
                <ClosedCard
                    title="Submissions closed"
                    body={`This link closed ${session.end_at ? fmt(session.end_at) : "earlier"}.`}
                />
            )}

            <footer className="text-center text-[11px] text-[color:var(--c-text-dim)]">
                Bobby Tracker · public submission
            </footer>
        </main>
    )
}

function ClosedCard({ title, body }: { title: string; body: string }) {
    return (
        <div className="anim-rise rounded-[14px] border border-[color:var(--c-border)] bg-white p-6 text-center shadow-sm sm:p-8">
            <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-zinc-100 text-zinc-600">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                </svg>
            </div>
            <h2 className="mt-3 text-[18px] font-bold sm:text-[20px]">{title}</h2>
            <p className="mt-2 text-[13px] text-[color:var(--c-text-muted)]">{body}</p>
        </div>
    )
}
