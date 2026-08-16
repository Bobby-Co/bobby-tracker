"use client"

import Link from "next/link"
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

interface BalanceJSON {
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

export function BalancePill() {
    const { activeTeam } = useTeam()
    const path = activeTeam ? `/api/billing/balance?t=${activeTeam.id}` : null
    const { data } = useApi<{ balance: BalanceJSON }>(path, { refreshMs: 30_000 })

    // Reserve the space unconditionally. `data` is deliberately NOT cleared while
    // a refresh is in flight, so a poll never blanks the pill — the previous
    // number stays until the next one lands.
    if (!data) return <BalancePillSkeleton />
    const b = data.balance

    const state: "ember" | "warn" | "error" = b.isExhausted ? "error" : b.fraction >= 0.85 ? "warn" : "ember"
    const accent =
        state === "error"
            ? "var(--c-error)"
            : state === "warn"
              ? "var(--c-warn)"
              : "var(--c-primary)"

    return (
        <Link
            href="/settings/billing"
            aria-label={`Credits — ${b.uncapped ? "unlimited" : `${fmt(b.remaining ?? 0)} remaining`}. Open Usage and Billing.`}
            className={cn(
                "group mt-1.5 block rounded-[10px] border px-2.5 py-2 transition-colors",
                state === "error"
                    ? "border-[color:var(--c-error-bg)] bg-[color:var(--c-error-bg)] hover:border-[color:var(--c-error)]"
                    : state === "warn"
                      ? "border-[color:var(--c-warn-bg)] bg-[color:var(--c-warn-bg)] hover:border-[color:var(--c-warn)]"
                      : "border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] hover:border-[color:var(--c-border-strong)]",
            )}
        >
            <div className="flex items-center gap-1.5">
                <FlameIcon off={b.isExhausted} color={accent} />
                <span className="flex-1 truncate text-[12px] font-semibold" style={{ color: state === "ember" ? "var(--c-text)" : accent }}>
                    {b.uncapped ? "Unlimited" : `${fmt(b.remaining ?? 0)} `}
                    {!b.uncapped && <span className="font-medium text-[color:var(--c-text-dim)]">credits</span>}
                </span>
                {b.isExhausted && (
                    <span className="rounded-full bg-[color:var(--c-error)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                        Upgrade
                    </span>
                )}
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden className="text-[color:var(--c-text-dim)]">
                    <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>

            {!b.uncapped && (
                <div className="mt-1.5 flex items-center gap-2">
                    <SegRow fraction={b.fraction} used={b.used} color={accent} />
                    <span
                        className="ml-auto shrink-0 text-[10px] font-semibold tabular-nums"
                        style={{ color: state === "ember" ? "var(--c-text-dim)" : accent }}
                    >
                        {b.isExhausted ? "Empty" : `${Math.round(b.fraction * 100)}%`}
                    </span>
                </div>
            )}
            {b.uncapped && (
                <div className="mt-1 text-[10px] text-[color:var(--c-text-dim)]">Uncapped · {fmt(b.used)} spent</div>
            )}
        </Link>
    )
}

// The loaded pill's markup with the values blanked — NOT an approximation of it.
//
// The first version used fixed-height bars (h-[12px]) where the real pill has
// text, and a text node's line box is taller than the bar someone picks to stand
// in for it. That reserved 48px against a real 57px and left a 9px jump: a
// skeleton that is only roughly the right size is a layout shift with extra
// steps.
//
// So this reuses the same classes and REAL glyphs, made transparent. Line-height,
// font metrics and padding then resolve identically by construction, and the two
// cannot drift apart when the pill is restyled — anything that changes its height
// changes this the same way.
function BalancePillSkeleton() {
    return (
        <div
            aria-hidden
            className="mt-1.5 block rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-2.5 py-2"
        >
            <div className="flex items-center gap-1.5">
                <span className="skeleton h-[14px] w-[14px] shrink-0 rounded-[3px]" />
                <span className="flex-1 truncate text-[12px] font-semibold text-transparent">
                    <span className="skeleton rounded-[3px]">0,000 credits</span>
                </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
                {/* The real meter, all ticks off — same element, same height. */}
                <span className="flex items-center gap-[3px]">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <span key={i} className="h-[8px] w-[5px] shrink-0 rounded-[2px] bg-[color:var(--c-border-strong)]" />
                    ))}
                </span>
                <span className="ml-auto shrink-0 text-[10px] font-semibold tabular-nums text-transparent">
                    <span className="skeleton rounded-[3px]">00%</span>
                </span>
            </div>
        </div>
    )
}

// The segmented block meter — fixed short ticks (the app's .seg motif, a touch
// shorter to suit the pill). Filled ticks take the state colour; empties stay
// faint. Sits inline with the percent so the row reads as one compact unit.
function SegRow({ fraction, used, color }: { fraction: number; used: number; color: string }) {
    const N = 12
    const on = Math.min(N, Math.max(used > 0 ? 1 : 0, Math.round(fraction * N)))
    return (
        <span className="flex items-center gap-[3px]" aria-hidden>
            {Array.from({ length: N }).map((_, i) => (
                <span
                    key={i}
                    className="h-[8px] w-[5px] shrink-0 rounded-[2px]"
                    style={{ background: i < on ? color : "var(--c-border-strong)" }}
                />
            ))}
        </span>
    )
}

function FlameIcon({ off, color }: { off?: boolean; color: string }) {
    if (off) {
        return (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden style={{ color }}>
                <path d="M8 2c2 2.5 3.5 4 3.5 6.5A3.5 3.5 0 0 1 8 12a3.5 3.5 0 0 1-3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
                <path d="M2.5 2.5l11 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
        )
    }
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden style={{ color }}>
            <path
                d="M8 1.5c2.2 2.8 3.8 4.4 3.8 7A3.8 3.8 0 1 1 4.2 8.5c0-.9.3-1.7.8-2.4.3 1 .9 1.6 1.7 1.8-.3-2 .5-3.6 1.3-4.4Z"
                fill="currentColor"
            />
        </svg>
    )
}
