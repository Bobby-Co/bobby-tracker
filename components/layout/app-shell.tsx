"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/components/ui/cn"
import { Sidebar } from "@/components/layout/sidebar"
import { MobileSidebar } from "@/components/layout/mobile-sidebar"
import { NotificationPopover } from "@/components/layout/notification-popover"
import { isImmersiveMind } from "@/components/layout/immersive"
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
    const pathname = usePathname()
    const immersive = isImmersiveMind(pathname)

    return (
        <div className="flex h-screen w-full bg-[color:var(--c-shell)] text-[color:var(--c-text)]">
            <Sidebar projects={projects} collapsed={immersive} />
            <div className={cn("flex min-w-0 flex-1 flex-col transition-[padding] duration-500", immersive ? "pt-0" : "pt-2")}>
                <header
                    className={cn(
                        "relative z-30 flex shrink-0 items-center gap-2.5 px-3 transition-[height,opacity] duration-500 sm:gap-3 sm:px-5",
                        // overflow-hidden ONLY while immersive. It exists to contain the
                        // contents as the bar collapses to h-0 for the Mind view — at the
                        // normal h-14 nothing overflows, so clipping buys nothing and costs
                        // a lot: the notification popover is absolutely positioned inside
                        // this header and grows ~420px BELOW it, so a permanent clip cut it
                        // off at the header's edge. That reads as "the popover is under the
                        // page", but no z-index can fix it — a clipped box can't escape its
                        // clipping ancestor by winning the stacking order.
                        immersive ? "pointer-events-none h-0 overflow-hidden opacity-0" : "h-14 opacity-100",
                    )}
                >
                    <MobileSidebar projects={projects} />
                    <TopBreadcrumb projects={projects} />
                    <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-2.5">
                        <label className="relative flex items-center">
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
                        <NotificationPopover />
                    </div>
                </header>
                <main className="min-h-0 flex-1">
                    <div className={cn("app-panel", immersive && "is-immersive")}>{children}</div>
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
    groups: "Collections",
    sessions: "Public sessions",
    workers: "Local models",
    team: "Team",
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Top-bar breadcrumb (reference: "</> Engineering › Workstreams"). Built
// from the path; resolves the project name when on a project route.
//
// Each crumb carries the href it stands for, so the trail is walkable rather
// than decorative. Every href here is a real route: the section indexes match
// the sidebar's own nav targets, and /projects|groups|sessions/[id] plus the
// project tabs all have pages.
type Crumb = { label: string; href: string }

function TopBreadcrumb({ projects }: { projects: Project[] }) {
    const pathname = usePathname()
    const segs = pathname.split("/").filter(Boolean)
    const crumbs: Crumb[] = []
    if (segs[0]) crumbs.push({ label: SECTION_LABEL[segs[0]] ?? cap(segs[0]), href: `/${segs[0]}` })
    if (segs[1]) {
        const href = `/${segs[0]}/${segs[1]}`
        if (segs[0] === "projects") crumbs.push({ label: projects.find((p) => p.id === segs[1])?.name ?? "Project", href })
        else if (segs[0] === "groups") crumbs.push({ label: "Collection", href })
        else if (segs[0] === "sessions") crumbs.push({ label: "Session", href })
    }
    if (segs[2]) crumbs.push({ label: cap(segs[2]), href: `/${segs[0]}/${segs[1]}/${segs[2]}` })
    if (crumbs.length === 0) crumbs.push({ label: "Home", href: "/" })

    return (
        <nav aria-label="Breadcrumb" className="hidden min-w-0 shrink items-center gap-1.5 sm:flex">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-[color:var(--c-surface)] text-[color:var(--c-text-muted)] shadow-[0_1px_1px_rgba(17,24,39,0.03)] ring-1 ring-[color:var(--c-border)]">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
                </svg>
            </span>
            {crumbs.map((c, i) => {
                // "Is this the page I'm on?" is href-vs-pathname, NOT "is it the last
                // crumb". On a detail route (/projects/x/issues/42) the trail stops at
                // "Issues", which is an ancestor, not where you are — keying off
                // last-ness would mark it current and leave the one link most worth
                // clicking inert.
                const current = c.href === pathname
                // Styling still keys off last-ness, so the trail keeps its existing
                // shape: a solid trailing crumb, muted ancestors.
                const style =
                    i === crumbs.length - 1
                        ? "max-w-[200px] truncate text-[12.5px] font-semibold text-[color:var(--c-text)]"
                        : "max-w-[140px] truncate text-[12.5px] font-medium text-[color:var(--c-text-muted)]"
                return (
                    <span key={c.href} className="flex min-w-0 items-center gap-1.5">
                        {i > 0 && <span className="text-[color:var(--c-text-dim)]" aria-hidden>›</span>}
                        {current ? (
                            <span aria-current="page" className={style}>{c.label}</span>
                        ) : (
                            <Link
                                href={c.href}
                                className={cn(style, "rounded-[4px] transition-colors hover:text-[color:var(--c-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-ring)]")}
                            >
                                {c.label}
                            </Link>
                        )}
                    </span>
                )
            })}
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
