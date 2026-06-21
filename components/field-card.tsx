import type { ReactNode } from "react"
import { cn } from "@/components/cn"

// Shared minimal-card primitives — the visual language pulled from the
// reference board: a circular tinted glyph, a title + subtitle, and a
// bordered "field table" of label→value rows. Every dashboard card
// (issues, projects, sessions, groups, workers) is composed from these
// so the whole app reads with one calm, minimal density.

export type Tone =
    | "blue" | "amber" | "rose" | "emerald" | "violet" | "indigo" | "cyan" | "zinc"

// Soft tinted background + saturated foreground, echoing the ref's
// colourful per-card avatars.
const TONE: Record<Tone, string> = {
    blue:    "bg-blue-50 text-blue-600",
    amber:   "bg-amber-50 text-amber-600",
    rose:    "bg-rose-50 text-rose-600",
    emerald: "bg-emerald-50 text-emerald-600",
    violet:  "bg-violet-50 text-violet-600",
    indigo:  "bg-indigo-50 text-indigo-600",
    cyan:    "bg-cyan-50 text-cyan-600",
    zinc:    "bg-zinc-100 text-zinc-500",
}

// Solid, saturated fill with a white glyph — the bolder avatar treatment
// from the reference board (a vermilion / ink circle with a white mark).
// A faint same-tone ring + inner highlight gives the disc a little depth.
const TONE_SOLID: Record<Tone, string> = {
    blue:    "bg-blue-500 text-white ring-1 ring-inset ring-white/15",
    amber:   "bg-amber-500 text-white ring-1 ring-inset ring-white/15",
    rose:    "bg-rose-500 text-white ring-1 ring-inset ring-white/15",
    emerald: "bg-emerald-500 text-white ring-1 ring-inset ring-white/15",
    violet:  "bg-violet-500 text-white ring-1 ring-inset ring-white/15",
    indigo:  "bg-indigo-500 text-white ring-1 ring-inset ring-white/15",
    cyan:    "bg-cyan-500 text-white ring-1 ring-inset ring-white/15",
    zinc:    "bg-zinc-900 text-white ring-1 ring-inset ring-white/10",
}

// Deterministic tone from a seed string (e.g. a project name) so each
// card gets a stable, colourful glyph like the reference board — without
// hand-assigning colours.
const TONE_CYCLE: Tone[] = ["blue", "violet", "emerald", "amber", "rose", "indigo", "cyan"]
export function toneFromString(seed: string): Tone {
    let h = 0
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
    return TONE_CYCLE[h % TONE_CYCLE.length]
}

export function MiniIcon({
    tone = "zinc",
    size = 36,
    solid = false,
    className,
    children,
}: {
    tone?: Tone
    size?: number
    /** Bold reference treatment: saturated fill + white glyph. */
    solid?: boolean
    className?: string
    children: ReactNode
}) {
    return (
        <span
            className={cn("mini-icon", (solid ? TONE_SOLID : TONE)[tone], className)}
            style={{ width: size, height: size }}
            aria-hidden
        >
            {children}
        </span>
    )
}

export function FieldTable({
    children,
    className,
}: {
    children: ReactNode
    className?: string
}) {
    return <div className={cn("field-table", className)}>{children}</div>
}

export function FieldRow({
    icon,
    label,
    children,
}: {
    icon?: ReactNode
    label: ReactNode
    children: ReactNode
}) {
    return (
        <div className="field-row">
            <span className="field-label">
                {icon}
                {label}
            </span>
            <span className="field-value">{children}</span>
        </div>
    )
}

// Segmented progress — discrete ticks like the ref's "12/32" header bars.
export function SegBar({
    value,
    total,
    max = 12,
    className,
}: {
    value: number
    total: number
    max?: number
    className?: string
}) {
    const count = Math.min(max, Math.max(total, 1))
    const on = total > 0 ? Math.round((value / total) * count) : 0
    return (
        <span className={cn("seg-track", className)} aria-hidden>
            {Array.from({ length: count }).map((_, i) => (
                <span key={i} className={cn("seg", i < on && "seg-on")} />
            ))}
        </span>
    )
}

// MiniCard — the canonical card shell: tinted icon + title/subtitle row,
// an optional body (usually a <FieldTable>) and an optional footer.
export function MiniCard({
    tone = "zinc",
    icon,
    iconSize,
    iconSolid = false,
    title,
    subtitle,
    badge,
    menu,
    children,
    footer,
    className,
    interactive = true,
}: {
    tone?: Tone
    icon: ReactNode
    iconSize?: number
    /** Render the glyph as a bold saturated disc (reference style). */
    iconSolid?: boolean
    title: ReactNode
    subtitle?: ReactNode
    badge?: ReactNode
    menu?: ReactNode
    children?: ReactNode
    footer?: ReactNode
    className?: string
    interactive?: boolean
}) {
    return (
        <article className={cn("card flex h-full flex-col", interactive && "card-hover", className)}>
            <div className="flex items-start gap-3">
                <MiniIcon tone={tone} size={iconSize} solid={iconSolid}>
                    {icon}
                </MiniIcon>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                        <h3 className="line-clamp-2 min-w-0 flex-1 text-[14px] font-bold leading-snug tracking-[-0.005em] text-[color:var(--c-text)]">
                            {title}
                        </h3>
                        {badge}
                        {menu}
                    </div>
                    {subtitle && (
                        <div className="mt-0.5 truncate text-[11.5px] font-semibold text-[color:var(--c-text-dim)]">
                            {subtitle}
                        </div>
                    )}
                </div>
            </div>
            {children && <div className="mt-3 flex flex-1 flex-col gap-2.5">{children}</div>}
            {footer && <div className="card-footer">{footer}</div>}
        </article>
    )
}
