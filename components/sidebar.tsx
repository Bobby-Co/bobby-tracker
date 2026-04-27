"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/components/cn"
import type { Project } from "@/lib/supabase/types"

export function Sidebar({ projects, activeProjectId }: { projects: Project[]; activeProjectId?: string }) {
    const pathname = usePathname()
    const isInbox = pathname === "/projects"

    return (
        <nav className="flex h-full w-60 shrink-0 flex-col gap-1 border-r border-[color:var(--c-border)] bg-white px-3 py-4">
            <div className="mb-2 flex items-center gap-2 px-3">
                <BobbyMark />
                <span className="text-[15px] font-bold tracking-[-0.01em]">Tracker</span>
            </div>

            <Link
                href="/projects"
                className={cn(
                    "flex items-center justify-between rounded-[10px] px-3 py-1.5 text-sm font-medium transition-colors",
                    isInbox
                        ? "bg-zinc-100 text-zinc-900"
                        : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
                )}
            >
                <span className="inline-flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <rect x="3" y="3" width="18" height="18" rx="3" />
                        <path d="M3 9h18M9 21V9" />
                    </svg>
                    Projects
                </span>
                <span className="text-[11px] tabular-nums text-[color:var(--c-text-dim)]">{projects.length}</span>
            </Link>

            <div className="mt-4 px-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-dim)]">
                Your projects
            </div>
            <div className="mt-1 flex flex-col gap-0.5">
                {projects.length === 0 && (
                    <p className="px-3 py-2 text-xs text-[color:var(--c-text-dim)]">No projects yet.</p>
                )}
                {projects.map((p) => {
                    const active = p.id === activeProjectId
                    return (
                        <Link
                            key={p.id}
                            href={`/projects/${p.id}/issues`}
                            className={cn(
                                "group flex items-center gap-2 truncate rounded-[10px] px-3 py-1.5 text-[13px] transition-colors",
                                active
                                    ? "bg-zinc-100 text-zinc-900 font-semibold"
                                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
                            )}
                        >
                            <span
                                className={cn(
                                    "h-1.5 w-1.5 rounded-full transition-colors",
                                    active ? "bg-zinc-900" : "bg-zinc-300 group-hover:bg-zinc-500",
                                )}
                            />
                            <span className="truncate">{p.name}</span>
                        </Link>
                    )
                })}
            </div>
        </nav>
    )
}

function BobbyMark() {
    return (
        <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-[8px] bg-zinc-900"
            style={{ color: "#a3e635" }}
        >
            <svg viewBox="0 0 106 102" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 22 C14 12 22 4 32 4 H74 C84 4 92 12 92 22 V70 C92 86 80 98 64 98 H42 C26 98 14 86 14 70 Z" fill="currentColor" />
                <circle cx="40" cy="46" r="9" fill="#080808" />
                <circle cx="68" cy="46" r="9" fill="#080808" />
            </svg>
        </span>
    )
}
