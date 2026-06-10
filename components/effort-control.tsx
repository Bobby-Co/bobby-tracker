"use client"

import { cn } from "@/components/cn"
import { ANALYSE_EFFORTS, type AnalyseEffort } from "@/lib/analyser"

// Short labels under the slider.
const EFFORT_LABEL: Record<AnalyseEffort, string> = {
    fast:     "Fast",
    medium:   "Medium",
    high:     "High",
    veryhigh: "Very High",
}

// The disclaimer shown beneath the slider — updates live as you drag past
// each stop. Frames the tradeoff: lower = quicker but shallower / less
// accurate; higher = a deeper dive with a richer, more accurate result.
const EFFORT_HINT: Record<AnalyseEffort, string> = {
    fast:     "Fast — a quick skim. Cheapest and fastest, but it can miss context and be less accurate. Best for simple, obvious bugs.",
    medium:   "Medium — a balanced pass. The default: solid depth without much extra time or cost.",
    high:     "High — digs deeper into the issue for a richer, more accurate analysis. Slower and more expensive.",
    veryhigh: "Very High — an exhaustive deep dive. The analyser explores the most before answering: the richest, most accurate result, but the slowest and priciest.",
}

// Caution tone for the lower, less-accurate end so the disclaimer reads as a
// warning there and as neutral guidance higher up.
function hintToneClass(level: AnalyseEffort): string {
    return level === "fast"
        ? "text-amber-700 dark:text-amber-400"
        : "text-[color:var(--c-text-muted)]"
}

// A 4-stop slider for picking an analyser effort level. Built as a custom
// track (rather than a bare <input type=range>) so the thumb, the per-stop
// tick lines, and the labels are ALL positioned by the same percentage — they
// line up exactly, which a native range thumb can't do because it insets
// itself by half its width at the extremes. A transparent native range sits
// on top to keep real drag + keyboard + a11y behaviour.
export function EffortControl({
    value,
    onChange,
    disabled,
    ariaLabel = "Analyser effort",
    hideHint = false,
    className,
}: {
    value: AnalyseEffort
    onChange: (next: AnalyseEffort) => void
    disabled?: boolean
    ariaLabel?: string
    /** Suppress the built-in disclaimer line (parent renders its own). */
    hideHint?: boolean
    className?: string
}) {
    const max = ANALYSE_EFFORTS.length - 1
    const index = Math.max(0, ANALYSE_EFFORTS.indexOf(value))
    const pct = (i: number) => `${(i / max) * 100}%`

    return (
        <div className={cn("w-full", disabled && "opacity-60", className)}>
            {/* mx-2 reserves half-a-thumb on each side so the thumb stays fully
                inside the box at the extremes while its CENTRE still travels the
                full 0–100% — the same range the ticks and labels are placed in. */}
            <div className="relative mx-2 h-4">
                {/* track */}
                <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                {/* filled portion up to the current stop */}
                <div
                    className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-zinc-900 dark:bg-zinc-100"
                    style={{ width: pct(index) }}
                />
                {/* per-stop tick lines */}
                {ANALYSE_EFFORTS.map((level, i) => (
                    <span
                        key={level}
                        aria-hidden
                        className={cn(
                            "absolute top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 rounded-full",
                            i <= index ? "bg-zinc-400 dark:bg-zinc-500" : "bg-zinc-300 dark:bg-zinc-600",
                        )}
                        style={{ left: pct(i) }}
                    />
                ))}
                {/* transparent native range — real interaction + keyboard + a11y.
                    Sits before the thumb so the thumb can pick up its focus ring
                    via peer-focus-visible. */}
                <input
                    type="range"
                    min={0}
                    max={max}
                    step={1}
                    value={index}
                    disabled={disabled}
                    onChange={(e) => onChange(ANALYSE_EFFORTS[Number(e.target.value)] ?? "medium")}
                    aria-label={ariaLabel}
                    aria-valuetext={EFFORT_LABEL[value]}
                    className="peer absolute inset-0 z-20 m-0 h-full w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-moz-range-thumb]:opacity-0 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:opacity-0"
                />
                {/* thumb (visual only; the input above drives it) */}
                <span
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-zinc-900 shadow ring-zinc-400 transition-shadow peer-focus-visible:ring-2 dark:border-zinc-950 dark:bg-zinc-100"
                    style={{ left: pct(index) }}
                />
            </div>

            {/* labels — positioned by the SAME pct() so each sits under its tick */}
            <div className="relative mx-2 mt-2.5 h-4">
                {ANALYSE_EFFORTS.map((level, i) => {
                    const active = value === level
                    // End labels align to their edge (so they don't overflow the
                    // box); interior labels centre on their tick.
                    const justify =
                        i === 0 ? "translate-x-0" : i === max ? "-translate-x-full" : "-translate-x-1/2"
                    return (
                        <button
                            key={level}
                            type="button"
                            disabled={disabled}
                            onClick={() => onChange(level)}
                            aria-pressed={active}
                            style={{ left: pct(i) }}
                            className={cn(
                                "absolute whitespace-nowrap text-[11px] font-semibold transition-colors disabled:cursor-not-allowed",
                                justify,
                                active
                                    ? "text-[color:var(--c-text)]"
                                    : "text-[color:var(--c-text-dim)] hover:text-[color:var(--c-text-muted)]",
                            )}
                        >
                            {EFFORT_LABEL[level]}
                        </button>
                    )
                })}
            </div>

            {!hideHint && (
                <p className={cn("mt-2 text-[11.5px] leading-4 transition-colors", hintToneClass(value))}>
                    {EFFORT_HINT[value]}
                </p>
            )}
        </div>
    )
}

export { EFFORT_LABEL, EFFORT_HINT, hintToneClass }
