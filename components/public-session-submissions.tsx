"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import type { PublicListedIssue, PublicParentRow } from "@/lib/public-reporter"
import { reporterDisplay } from "@/lib/public-reporter"
import { StatusChip } from "@/components/status-chip"

// Public-side counterpart to the auth issues list. Same card-row /
// indented-duplicate hierarchy: each parent issue is its own card,
// and any duplicates pointing at it render as smaller cards in an
// indented amber-bordered column underneath. Cross-reporter
// duplicate links are honored — every issue appears exactly once,
// either as a top-level parent or as a nested child of one.
//
// Reporter info that the old grouped-by-reporter UI surfaced now
// rides along on each card as a small chip, with a "you" badge on
// rows that match the visitor's localStorage reporter id.
//
// Two modes via `restrictToOwn`:
//   - false (default) — show every parent row.
//   - true — only show rows the visitor owns. When the visitor is
//     authenticated the server has already filtered the list, so we
//     render as-is. When they're anonymous (link-mode session +
//     'own' visibility), the server passes the full list and we
//     filter client-side by localStorage reporter id.
export function PublicSessionSubmissions({
    token,
    parents,
    restrictToOwn = false,
    visitorIsAuthenticated = false,
}: {
    token: string
    parents: PublicParentRow[]
    restrictToOwn?: boolean
    visitorIsAuthenticated?: boolean
}) {
    const [myReporterId, setMyReporterId] = useState<string>("")
    // Track whether the localStorage read has completed so anonymous
    // own-mode visitors don't briefly see other people's submissions
    // during hydration before we filter them out.
    const [hydrated, setHydrated] = useState(false)

    useEffect(() => {
        // Read but don't generate — generating an id here would mark
        // every fresh visitor as a "reporter" before they've actually
        // submitted anything. Reading localStorage *requires* an
        // effect (window isn't available during SSR), so the
        // set-state-in-effect lint is genuine to the constraint.
        try {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setMyReporterId(localStorage.getItem("bobby:public-profile:reporter-id") ?? "")
        } catch {}
        setHydrated(true)
    }, [])

    const visibleParents = useMemo(() => {
        if (!restrictToOwn) return parents
        if (visitorIsAuthenticated) return parents // already server-filtered
        if (!hydrated) return [] // avoid flashing other reporters
        if (!myReporterId) return []
        // Soft client-side filter for anonymous link-mode 'own' viewers.
        // A parent stays if the parent OR any of its children matches
        // the visitor — that way the full thread the user participated
        // in is preserved. Children are pruned to only the visitor's
        // own when this filter applies.
        return parents
            .map(({ parent, children }) => {
                const parentMine = parent.public_reporter_id === myReporterId
                const ownChildren = children.filter((c) => c.public_reporter_id === myReporterId)
                if (!parentMine && ownChildren.length === 0) return null
                return { parent, children: parentMine ? children : ownChildren }
            })
            .filter((p): p is PublicParentRow => p !== null)
    }, [parents, restrictToOwn, visitorIsAuthenticated, hydrated, myReporterId])

    const headingLabel = restrictToOwn ? "Your submissions" : "All submissions"
    const totalCount = useMemo(
        () => visibleParents.reduce((n, p) => n + 1 + p.children.length, 0),
        [visibleParents],
    )

    if (visibleParents.length === 0) {
        if (!restrictToOwn) return null
        return (
            <section className="rounded-[14px] border border-dashed border-[color:var(--c-border)] bg-white p-5 text-center text-[12.5px] text-[color:var(--c-text-muted)] sm:p-6">
                <div className="text-[13px] font-bold text-[color:var(--c-text)]">{headingLabel}</div>
                <p className="mt-1">
                    {visitorIsAuthenticated || hydrated
                        ? "You haven't filed anything in this session yet. Submissions you make will appear here, and only you can see them."
                        : "Loading your submissions…"}
                </p>
            </section>
        )
    }

    return (
        <section className="flex flex-col gap-2.5">
            <header className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                    {headingLabel}
                </h2>
                <span className="text-[11.5px] tabular-nums text-[color:var(--c-text-dim)]">
                    {totalCount} submission{totalCount === 1 ? "" : "s"}
                </span>
            </header>

            <div className="flex flex-col gap-2">
                {visibleParents.map(({ parent, children }) => (
                    <ParentBlock
                        key={parent.id}
                        parent={parent}
                        duplicates={children}
                        token={token}
                        myReporterId={myReporterId}
                    />
                ))}
            </div>
        </section>
    )
}

function ParentBlock({
    parent, duplicates, token, myReporterId,
}: {
    parent: PublicListedIssue
    duplicates: PublicListedIssue[]
    token: string
    myReporterId: string
}) {
    // Default expanded so the visitor sees the related thread
    // without an extra click. The chevron stays so noisy parents
    // can still be collapsed.
    const [open, setOpen] = useState(true)
    const hasChildren = duplicates.length > 0

    return (
        <div className="flex flex-col gap-1.5">
            <ParentRowCard
                parent={parent}
                duplicates={duplicates}
                token={token}
                myReporterId={myReporterId}
                open={open}
                onToggle={() => setOpen((o) => !o)}
            />
            {hasChildren && open && (
                <div className="flex flex-col gap-1.5 border-l-2 border-amber-200 pl-3 ml-3 sm:pl-4 sm:ml-5">
                    {duplicates.map((c) => (
                        <ChildRowCard key={c.id} child={c} token={token} myReporterId={myReporterId} />
                    ))}
                </div>
            )}
        </div>
    )
}

function ParentRowCard({
    parent, duplicates, token, myReporterId, open, onToggle,
}: {
    parent: PublicListedIssue
    duplicates: PublicListedIssue[]
    token: string
    myReporterId: string
    open: boolean
    onToggle: () => void
}) {
    const hasChildren = duplicates.length > 0
    const isMe = !!myReporterId && parent.public_reporter_id === myReporterId
    const reporter = reporterDisplay(parent.public_reporter_id, parent.public_reporter_name)

    return (
        <div className="flex items-center gap-2 overflow-hidden rounded-[12px] border border-[color:var(--c-border)] bg-white pl-2 pr-2 shadow-[var(--shadow-card)] transition-colors hover:bg-[color:var(--c-surface-2)] sm:gap-2.5 sm:pl-3 sm:pr-3">
            {hasChildren && (
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={open}
                    aria-label={open ? "Collapse duplicates" : "Expand duplicates"}
                    className="grid h-5 w-5 shrink-0 -mr-2 place-items-center rounded-md text-[color:var(--c-text-dim)] hover:bg-white hover:text-[color:var(--c-text)]"
                >
                    <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        aria-hidden
                        className={"transition-transform " + (open ? "rotate-90" : "")}
                    >
                        <path d="M9 6l6 6-6 6" />
                    </svg>
                </button>
            )}

            <Link
                href={`/p/${token}/issues/${parent.id}`}
                className="group flex min-w-0 flex-1 items-center gap-2 py-2.5 sm:gap-3"
            >
                <span className="hidden shrink-0 font-mono text-[11.5px] text-[color:var(--c-text-dim)] transition-colors group-hover:text-[color:var(--c-text-muted)] sm:inline">
                    #{parent.issue_number}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium transition-transform group-hover:translate-x-px">
                        <span className="mr-1.5 font-mono text-[11px] text-[color:var(--c-text-dim)] sm:hidden">
                            #{parent.issue_number}
                        </span>
                        {parent.title}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-[color:var(--c-text-dim)]">
                        <span className="font-semibold">{parent.project_name}</span>
                        {" · "}
                        <span>{reporter}</span>
                        {" · "}
                        <time dateTime={parent.created_at}>{shortTime(parent.created_at)}</time>
                    </div>
                </div>

                <div className="flex min-w-0 shrink items-center justify-end gap-1.5">
                    {hasChildren && (
                        <span
                            className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-900 tabular-nums"
                            title={`${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"}`}
                        >
                            +{duplicates.length}
                        </span>
                    )}
                    {isMe && (
                        <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-800">
                            You
                        </span>
                    )}
                    <span className="shrink-0">
                        <StatusChip status={parent.status} />
                    </span>
                </div>
            </Link>
        </div>
    )
}

function ChildRowCard({
    child, token, myReporterId,
}: {
    child: PublicListedIssue
    token: string
    myReporterId: string
}) {
    const isMe = !!myReporterId && child.public_reporter_id === myReporterId
    const reporter = reporterDisplay(child.public_reporter_id, child.public_reporter_name)

    return (
        <Link
            href={`/p/${token}/issues/${child.id}`}
            className="group flex items-center gap-2 overflow-hidden rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-2 text-[12.5px] shadow-sm transition-colors hover:bg-[color:var(--c-surface-2)] sm:gap-3 sm:px-3.5"
        >
            <span className="hidden shrink-0 font-mono text-[11px] text-[color:var(--c-text-dim)] sm:inline">
                #{child.issue_number}
            </span>
            <div className="min-w-0 flex-1">
                <div className="truncate text-[color:var(--c-text-muted)] transition-transform group-hover:translate-x-px">
                    <span className="mr-1.5 font-mono text-[10.5px] text-[color:var(--c-text-dim)] sm:hidden">
                        #{child.issue_number}
                    </span>
                    {child.title}
                </div>
                <div className="mt-0.5 truncate text-[10.5px] text-[color:var(--c-text-dim)]">
                    <span>{reporter}</span>
                    {" · "}
                    <time dateTime={child.created_at}>{shortTime(child.created_at)}</time>
                </div>
            </div>
            {isMe && (
                <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-800">
                    You
                </span>
            )}
            <span className="shrink-0">
                <StatusChip status={child.status} />
            </span>
        </Link>
    )
}

// Compact "5m ago" / "yesterday" / locale fallback for the reporter
// metadata row. Keeps the chip area lighter than a full timestamp.
function shortTime(iso: string): string {
    const t = Date.parse(iso)
    if (Number.isNaN(t)) return ""
    const diff = Date.now() - t
    const sec = Math.round(diff / 1000)
    if (sec < 60) return "just now"
    const min = Math.round(sec / 60)
    if (min < 60) return `${min}m ago`
    const hr = Math.round(min / 60)
    if (hr < 24) return `${hr}h ago`
    const day = Math.round(hr / 24)
    if (day < 7) return `${day}d ago`
    return new Date(t).toLocaleDateString()
}
