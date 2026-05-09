"use client"

import { Suspense, lazy, type ComponentType } from "react"
import { findIcon } from "@/lib/iconly"
import { ICONLY_LOADERS, type IconlyComponentProps } from "@/lib/iconly-catalog"

// IconlyIcon — renders a glyph by canonical name.
//
// Lookup order:
//   1. New 361-icon catalog (icons/*.tsx) — lazy-imported per name so
//      we don't bundle all 361 components into every page that
//      shows a single icon.
//   2. Legacy lib/iconly.ts paths-based set — kept so DB rows
//      created before the catalog still render.
//   3. Tag-shaped placeholder fallback.
//
// All lazy components are constructed once at module init. lazy()
// is cheap — it doesn't kick off the dynamic import until the
// component is actually rendered — so wrapping all 361 entries up
// front gives us stable component identities (no churn on every
// render) without paying the import cost.
const LAZY_BY_NAME: Record<string, ComponentType<IconlyComponentProps>> =
    Object.fromEntries(
        Object.entries(ICONLY_LOADERS).map(([name, loader]) => [name, lazy(loader)]),
    )

export function IconlyIcon({
    name,
    size = 18,
    color,
    secondColor,
    className,
}: {
    name: string | null | undefined
    size?: number
    color?: string
    secondColor?: string
    className?: string
}) {
    const Lazy = name ? LAZY_BY_NAME[name] ?? null : null

    if (Lazy) {
        return (
            <span className={className} style={{ display: "inline-flex", width: size, height: size }}>
                <Suspense fallback={<Placeholder size={size} />}>
                    <Lazy size={size} color={color} secondColor={secondColor} />
                </Suspense>
            </span>
        )
    }

    // Legacy path-based icons (the original 40 in lib/iconly.ts).
    const legacy = findIcon(name)
    if (legacy) {
        return (
            <svg
                width={size}
                height={size}
                viewBox="0 0 24 24"
                aria-hidden
                className={className}
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="0"
            >
                {legacy.paths.map((d, i) => (
                    <path key={i} d={d} />
                ))}
            </svg>
        )
    }

    return <Placeholder size={size} className={className} />
}

function Placeholder({ size, className }: { size: number; className?: string }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            aria-hidden
            className={className}
            fill="currentColor"
        >
            <path d="M3 13V5a2 2 0 0 1 2-2h8l9 9-10 10L3 13Z" />
            <circle cx="7" cy="8" r="1.6" fill="white" />
        </svg>
    )
}
