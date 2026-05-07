import { findIcon } from "@/lib/iconly"

// IconlyIcon — renders a glyph from lib/iconly.ts. Falls back to a
// neutral tag-shaped placeholder when the name doesn't resolve so
// the timeline still draws something while the user assigns icons.
export function IconlyIcon({
    name,
    size = 18,
    className,
}: {
    name: string | null | undefined
    size?: number
    className?: string
}) {
    const icon = findIcon(name)
    if (!icon) {
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
            {icon.paths.map((d, i) => (
                <path key={i} d={d} />
            ))}
        </svg>
    )
}
