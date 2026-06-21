"use client"

import Link from "next/link"
import { useApi } from "@/lib/hooks/use-api"
import type { PublicSession } from "@/lib/supabase/types"
import { NewSessionButton } from "@/components/new-session-button"
import { SessionsSkeleton } from "@/components/sessions-skeleton"
import { MiniCard } from "@/components/field-card"

// Top-level "Public sessions" list. A session is a shareable submission
// link that can cover one or more of the user's projects. From here
// owners create sessions and drill into one to manage it.
//
// Client component: data comes from the cookie-authed GET
// /api/sessions/overview route handler, which returns the same three
// datasets the old server component read directly.
export default function SessionsPage() {
    const overview = useApi<{
        sessions: PublicSession[]
        projects: { id: string; name: string }[]
        projectsBySession: Record<string, string[]>
    }>("/api/sessions/overview")

    if (overview.loading) {
        return <SessionsSkeleton />
    }

    // The route handler returns a `pending_migration` error (503) when the
    // public_sessions table is absent. Render the same hint the server
    // component used to, rather than a generic error banner.
    if (overview.error) {
        return (
            <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
                <header>
                    <h1 className="text-[22px] font-bold tracking-[-0.012em]">Public sessions</h1>
                </header>
                <div className="mt-6 rounded-[16px] border border-dashed border-amber-300 bg-amber-50 p-5 text-[13px] text-amber-900">
                    <div className="text-[14px] font-bold">Pending migration</div>
                    <p className="mt-1">
                        Apply <code className="font-mono">supabase/migrations/0009_public_sessions_v2.sql</code> to enable shareable submission links.
                    </p>
                </div>
            </div>
        )
    }

    const sessions = overview.data?.sessions ?? []
    const projects = overview.data?.projects ?? []
    const projectsBySession = overview.data?.projectsBySession ?? {}

    return (
        <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-[22px] font-bold tracking-[-0.012em]">Public sessions</h1>
                    <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                        Shareable submission links. One session can cover multiple projects — submitters pick which one their issue is for.
                    </p>
                </div>
                <NewSessionButton projects={projects ?? []} />
            </header>

            {(sessions?.length ?? 0) === 0 ? (
                <div className="mt-8 rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white p-8 text-center text-[13px] text-[color:var(--c-text-muted)]">
                    <div className="text-[14px] font-bold text-[color:var(--c-text)]">No sessions yet</div>
                    <p className="mt-1">Create one to get a public link you can share.</p>
                </div>
            ) : (
                <ul
                    className="mt-6 grid gap-3"
                    style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}
                >
                    {(sessions ?? []).map((s) => {
                        const projNames = projectsBySession[s.id] ?? []
                        return (
                            <li key={s.id}>
                                <Link href={`/sessions/${s.id}`} className="block">
                                    <MiniCard
                                        tone={s.enabled ? "emerald" : "zinc"}
                                        icon={<ShareIcon />}
                                        title={s.name}
                                        subtitle={`${s.submission_count} submission${s.submission_count === 1 ? "" : "s"}`}
                                        badge={
                                            <span
                                                className={
                                                    s.enabled
                                                        ? "shrink-0 rounded-full bg-emerald-50 px-2 py-[1px] text-[10px] font-bold uppercase tracking-[0.07em] text-emerald-700"
                                                        : "shrink-0 rounded-full bg-zinc-100 px-2 py-[1px] text-[10px] font-bold uppercase tracking-[0.07em] text-zinc-600"
                                                }
                                            >
                                                {s.enabled ? "Live" : "Paused"}
                                            </span>
                                        }
                                    >
                                        {s.description && (
                                            <p className="line-clamp-2 text-[12.5px] leading-5 text-[color:var(--c-text-muted)]">
                                                {s.description}
                                            </p>
                                        )}
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {projNames.length === 0 ? (
                                                <span className="text-[11.5px] text-[color:var(--c-text-dim)]">
                                                    No projects yet
                                                </span>
                                            ) : (
                                                projNames.slice(0, 4).map((n) => (
                                                    <span key={n} className="chip-min max-w-[140px] truncate">
                                                        {n}
                                                    </span>
                                                ))
                                            )}
                                            {projNames.length > 4 && (
                                                <span className="text-[11px] text-[color:var(--c-text-dim)]">
                                                    +{projNames.length - 4}
                                                </span>
                                            )}
                                        </div>
                                    </MiniCard>
                                </Link>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}

function ShareIcon() {
    return (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
    )
}
