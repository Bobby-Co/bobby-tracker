"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import type { ReporterGroup } from "@/lib/public-reporter"

// Client-rendered listing of public-session submissions, grouped by
// reporter. The grouping is computed on the server and passed in.
//
// Two modes via `restrictToOwn`:
//   - false (default) — show every reporter, with a "you" badge on
//     the visitor's own group.
//   - true — only show the visitor's own submissions. When the visitor
//     is authenticated the server has already filtered the list, so
//     we render as-is. When they're anonymous (link-mode session +
//     'own' visibility), the server passes the full list and we
//     filter client-side by localStorage reporter id.
export function PublicSessionSubmissions({
    token,
    groups,
    restrictToOwn = false,
    visitorIsAuthenticated = false,
}: {
    token: string
    groups: ReporterGroup[]
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
        // submitted anything.
        try { setMyReporterId(localStorage.getItem("bobby:public-profile:reporter-id") ?? "") } catch {}
        setHydrated(true)
    }, [])

    const visibleGroups = useMemo(() => {
        if (!restrictToOwn) return groups
        if (visitorIsAuthenticated) return groups // already server-filtered
        if (!hydrated) return [] // avoid flashing other reporters
        if (!myReporterId) return []
        return groups.filter((g) => g.reporter_id === myReporterId)
    }, [groups, restrictToOwn, visitorIsAuthenticated, hydrated, myReporterId])

    const headingLabel = restrictToOwn ? "Your submissions" : "All submissions"

    if (visibleGroups.length === 0) {
        if (!restrictToOwn) return null
        // In own-mode we still want to render a placeholder so the
        // visitor understands why the page looks empty rather than
        // wondering whether the link is broken.
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

    const total = visibleGroups.reduce((n, g) => n + g.issues.length, 0)

    return (
        <section className="rounded-[14px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                    {headingLabel}
                </h2>
                <span className="text-[11.5px] tabular-nums text-[color:var(--c-text-dim)]">
                    {restrictToOwn
                        ? `${total} submission${total === 1 ? "" : "s"}`
                        : `${total} from ${visibleGroups.length} reporter${visibleGroups.length === 1 ? "" : "s"}`}
                </span>
            </header>

            <div className="mt-3 flex flex-col gap-4">
                {visibleGroups.map((g) => {
                    const isMe = !!myReporterId && g.reporter_id === myReporterId
                    return (
                        <div key={g.key} className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                                <span className="grid h-6 w-6 place-items-center rounded-full bg-zinc-900 text-[11px] font-bold text-white">
                                    {(g.display_name || "?").trim().charAt(0).toUpperCase()}
                                </span>
                                <span className="truncate text-[13px] font-bold">
                                    {g.display_name}
                                </span>
                                {isMe && !restrictToOwn && (
                                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-800">
                                        You
                                    </span>
                                )}
                                <span className="grow" />
                                <span className="text-[11px] tabular-nums text-[color:var(--c-text-dim)]">
                                    {g.issues.length}
                                </span>
                            </div>
                            <ul className="flex flex-col divide-y divide-[color:var(--c-border)] rounded-[10px] border border-[color:var(--c-border)]">
                                {g.issues.map((it) => (
                                    <li key={it.id}>
                                        <Link
                                            href={`/p/${token}/issues/${it.id}`}
                                            className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-[color:var(--c-surface-2)]"
                                        >
                                            <span className="shrink-0 rounded-md bg-[color:var(--c-surface-2)] px-1.5 py-0.5 font-mono text-[11.5px] font-semibold tabular-nums">
                                                #{it.issue_number}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-[13px] font-medium">{it.title}</div>
                                                <div className="text-[11px] text-[color:var(--c-text-dim)]">
                                                    <span className="font-semibold">{it.project_name}</span>
                                                    {" · "}
                                                    <time dateTime={it.created_at}>
                                                        {new Date(it.created_at).toLocaleString()}
                                                    </time>
                                                </div>
                                            </div>
                                            <svg
                                                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                                strokeWidth="2" strokeLinecap="round"
                                                className="mt-1 shrink-0 text-[color:var(--c-text-dim)]"
                                                aria-hidden
                                            >
                                                <path d="M9 6l6 6-6 6" />
                                            </svg>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )
                })}
            </div>
        </section>
    )
}
