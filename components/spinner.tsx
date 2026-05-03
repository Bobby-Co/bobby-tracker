import { cn } from "@/components/cn"

// Tiny inline spinner. Inherits color from parent (use text-* on the
// caller). Sizes default to 14px to slot into our 13px buttons.
export function Spinner({ className, size = 14 }: { className?: string; size?: number }) {
    return (
        <svg
            className={cn("animate-spin", className)}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
        >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.22" />
            <path
                d="M21 12a9 9 0 0 0-9-9"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
            />
        </svg>
    )
}
