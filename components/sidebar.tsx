"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { Project } from "@/lib/supabase/types"

export function Sidebar({ projects, activeProjectId }: { projects: Project[]; activeProjectId?: string }) {
    const pathname = usePathname()
    const isInbox = pathname === "/projects"

    return (
        <nav className="flex h-full w-60 shrink-0 flex-col gap-1 border-r border-zinc-200 bg-zinc-50 px-3 py-4 dark:border-zinc-800 dark:bg-zinc-950">
            <Link
                href="/projects"
                className={cn(
                    "flex items-center justify-between rounded-md px-3 py-1.5 text-sm font-medium",
                    isInbox
                        ? "bg-zinc-200/60 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                        : "text-zinc-600 hover:bg-zinc-200/40 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
                )}
            >
                <span>Projects</span>
                <span className="text-xs text-zinc-500">{projects.length}</span>
            </Link>
            <div className="mt-4 px-3 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Your projects</div>
            <div className="mt-1 flex flex-col gap-0.5">
                {projects.length === 0 && (
                    <p className="px-3 py-2 text-xs text-zinc-500">No projects yet.</p>
                )}
                {projects.map((p) => {
                    const active = p.id === activeProjectId
                    return (
                        <Link
                            key={p.id}
                            href={`/projects/${p.id}/issues`}
                            className={cn(
                                "truncate rounded-md px-3 py-1.5 text-sm",
                                active
                                    ? "bg-zinc-200/60 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                                    : "text-zinc-600 hover:bg-zinc-200/40 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
                            )}
                        >
                            {p.name}
                        </Link>
                    )
                })}
            </div>
        </nav>
    )
}

function cn(...c: (string | false | null | undefined)[]) {
    return c.filter(Boolean).join(" ")
}
