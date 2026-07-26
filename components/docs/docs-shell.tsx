"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { cn } from "@/components/ui/cn"
import { DOC_NAV } from "@/components/docs/nav"

// Ucelot brand mark (mirrors app/page.tsx + sidebar.tsx). Kept inline so the
// docs chrome has no dependency on the authed app shell.
const BobbyMark = () => (
    <svg viewBox="0 0 106 102" xmlns="http://www.w3.org/2000/svg" aria-hidden className="h-full w-full">
        <path
            fill="currentColor"
            d="M 95.59375 67.023438 L 95.609375 17.179688 C 95.610001 12.229996 91.550003 8.239998 86.589996 8.339996 C 81.720001 8.43 77.919998 12.610001 77.919998 17.470001 L 77.921875 32.132813 C 77.919998 36.360001 74.559998 39.91 70.330002 39.950001 L 68.539063 39.84375 C 64.690002 39.32 61.84 35.979996 61.84 32.089996 L 61.84375 18.078125 C 61.84 14.139999 59.560001 10.470001 55.919998 8.959999 C 52.259998 7.440002 49.66 9.010002 47.189999 10.520004 C 44.529999 12.129997 36.509998 16.379997 36.509998 16.379997 L 36.03125 16.640625 L 35.546875 16.382813 C 35.549999 16.379997 27.440001 12.099998 25.32 10.770004 C 22.82 9.199997 20.280001 7.440002 16.540001 8.870003 C 12.78 10.309998 10.39 14.050003 10.39 18.089996 L 10.390625 67.023438 C 10.84 79.970001 21.459999 90.339996 34.509998 90.339996 L 71.492188 90.34375 C 84.540001 90.339996 95.160004 79.970001 95.59375 67.023438 Z M 23.25 40.460938 C 21.219999 39.689999 19.780001 37.729996 19.780001 35.419998 C 19.780001 33.110001 21.219999 31.150002 23.25 30.370003 C 23.860001 30.129997 24.52 30 25.200001 30 C 26.26 30 27.24 30.309998 28.08 30.839996 C 29.6 31.800003 30.610001 33.490005 30.610001 35.419998 C 30.610001 37.349998 29.6 39.049999 28.08 40 C 27.24 40.529999 26.26 40.830002 25.200001 40.830002 C 24.52 40.830002 23.860001 40.700001 23.25 40.460938 Z M 44.15625 39.609375 C 42.939999 38.619999 42.169998 37.110001 42.169998 35.419998 C 42.169998 33.729996 42.939999 32.220001 44.16 31.229996 C 45.09 30.459999 46.279999 30 47.580002 30 C 49.07 30 50.41 30.599998 51.389999 31.57 C 52.389999 32.559998 53 33.919998 53 35.419998 C 53 36.93 52.389999 38.279999 51.389999 39.259998 C 50.41 40.240002 49.07 40.830002 47.580002 40.830002 C 46.279999 40.830002 45.09 40.369999 44.15625 39.609375 Z M 34.507813 81.492188 C 26.360001 81.489998 19.68 75.07 19.26 67.019997 L 29.6875 67.023438 L 29.6875 60.148438 C 29.690001 58.169998 31.290001 56.57 33.27 56.57 L 42.1875 56.570313 C 44.169998 56.57 45.77 58.169998 45.77 60.150002 L 45.773438 67.023438 L 58.632813 67.023438 L 58.632813 60.148438 C 58.630001 58.169998 60.23 56.57 62.209999 56.57 L 71.132813 56.570313 C 73.110001 56.57 74.709999 58.169998 74.709999 60.150002 L 74.710938 67.023438 L 86.742188 67.023438 C 86.32 75.07 79.639999 81.489998 71.489998 81.489998 Z"
        />
    </svg>
)

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
    return (
        <div className="flex flex-col gap-6">
            {DOC_NAV.map((group) => (
                <div key={group.title}>
                    <div className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-dim)]">
                        {group.title}
                    </div>
                    <div className="flex flex-col gap-0.5">
                        {group.items.map((item) => {
                            const [base] = item.href.split("#")
                            const active = pathname === base
                            if (item.soon) {
                                return (
                                    <span
                                        key={item.href}
                                        className="flex items-center justify-between rounded-[9px] px-3 py-[7px] text-[13.5px] font-medium text-[color:var(--c-text-dim)]"
                                    >
                                        {item.label}
                                        <span className="rounded-full bg-[color:var(--c-surface-2)] px-1.5 py-[1px] text-[9.5px] font-bold uppercase tracking-wide text-[color:var(--c-text-dim)]">
                                            Soon
                                        </span>
                                    </span>
                                )
                            }
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    onClick={onNavigate}
                                    className={cn(
                                        "rounded-[9px] px-3 py-[7px] text-[13.5px] font-medium transition-colors",
                                        active
                                            ? "bg-zinc-900 text-white"
                                            : "text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-surface-2)] hover:text-[color:var(--c-text)]",
                                    )}
                                >
                                    {item.label}
                                </Link>
                            )
                        })}
                    </div>
                </div>
            ))}
        </div>
    )
}

export function DocsShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const [mobileOpen, setMobileOpen] = useState(false)

    return (
        <div className="min-h-screen bg-[color:var(--c-page)] text-[color:var(--c-text)]">
            {/* Top bar */}
            <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[color:var(--c-border)] bg-[color:var(--c-page)]/85 px-4 backdrop-blur-md sm:px-6">
                <Link href="/docs" className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-red-950 p-1.5 text-white">
                        <BobbyMark />
                    </span>
                    <span className="text-[15px] font-extrabold tracking-[-0.01em]">Ucelot</span>
                    <span className="rounded-full bg-[color:var(--c-surface-2)] px-2 py-[2px] text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--c-text-muted)]">
                        Docs
                    </span>
                </Link>
                <div className="ml-auto flex items-center gap-2">
                    <Link href="/" className="crumb hidden sm:inline-flex">
                        Home
                    </Link>
                    <Link href="/projects" className="btn-primary !py-1.5">
                        Open app
                    </Link>
                    <button
                        type="button"
                        aria-label="Toggle navigation"
                        onClick={() => setMobileOpen((v) => !v)}
                        className="grid h-8 w-8 place-items-center rounded-[8px] border border-[color:var(--c-border)] text-[color:var(--c-text-muted)] lg:hidden"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>
            </header>

            <div className="mx-auto flex w-full max-w-6xl">
                {/* Sidebar — desktop */}
                <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r border-[color:var(--c-border)] px-3 py-6 lg:block">
                    <NavList pathname={pathname} />
                </aside>

                {/* Sidebar — mobile drawer */}
                {mobileOpen && (
                    <div className="fixed inset-0 z-40 lg:hidden">
                        <div
                            className="absolute inset-0 bg-black/30"
                            onClick={() => setMobileOpen(false)}
                        />
                        <div className="absolute left-0 top-0 h-full w-72 overflow-y-auto border-r border-[color:var(--c-border)] bg-[color:var(--c-page)] px-3 py-6">
                            <NavList pathname={pathname} onNavigate={() => setMobileOpen(false)} />
                        </div>
                    </div>
                )}

                {/* Content */}
                <main className="min-w-0 flex-1 px-5 py-10 sm:px-10 lg:px-14">
                    <div className="mx-auto max-w-3xl">{children}</div>
                </main>
            </div>
        </div>
    )
}
