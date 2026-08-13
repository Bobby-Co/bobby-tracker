"use client"

import { cn } from "@/components/ui/cn"
import { useApi } from "@/lib/client/hooks/use-api"
import { useTeam } from "@/lib/client/auth/team-context"

// The plan ladder — its own page (Settings → Usage & Billing → Change plan). Kept
// separate from the billing panel so that page stays about the CURRENT plan +
// spend; choosing a plan is a distinct decision. Copy/prices come from the server
// (modules/billing Tier) via /api/billing.

interface TierSpec {
    id: string
    name: string
    tagline: string
    monthlyPoints: number | null
    priceUsd: number | null
    seats: number | null
    features: string[]
}
interface LadderData {
    role: string
    balance: { tier: string }
    tiers: TierSpec[]
}

const TIER_ACCENT: Record<string, { wash: string; fg: string; dot: string }> = {
    kit:     { wash: "bg-[color:var(--c-surface-2)]", fg: "text-[color:var(--c-text-muted)]", dot: "bg-zinc-400" },
    prowler: { wash: "bg-amber-50",  fg: "text-amber-600",  dot: "bg-amber-500" },
    pride:   { wash: "bg-emerald-50", fg: "text-emerald-600", dot: "bg-emerald-500" },
    apex:    { wash: "bg-indigo-50", fg: "text-indigo-600", dot: "bg-indigo-500" },
}

function fmtPoints(n: number): string {
    const v = Math.max(0, Math.round(n))
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    if (v >= 10_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}k`
    return v.toLocaleString("en-US")
}

export function PlanLadder() {
    const { activeTeam } = useTeam()
    const path = activeTeam ? `/api/billing?t=${activeTeam.id}` : "/api/billing"
    const { data, error, loading } = useApi<LadderData>(path)

    if (loading && !data) return <LadderSkeleton />
    if (error) {
        return (
            <div className="rounded-[14px] border border-[color:var(--c-error-bg)] bg-[color:var(--c-error-bg)] px-4 py-3 text-[13px] text-[color:var(--c-error)]">
                Couldn’t load plans: {error}
            </div>
        )
    }
    if (!data) return null

    const isAdmin = data.role === "owner" || data.role === "admin"
    const current = data.balance.tier
    const currentIdx = data.tiers.findIndex((t) => t.id === current)

    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.tiers.map((t, i) => (
                <TierCard key={t.id} tier={t} isCurrent={t.id === current} isBelow={i < currentIdx} canManage={isAdmin} />
            ))}
        </div>
    )
}

function TierCard({ tier, isCurrent, isBelow, canManage }: { tier: TierSpec; isCurrent: boolean; isBelow: boolean; canManage: boolean }) {
    const accent = TIER_ACCENT[tier.id] ?? TIER_ACCENT.kit
    return (
        <article
            className={cn(
                "relative flex flex-col rounded-[16px] border bg-[color:var(--c-surface)] p-4 transition-colors",
                isCurrent ? "border-[color:var(--c-primary)] shadow-[0_0_0_1px_var(--c-primary)]" : "border-[color:var(--c-border)]",
            )}
        >
            {isCurrent && (
                <span className="absolute -top-2 right-3 rounded-full bg-[color:var(--c-primary)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    Current
                </span>
            )}
            <div className="flex items-center gap-2">
                <span className={cn("h-2.5 w-2.5 rounded-full", accent.dot)} />
                <h5 className="text-[15px] font-extrabold tracking-[-0.01em]">{tier.name}</h5>
            </div>
            <p className="mt-1 min-h-[32px] text-[11.5px] leading-snug text-[color:var(--c-text-muted)]">{tier.tagline}</p>

            <div className="mt-2 flex items-baseline gap-1">
                <span className="text-[22px] font-extrabold tracking-[-0.02em]">
                    {tier.priceUsd === null ? "Custom" : tier.priceUsd === 0 ? "Free" : `$${tier.priceUsd}`}
                </span>
                {tier.priceUsd !== null && tier.priceUsd > 0 && (
                    <span className="text-[12px] font-semibold text-[color:var(--c-text-dim)]">/mo</span>
                )}
            </div>
            <div className={cn("mt-2 rounded-[8px] px-2.5 py-1.5 text-[11.5px] font-bold", accent.wash, accent.fg)}>
                {tier.monthlyPoints === null ? "Unlimited credits" : `${fmtPoints(tier.monthlyPoints)} credits / mo`}
            </div>

            <ul className="mt-3 flex flex-1 flex-col gap-1.5">
                {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-[11.5px] text-[color:var(--c-text-muted)]">
                        <CheckIcon />
                        <span>{f}</span>
                    </li>
                ))}
            </ul>

            <button
                type="button"
                disabled={isCurrent || !canManage}
                title={!canManage && !isCurrent ? "Only a team admin can change the plan" : undefined}
                className={cn(
                    "mt-3.5 w-full rounded-[10px] px-3 py-2 text-[12.5px] font-bold transition-colors",
                    isCurrent
                        ? "cursor-default bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]"
                        : isBelow
                          ? "border border-[color:var(--c-border-strong)] text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-surface-2)] disabled:opacity-50"
                          : "bg-[color:var(--c-primary)] text-white hover:bg-[color:var(--c-primary-hover)] disabled:opacity-50",
                )}
            >
                {isCurrent ? "Current plan" : tier.priceUsd === null ? "Contact sales" : isBelow ? "Downgrade" : "Upgrade"}
            </button>
        </article>
    )
}

function CheckIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0 text-[color:var(--c-success)]" aria-hidden>
            <path d="M13 4.5 6.5 11 3 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function LadderSkeleton() {
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-72 w-full rounded-[16px]" />
            ))}
        </div>
    )
}
