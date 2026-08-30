"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/components/ui/cn"
import { useApi } from "@/lib/client/hooks/use-api"
import { useTeam } from "@/lib/client/auth/team-context"

// The always-visible credits balance pill — docked under the team selector
// in the sidebar (balance is team-scoped, so it belongs next to the team switch).
// One click to the full Usage & Billing page. Reads the lean /api/billing/balance
// (a single-row rollup lookup), so it's cheap to mount app-wide. Recolours by
// state: ember (healthy) → amber (low) → red (empty), or "Unlimited" for
// uncapped (Apex).
//
// Refreshes on an interval because credits are spent by work happening ELSEWHERE
// — an analyser run finishing, a review completing — with nothing to tell this
// tab about it. A number that silently goes stale is worse than no number: it
// reads as authoritative.
//
// It ALWAYS occupies its full height, even before a team is known. Returning null
// while loading is what made the sidebar jump twice on every team switch (which
// is a hard navigation, so the whole tree remounts): teams resolve, then the
// balance resolves, and the nav below is shoved down at each step.

export interface BalanceJSON {
    tierName: string
    allowance: number | null
    used: number
    remaining: number | null
    fraction: number
    isExhausted: boolean
    uncapped: boolean
}

function fmt(n: number): string {
    const v = Math.max(0, Math.round(n))
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    if (v >= 10_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}k`
    return v.toLocaleString("en-US")
}

export function BalancePill({ collapsed = false }: { collapsed?: boolean }) {
    const { activeTeam } = useTeam()
    const path = activeTeam ? `/api/billing/balance?t=${activeTeam.id}` : null
    const { data } = useApi<{ balance: BalanceJSON }>(path, { refreshMs: 30_000 })

    // Reserve the space unconditionally. `data` is deliberately NOT cleared while
    // a refresh is in flight, so a poll never blanks the pill — the previous
    // number stays until the next one lands.
    if (!data) return <BalancePillSkeleton collapsed={collapsed} />
    return <BalancePillView collapsed={collapsed} b={data.balance} />
}

// The pill's presentation, split from the fetch so previews/tests can drive it
// with a fabricated balance.
//
// ONE widget in two poses. Expanded, it's the classic two-row pill: the flame
// sits top-left with the credits reading beside it, and the segment bar runs
// below with the percentage on the right. Collapsed, the flame glides to the
// centre and the SAME dashes sweep along CURVED (polar) paths and wrap into a
// tangential ring around it — a real morph of the motif, not a swap.
//
// The flame + bar are the FuelGauge (a self-contained morph unit); the text
// rows are OVERLAID onto the gauge's empty top-right and bottom-right regions
// so they land on the flame's row and the bar's row, then fold away on collapse.
export function BalancePillView({ collapsed, b, loading = false }: { collapsed: boolean; b: BalanceJSON; loading?: boolean }) {
    // Loading wears the neutral (ember) box with a muted motif and shimmer text —
    // same element, same geometry, so it can't shift the layout when the real
    // number lands.
    const state: "ember" | "warn" | "error" = loading ? "ember" : b.isExhausted ? "error" : b.fraction >= 0.85 ? "warn" : "ember"
    const accent = loading
        ? "var(--c-border-strong)"
        : state === "error"
          ? "var(--c-error)"
          : state === "warn"
            ? "var(--c-warn)"
            : "var(--c-primary)"

    return (
        <Link
            href="/settings/billing"
            aria-hidden={loading || undefined}
            tabIndex={loading || collapsed ? -1 : undefined}
            aria-label={loading ? undefined : `Credits — ${b.uncapped ? "unlimited" : `${fmt(b.remaining ?? 0)} remaining`}. Open Usage and Billing.`}
            title={!loading && collapsed ? (b.uncapped ? "Unlimited credits" : `${fmt(b.remaining ?? 0)} credits · ${Math.round(b.fraction * 100)}% used`) : undefined}
            className={cn(
                // No horizontal padding: the flame's inset (open) and the ring's
                // rail-column alignment (closed) both ride on the gauge's own
                // rAF-driven shiftX, so nothing snaps on toggle.
                "group relative mt-1.5 flex shrink-0 items-center overflow-hidden transition-[background-color,border-color,width,height,border-radius] duration-300",
                loading && "pointer-events-none",
                collapsed
                    // w-9 matches the team avatar's footprint above (both left-biased
                    // in the rail); the ring's centre is placed by offsetCollapsed. Height
                    // stays 52px (same as open) so the nav below never shifts up on collapse.
                    ? "h-[52px] w-9 rounded-full border border-transparent bg-transparent"
                    : state === "error"
                      ? "h-[52px] w-full rounded-[12px] border border-[color:var(--c-error-bg)] bg-[color:var(--c-error-bg)] hover:border-[color:var(--c-error)]"
                      : state === "warn"
                        ? "h-[52px] w-full rounded-[12px] border border-[color:var(--c-warn-bg)] bg-[color:var(--c-warn-bg)] hover:border-[color:var(--c-warn)]"
                        : "h-[52px] w-full rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] hover:border-[color:var(--c-border-strong)]",
            )}
        >
            {/* offsetExpanded insets the flame from the pill's left edge; offsetCollapsed
                (-6) slides the ring left so its centre sits on the rail's icon column. */}
            <FuelGauge collapsed={collapsed} b={b} accent={accent} offsetExpanded={8} offsetCollapsed={-6} />
            <span
                className={cn(
                    "pointer-events-none absolute inset-y-0 left-[38px] right-2.5 flex flex-col justify-center gap-[7px] whitespace-nowrap transition-opacity duration-300",
                    collapsed ? "opacity-0" : "opacity-100 delay-150",
                )}
            >
                {/* Top row — sits on the flame's row */}
                <span className="flex items-center leading-none">
                    {loading ? (
                        <span className="skeleton h-[13px] w-[88px] rounded-[4px]" />
                    ) : (
                        <span className="truncate text-[12.5px] font-semibold" style={{ color: state === "ember" ? "var(--c-text)" : accent }}>
                            {b.uncapped ? "Unlimited" : fmt(b.remaining ?? 0)}
                            {!b.uncapped && <span className="ml-1 font-medium text-[color:var(--c-text-dim)]">credits</span>}
                        </span>
                    )}
                    {!loading && <Chevron className="ml-auto shrink-0 text-[color:var(--c-text-dim)] transition-transform duration-200 group-hover:translate-x-0.5" />}
                </span>
                {/* Bottom row — sits on the bar's row, percentage on the right */}
                <span className="flex items-center leading-none">
                    {loading ? (
                        <span className="skeleton ml-auto h-[10px] w-[28px] rounded-[3px]" />
                    ) : (
                        <span className="ml-auto text-[10.5px] font-semibold tabular-nums" style={{ color: state === "ember" ? "var(--c-text-dim)" : accent }}>
                            {b.uncapped ? `${fmt(b.used)} spent` : b.isExhausted ? "Empty" : `${Math.round(b.fraction * 100)}%`}
                        </span>
                    )}
                </span>
            </span>
        </Link>
    )
}

function Chevron({ className }: { className?: string }) {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

// The morphing meter. The .seg motif is a DASH; expanded, the dashes lie in a
// straight row below the flame, collapsed they wrap into a tangential ring.
//
// The wrap is interpolated in POLAR space (each dash's radius + angle around the
// ring centre), driven by rAF — a plain CSS transform transition tweens as a
// matrix, so the far dashes would cut STRAIGHT across the middle (a "fold").
// Sweeping the angle instead sends each dash ALONG an arc, the short way, so the
// row curls up and around into the ring. The flame glides to the centre and
// scales down to nest inside. Static gauges (collapsed never changes) don't run
// the loop.
const SEG_N = 12
const GAUGE_H = 48
const GAUGE_W_EXP = 104 // holds the straight bar
const GAUGE_W_COL = 48 // the ring
const CX = 24 // morph centre — ring middle + where the flame lands
const CY = 24
const RING_R = 15
const BAR_GAP = 8 // dash pitch in the straight row
const BAR_X0 = -16 // leftmost dash offset from centre
const BAR_Y = 13 // row sits this far below centre
const FLAME_SIZE = 16
const FLAME_COL_SCALE = 1.15 // collapsed the flame fills the ring, so it reads at a glance
const FLAME_DX = -9 // expanded offset from centre → top-left
const FLAME_DY = -10
const MORPH_MS = 520
// Sequencing: the leftmost dash leads, each one behind it starts a little later,
// so the row curls into the ring like a rope being coiled rather than all the
// dashes moving at once. This is the fraction of the timeline spent spreading
// the start times across the dashes; the rest is each dash's own travel.
const STAGGER = 0.5

function easeInOut(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function FuelGauge({
    collapsed,
    b,
    accent,
    offsetExpanded = 0,
    offsetCollapsed = 0,
}: {
    collapsed: boolean
    b: BalanceJSON
    accent: string
    // Horizontal nudge of the whole gauge, in px, at each pose — interpolated by
    // the SAME rAF progress as the morph so the slide has ONE timing source (no
    // CSS padding/justify snap). The pill uses this to inset the flame when open
    // and re-centre the ring on the rail's icon column when closed.
    offsetExpanded?: number
    offsetCollapsed?: number
}) {
    const onCount = b.uncapped ? SEG_N : Math.min(SEG_N, Math.max(b.fraction > 0 ? 1 : 0, Math.round(b.fraction * SEG_N)))

    // Progress 0 = row, 1 = ring. In state so the render reads it; mirrored to a
    // ref so the rAF loop can read the latest value as its start point.
    const [p, setP] = useState(collapsed ? 1 : 0)
    const pRef = useRef(p)
    useEffect(() => {
        pRef.current = p
    }, [p])
    const rafRef = useRef<number | null>(null)

    useEffect(() => {
        const goal = collapsed ? 1 : 0
        const from = pRef.current
        if (from === goal) return
        const startAt = performance.now()
        const step = (now: number) => {
            const t = Math.min(1, (now - startAt) / MORPH_MS)
            // Store LINEAR progress; the easing (global + per-dash) is applied in
            // render, so the stagger can offset each dash before easing.
            setP(from + (goal - from) * t)
            rafRef.current = t < 1 ? requestAnimationFrame(step) : null
        }
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(step)
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
            rafRef.current = null
        }
    }, [collapsed])

    const gp = easeInOut(p) // global eased progress — flame + box
    const width = GAUGE_W_EXP + (GAUGE_W_COL - GAUGE_W_EXP) * gp
    const shiftX = offsetExpanded + (offsetCollapsed - offsetExpanded) * gp
    const dashDur = 1 - STAGGER

    return (
        <span
            className="relative block shrink-0"
            style={{ width, height: GAUGE_H, transform: shiftX ? `translateX(${shiftX.toFixed(2)}px)` : undefined }}
            aria-hidden
        >
            {Array.from({ length: SEG_N }).map((_, i) => {
                const on = i < onCount
                // This dash's own progress lags the one to its left, so the row
                // coils into the ring in sequence (leftmost first).
                const startI = (i / (SEG_N - 1)) * STAGGER
                const pi = easeInOut(Math.min(1, Math.max(0, (p - startI) / dashDur)))
                // Start: its spot in the straight row (radius + angle from centre).
                // End: its tangent spot on the ring rim. Interpolate both, sweeping
                // the angle the SHORT way, so it arcs into place.
                const xExp = BAR_X0 + i * BAR_GAP
                const rStart = Math.hypot(xExp, BAR_Y)
                const aStart = Math.atan2(BAR_Y, xExp)
                const psi = -(i / SEG_N) * 2 * Math.PI // ring angle — wind up the LEFT side from top (mirrored)
                const aEnd = Math.atan2(-RING_R * Math.cos(psi), RING_R * Math.sin(psi))
                let d = aEnd - aStart
                while (d > Math.PI) d -= 2 * Math.PI
                while (d < -Math.PI) d += 2 * Math.PI
                const a = aStart + d * pi
                const r = rStart + (RING_R - rStart) * pi
                const px = CX + r * Math.cos(a)
                const py = CY + r * Math.sin(a)
                const rot = (psi * 180) / Math.PI // final tangent; dash is symmetric so amount is cosmetic
                return (
                    <span
                        key={i}
                        className="absolute left-0 top-0 h-[3px] w-[7px] rounded-full"
                        style={{
                            transform: `translate(${px.toFixed(2)}px, ${py.toFixed(2)}px) translate(-50%,-50%) rotate(${(rot * pi).toFixed(1)}deg)`,
                            transformOrigin: "center",
                            backgroundColor: on ? accent : "var(--c-border-strong)",
                            opacity: on ? 1 : 0.5,
                            transition: "background-color 300ms ease, opacity 300ms ease",
                        }}
                    />
                )
            })}
            <span
                className="absolute left-0 top-0"
                style={{
                    transform: `translate(${(CX + FLAME_DX * (1 - gp)).toFixed(2)}px, ${(CY + FLAME_DY * (1 - gp)).toFixed(2)}px) translate(-50%,-50%) scale(${(1 + (FLAME_COL_SCALE - 1) * gp).toFixed(3)})`,
                    transformOrigin: "center",
                }}
            >
                <FlameIcon off={b.isExhausted} color={accent} size={FLAME_SIZE} />
            </span>
        </span>
    )
}

// The loaded pill's markup in a loading pose — NOT an approximation of it. It
// renders the very SAME BalancePillView (muted motif + shimmer text), so its
// geometry is identical by construction and the real number can't shift the
// layout when it lands. A blank balance keeps every dash off and the flame muted.
const BLANK_BALANCE: BalanceJSON = {
    tierName: "",
    allowance: null,
    used: 0,
    remaining: 0,
    fraction: 0,
    isExhausted: false,
    uncapped: false,
}

export function BalancePillSkeleton({ collapsed = false }: { collapsed?: boolean }) {
    return <BalancePillView collapsed={collapsed} b={BLANK_BALANCE} loading />
}

function FlameIcon({ off, color, size = 14 }: { off?: boolean; color: string; size?: number }) {
    if (off) {
        return (
            <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden style={{ color }}>
                <path d="M8 2c2 2.5 3.5 4 3.5 6.5A3.5 3.5 0 0 1 8 12a3.5 3.5 0 0 1-3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
                <path d="M2.5 2.5l11 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
        )
    }
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden style={{ color }}>
            <path
                d="M8 1.5c2.2 2.8 3.8 4.4 3.8 7A3.8 3.8 0 1 1 4.2 8.5c0-.9.3-1.7.8-2.4.3 1 .9 1.6 1.7 1.8-.3-2 .5-3.6 1.3-4.4Z"
                fill="currentColor"
            />
        </svg>
    )
}
