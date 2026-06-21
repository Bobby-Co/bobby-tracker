"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth/auth-context"
import { isAllowed } from "@/lib/auth/access"
import { useApi } from "@/lib/hooks/use-api"
import { Sidebar } from "@/components/sidebar"
import { MobileSidebar } from "@/components/mobile-sidebar"
import type { Project } from "@/lib/supabase/types"

// Auth-gated app shell — now a client guard instead of a server
// component. useAuth() owns the session; an unauthenticated visitor is
// redirected to /login. The sidebar's project list comes from
// /api/projects (cookie-authed) rather than a direct server query.
//
// The guard is UX only: RLS at the database is the real boundary, and
// every route handler re-checks the user via requireUser().
export default function AppLayout({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth()
    const router = useRouter()
    const pathname = usePathname()

    useEffect(() => {
        if (loading) return
        if (!user) {
            const next = encodeURIComponent(pathname || "/projects")
            router.replace(`/login?next=${next}`)
            return
        }
        // Signed in but not on the beta whitelist → coming-soon page.
        if (!isAllowed(user)) router.replace("/waitlist")
    }, [loading, user, pathname, router])

    // Only fetch the sidebar list once we know there's a user — avoids a
    // throwaway 401 during the initial session read / redirect.
    const { data } = useApi<{ projects: Project[] }>("/api/projects", {
        enabled: !!user,
    })
    const projects = data?.projects ?? []

    // Still resolving the session, or mid-redirect to /login or /waitlist.
    // Show the shell skeleton rather than flashing protected content.
    if (loading || !user || !isAllowed(user)) {
        return <ShellSkeleton />
    }

    return (
        <div className="flex h-screen w-full bg-white text-[color:var(--c-text)]">
            <Sidebar projects={projects} />
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-[color:var(--c-border)] bg-white px-3 sm:gap-3 sm:px-5">
                    <MobileSidebar projects={projects} />
                    <TopBreadcrumb projects={projects} />
                    <span className="hidden h-4 w-px shrink-0 bg-[color:var(--c-border)] sm:block" />
                    <label className="relative flex w-full max-w-md items-center">
                        <span className="pointer-events-none absolute left-3 grid place-items-center text-[color:var(--c-text-dim)]">
                            <SearchIcon />
                        </span>
                        <input
                            type="search"
                            aria-label="Search"
                            placeholder="Search…"
                            className="h-9 w-full rounded-[10px] border border-transparent bg-[color:var(--c-surface-2)] pl-9 pr-3 text-[13px] text-[color:var(--c-text)] placeholder:text-[color:var(--c-text-dim)] transition-colors hover:bg-[color:var(--c-overlay)] focus:border-zinc-900 focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-zinc-900/8"
                        />
                    </label>
                </header>
                <main className="flex-1 overflow-auto bg-[color:var(--c-page)]">{children}</main>
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
        <nav aria-label="Breadcrumb" className="hidden min-w-0 shrink-0 items-center gap-1.5 sm:flex">
            <span className="grid h-6 w-6 place-items-center rounded-[6px] bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
                </svg>
            </span>
            {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-[color:var(--c-text-dim)]" aria-hidden>›</span>}
                    <span
                        className={
                            i === crumbs.length - 1
                                ? "max-w-[160px] truncate text-[12.5px] font-semibold text-[color:var(--c-text)]"
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

function ShellSkeleton() {
    return (
        <div className="flex h-screen w-full bg-white">
            <aside
                aria-busy
                className="hidden w-64 shrink-0 flex-col border-r border-[color:var(--c-border)] bg-white sm:flex"
            >
                <div className="flex h-14 items-center gap-2.5 border-b border-[color:var(--c-border)] px-3.5">
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
                <header className="flex h-14 items-center border-b border-[color:var(--c-border)] bg-white px-3 sm:px-5">
                    <div className="skeleton h-9 w-full max-w-md rounded-[10px]" />
                </header>
                <main className="flex-1 overflow-auto bg-[color:var(--c-page)]" />
            </div>
        </div>
    )
}
