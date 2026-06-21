"use client"

import { usePathname } from "next/navigation"
import { Sidebar } from "@/components/sidebar"
import { MobileSidebar } from "@/components/mobile-sidebar"
import type { Project } from "@/lib/supabase/types"

// Presentational app shell — the chrome shared by every signed-in route
// (and the dev preview harness). Mirrors the reference: a tinted "desk"
// (--c-shell) carrying the sidebar and a borderless topbar, with the
// page content floating inside a white rounded panel (.app-panel) whose
// top-left corner tucks against the sidebar + topbar.
//
// Auth lives in app/(app)/layout.tsx; this component is purely visual so
// the same markup can be exercised without a live session.
export function AppShell({
    projects,
    children,
}: {
    projects: Project[]
    children: React.ReactNode
}) {
    return (
        <div className="flex h-screen w-full bg-[color:var(--c-shell)] text-[color:var(--c-text)]">
            <Sidebar projects={projects} />
            <div className="flex min-w-0 flex-1 flex-col pt-2">
                <header className="flex h-14 shrink-0 items-center gap-2.5 px-3 sm:gap-3 sm:px-5">
                    <MobileSidebar projects={projects} />
                    <TopBreadcrumb projects={projects} />
                    <label className="relative ml-auto flex shrink-0 items-center">
                        <span className="pointer-events-none absolute left-3 grid place-items-center text-[color:var(--c-text-dim)]">
                            <SearchIcon />
                        </span>
                        <input
                            type="search"
                            aria-label="Search"
                            placeholder="Search…"
                            className="h-9 w-[160px] rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] pl-9 pr-3 text-[13px] text-[color:var(--c-text)] placeholder:text-[color:var(--c-text-dim)] shadow-[0_1px_1px_rgba(17,24,39,0.02)] transition-[width,background-color,border-color] duration-200 hover:border-[color:var(--c-border-strong)] focus:w-[220px] focus:border-[color:var(--c-primary)] focus:outline-none focus:ring-[3px] focus:ring-[color:var(--c-ring)] sm:w-[200px] sm:focus:w-[260px]"
                        />
                    </label>
                </header>
                <main className="min-h-0 flex-1">
                    <div className="app-panel">{children}</div>
                </main>
            </div>
        </div>
    )
}

function SearchIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
        </svg>
    )
}

const SECTION_LABEL: Record<string, string> = {
    projects: "Projects",
    groups: "Groups",
    sessions: "Public sessions",
    workers: "Local models",
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Top-bar breadcrumb (reference: "</> Engineering › Workstreams"). Built
// from the path; resolves the project name when on a project route.
function TopBreadcrumb({ projects }: { projects: Project[] }) {
    const pathname = usePathname()
    const segs = pathname.split("/").filter(Boolean)
    const crumbs: string[] = []
    if (segs[0]) crumbs.push(SECTION_LABEL[segs[0]] ?? cap(segs[0]))
    if (segs[1]) {
        if (segs[0] === "projects") crumbs.push(projects.find((p) => p.id === segs[1])?.name ?? "Project")
        else if (segs[0] === "groups") crumbs.push("Group")
        else if (segs[0] === "sessions") crumbs.push("Session")
    }
    if (segs[2]) crumbs.push(cap(segs[2]))
    if (crumbs.length === 0) crumbs.push("Home")

    return (
        <nav aria-label="Breadcrumb" className="hidden min-w-0 shrink items-center gap-1.5 sm:flex">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-[color:var(--c-surface)] text-[color:var(--c-text-muted)] shadow-[0_1px_1px_rgba(17,24,39,0.03)] ring-1 ring-[color:var(--c-border)]">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
                </svg>
            </span>
            {crumbs.map((c, i) => (
                <span key={i} className="flex min-w-0 items-center gap-1.5">
                    {i > 0 && <span className="text-[color:var(--c-text-dim)]" aria-hidden>›</span>}
                    <span
                        className={
                            i === crumbs.length - 1
                                ? "max-w-[200px] truncate text-[12.5px] font-semibold text-[color:var(--c-text)]"
                                : "max-w-[140px] truncate text-[12.5px] font-medium text-[color:var(--c-text-muted)]"
                        }
                    >
                        {c}
                    </span>
                </span>
            ))}
        </nav>
    )
}

// Shell skeleton shown while the session resolves or a redirect is
// pending — mirrors the floating-panel chrome so there's no layout jump
// when the real content swaps in.
export function ShellSkeleton() {
    return (
        <div className="flex h-screen w-full bg-[color:var(--c-shell)]">
            <aside aria-busy className="hidden w-64 shrink-0 flex-col sm:flex">
                <div className="flex h-14 items-center gap-2.5 px-3.5">
                    <div className="skeleton h-8 w-8 rounded-[9px]" />
                    <div className="skeleton h-3.5 w-20 rounded" />
                </div>
                <div className="flex flex-col gap-1.5 px-2.5 py-3">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="skeleton h-8 w-full rounded-[9px]" />
                    ))}
                </div>
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-14 items-center justify-end px-3 sm:px-5">
                    <div className="skeleton h-9 w-[200px] rounded-[10px]" />
                </header>
                <main className="min-h-0 flex-1">
                    <div className="app-panel" />
                </main>
            </div>
        </div>
    )
}
