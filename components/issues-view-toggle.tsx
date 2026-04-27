"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/components/cn"

export type IssuesView = "list" | "tile"

// Segmented control that switches between list and tile views. Keeps the
// state in the URL (?view=tile) so links are shareable and the choice
// survives a refresh without a localStorage round-trip.
export function IssuesViewToggle({ active }: { active: IssuesView }) {
    const pathname = usePathname()
    const params = useSearchParams()

    function hrefFor(view: IssuesView) {
        const q = new URLSearchParams(params)
        if (view === "list") q.delete("view")
        else q.set("view", view)
        const qs = q.toString()
        return qs ? `${pathname}?${qs}` : pathname
    }

    return (
        <div
            role="tablist"
            aria-label="Issue view"
            className="inline-flex items-center rounded-[10px] border border-[color:var(--c-border)] bg-white p-0.5"
        >
            <ToggleLink href={hrefFor("list")} active={active === "list"} label="List">
                <ListIcon />
            </ToggleLink>
            <ToggleLink href={hrefFor("tile")} active={active === "tile"} label="Tiles">
                <GridIcon />
            </ToggleLink>
        </div>
    )
}

function ToggleLink({
    href,
    active,
    label,
    children,
}: {
    href: string
    active: boolean
    label: string
    children: React.ReactNode
}) {
    return (
        <Link
            href={href}
            role="tab"
            aria-selected={active}
            aria-label={label}
            scroll={false}
            className={cn(
                "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] font-semibold transition-colors",
                active
                    ? "bg-zinc-900 text-white"
                    : "text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]",
            )}
        >
            {children}
            <span className="hidden sm:inline">{label}</span>
        </Link>
    )
}

function ListIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
    )
}
function GridIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="4" y="4" width="7" height="7" rx="1.5" />
            <rect x="13" y="4" width="7" height="7" rx="1.5" />
            <rect x="4" y="13" width="7" height="7" rx="1.5" />
            <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </svg>
    )
}
