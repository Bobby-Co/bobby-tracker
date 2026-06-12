import { cn } from "@/components/cn"

// Tiny presentational online/offline indicator. Online renders a green
// dot with a soft pulsing ring; offline is a flat grey dot. The label is
// optional — pass showLabel to render "Online"/"Offline" beside it.
export function RelayStatusDot({
    online,
    showLabel = true,
    className,
}: {
    online: boolean
    showLabel?: boolean
    className?: string
}) {
    return (
        <span className={cn("inline-flex items-center gap-1.5", className)}>
            <span className="relative inline-flex h-2 w-2 shrink-0">
                {online && (
                    <span
                        aria-hidden
                        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                        style={{ background: "var(--c-success)" }}
                    />
                )}
                <span
                    aria-hidden
                    className="relative inline-flex h-2 w-2 rounded-full"
                    style={{ background: online ? "var(--c-success)" : "var(--c-text-dim)" }}
                />
            </span>
            {showLabel && (
                <span
                    className="text-[11.5px] font-semibold"
                    style={{ color: online ? "var(--c-success)" : "var(--c-text-dim)" }}
                >
                    {online ? "Online" : "Offline"}
                </span>
            )}
        </span>
    )
}
