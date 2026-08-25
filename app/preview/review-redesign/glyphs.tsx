"use client"

import { cn } from "@/components/ui/cn"

// NOT named icon.tsx: inside app/ that filename is reserved by Next for
// generating a favicon route, and it fails the build asking for a default
// export.
//
// The SAME glyphs the GitHub comment badges draw (lib/shared/rendering/badge.ts
// ICON_PATHS), as an inline component.
//
// One vocabulary, deliberately. A review is read in two places — this panel and
// a GitHub comment — and the comment already speaks in these nine glyphs. If the
// panel invents its own, the same review looks like two different products, and
// the person who read it on GitHub has to re-learn it here.
//
// Keep this list in step with ICON_PATHS. It is short on purpose: nine glyphs
// that each mean one thing beats twenty that mean nearly the same.
export const ICONS = {
    check: <path d="M20 6L9 17l-5-5" />,
    x: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M15 9l-6 6M9 9l6 6" />
        </>
    ),
    chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
    search: (
        <>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
        </>
    ),
    alert: (
        <>
            <path d="M12 3l9 16H3z" />
            <path d="M12 10v4M12 17h.01" />
        </>
    ),
    code: <path d="M8 6l-5 6 5 6M16 6l5 6-5 6" />,
    list: (
        <>
            <path d="M9 6h11M9 12h11M9 18h11" />
            <path d="M4.5 5.5l1 1 1.6-1.9M4.5 11.5l1 1 1.6-1.9M4.5 17.5l1 1 1.6-1.9" />
        </>
    ),
    target: (
        <>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="4" />
        </>
    ),
    nodes: (
        <>
            <circle cx="6" cy="12" r="2.4" />
            <circle cx="18" cy="6" r="2.4" />
            <circle cx="18" cy="18" r="2.4" />
            <path d="M8.1 10.9l7.8-3.7M8.1 13.1l7.8 3.7" />
        </>
    ),
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 14, className }: { name: IconName; size?: number; className?: string }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("shrink-0", className)}
            aria-hidden
        >
            {ICONS[name]}
        </svg>
    )
}
