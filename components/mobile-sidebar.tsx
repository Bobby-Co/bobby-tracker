"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { SidebarContent } from "@/components/sidebar"
import type { Project } from "@/lib/supabase/types"

interface Props {
    projects: Project[]
    activeProjectId?: string
}

// MobileSidebar — hamburger button + slide-from-left drawer.
// Hidden at md+ (the desktop Sidebar takes over). Closes on Esc, on
// backdrop tap, and on link tap (via SidebarContent.onNavigate). The
// SidebarContent's onNavigate handles the link-tap path; route changes
// triggered any other way (back button, programmatic) get caught by
// the close-on-pathname-change effect below.
export function MobileSidebar({ projects, activeProjectId }: Props) {
    const [open, setOpen] = useState(false)
    const pathname = usePathname()

    // Close when the route changes. setState-in-effect is the right
    // pattern here — the navigation IS the external event we're
    // synchronising against — so suppress the React 19 lint rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { setOpen(false) }, [pathname])

    // Esc + body-scroll-lock while open.
    useEffect(() => {
        if (!open) return
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") setOpen(false)
        }
        document.addEventListener("keydown", onKey)
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            document.removeEventListener("keydown", onKey)
            document.body.style.overflow = prev
        }
    }, [open])

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Open menu"
                aria-expanded={open}
                className="grid h-9 w-9 place-items-center rounded-[10px] border border-[color:var(--c-border)] bg-white text-[color:var(--c-text)] transition-colors hover:bg-[color:var(--c-surface-2)] md:hidden"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                    <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
            </button>

            {open && (
                <div role="dialog" aria-modal="true" aria-label="Sidebar" className="fixed inset-0 z-50 md:hidden">
                    {/* backdrop */}
                    <button
                        type="button"
                        aria-label="Close menu"
                        onClick={() => setOpen(false)}
                        className="anim-fade absolute inset-0 cursor-default bg-zinc-950/35 backdrop-blur-[2px]"
                    />
                    {/* drawer */}
                    <aside
                        onClick={(e) => e.stopPropagation()}
                        className="anim-rise relative h-full w-72 max-w-[80vw] border-r border-[color:var(--c-border)] bg-white shadow-[var(--shadow-pop)]"
                        style={{ ["--i" as string]: 0 } as React.CSSProperties}
                    >
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            aria-label="Close menu"
                            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-md text-[color:var(--c-text-dim)] hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                                <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </button>
                        <SidebarContent
                            projects={projects}
                            activeProjectId={activeProjectId}
                            onNavigate={() => setOpen(false)}
                        />
                    </aside>
                </div>
            )}
        </>
    )
}
