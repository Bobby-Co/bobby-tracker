"use client"

import { useMemo } from "react"
import { cn } from "@/components/ui/cn"
import { useApi } from "@/lib/client/hooks/use-api"
import { useTeam } from "@/lib/client/auth/team-context"

// Prowl — the Usage & Billing panel. Driven entirely by GET /api/billing (which
// resolves the active team). Shows the current tier + Prowl Point meter, the plan
// ladder, and this period's usage breakdown + recent calls. Copy/prices come from
// the server (modules/billing Tier) so this file owns no pricing truth.

// ─── wire shapes (mirror the /api/billing payload) ───────────────────────────
interface TierSpec {
    id: string
    name: string
    tagline: string
    monthlyPoints: number | null
    priceUsd: number | null
    seats: number | null
    features: string[]
}
interface BalanceJSON {
    tier: string
    tierName: string
    allowance: number | null
    used: number
    remaining: number | null
    fraction: number
    isExhausted: boolean
    uncapped: boolean
    periodStart: string
    periodEnd: string
}
interface UsageByKind { kind: string; points: number; calls: number }
interface UsageEventRow {
    id: string
    kind: string
    model: string | null
    points: number
    cost_usd: number | null
    created_at: string
}
interface BillingSummary {
    role: string
    status: string
    balance: BalanceJSON
    breakdown: UsageByKind[]
    recent: UsageEventRow[]
    tiers: TierSpec[]
}

// Per-tier accent (background wash / foreground) — echoes the app's colour chips.
const TIER_ACCENT: Record<string, { wash: string; fg: string; dot: string }> = {
    kit:     { wash: "bg-[color:var(--c-surface-2)]", fg: "text-[color:var(--c-text-muted)]", dot: "bg-zinc-400" },
    prowler: { wash: "bg-amber-50",  fg: "text-amber-600",  dot: "bg-amber-500" },
    pride:   { wash: "bg-emerald-50", fg: "text-emerald-600", dot: "bg-emerald-500" },
    apex:    { wash: "bg-indigo-50", fg: "text-indigo-600", dot: "bg-indigo-500" },
}

const KIND_LABEL: Record<string, string> = {
    issue_analyse: "Issue analysis",
    compose: "AI compose",
    embed: "Embedding",
    query: "Query",
    chat: "Chat",
    pr_analyse: "PR review",
    deep_dive: "Deep dive",
}

function fmtPoints(n: number): string {
    const v = Math.max(0, Math.round(n))
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    if (v >= 10_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}k`
    return v.toLocaleString("en-US")
}
function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
function fmtRelative(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.round(diff / 60000)
    if (m < 1) return "just now"
    if (m < 60) return `${m}m ago`
    const h = Math.round(m / 60)
    if (h < 24) return `${h}h ago`
    return fmtDate(iso)
}

export function BillingPanel() {
    const { activeTeam } = useTeam()
    // Key the request on the active team so switching teams refetches.
    const path = activeTeam ? `/api/billing?t=${activeTeam.id}` : "/api/billing"
    const { data, error, loading } = useApi<BillingSummary>(path)

    if (loading && !data) return <PanelSkeleton />
    if (error) {
        return (
            <div className="rounded-[14px] border border-[color:var(--c-error-bg)] bg-[color:var(--c-error-bg)] px-4 py-3 text-[13px] text-[color:var(--c-error)]">
                Couldn’t load billing: {error}
            </div>
        )
    }
    if (!data) return null

    const isAdmin = data.role === "owner" || data.role === "admin"
    return (
        <div className="flex flex-col gap-6">
            <BalanceHero balance={data.balance} status={data.status} />
            <PlanLadder tiers={data.tiers} current={data.balance.tier} canManage={isAdmin} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <UsageBreakdown breakdown={data.breakdown} total={data.balance.used} />
                <RecentActivity recent={data.recent} />
            </div>
        </div>
    )
}

// ─── the hero: current tier + the Prowl Point meter ──────────────────────────
function BalanceHero({ balance, status }: { balance: BalanceJSON; status: string }) {
    const pct = Math.round(balance.fraction * 100)
    const danger = balance.fraction >= 0.9 || balance.isExhausted
    return (
        <div className="card overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-dim)]">
                            Current plan
                        </span>
                        {status !== "active" && (
                            <span className="rounded-full bg-[color:var(--c-warn-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--c-warn)]">
                                {status}
                            </span>
                        )}
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                        <h3 className="text-[24px] font-extrabold tracking-[-0.02em]">{balance.tierName}</h3>
                        <span className="text-[13px] font-semibold text-[color:var(--c-text-muted)]">tier</span>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-dim)]">
                        {balance.uncapped ? "Prowl Points" : "Remaining this month"}
                    </div>
                    <div className="mt-1 flex items-baseline justify-end gap-1.5">
                        <span
                            className={cn(
                                "text-[26px] font-extrabold tabular-nums tracking-[-0.02em]",
                                danger ? "text-[color:var(--c-error)]" : "text-[color:var(--c-text)]",
                            )}
                        >
                            {balance.uncapped ? "∞" : fmtPoints(balance.remaining ?? 0)}
                        </span>
                        {!balance.uncapped && (
                            <span className="text-[13px] font-semibold text-[color:var(--c-text-dim)]">
                                / {fmtPoints(balance.allowance ?? 0)}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* the meter */}
            {balance.uncapped ? (
                <div className="mt-4 rounded-[10px] bg-[color:var(--c-primary-tint)] px-3 py-2.5 text-[12.5px] font-semibold text-[color:var(--c-accent)]">
                    Uncapped usage — {fmtPoints(balance.used)} Prowl Points spent this period.
                </div>
            ) : (
                <div className="mt-4">
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--c-surface-2)]">
                        <div
                            className={cn(
                                "h-full rounded-full transition-[width] duration-500",
                                danger ? "bg-[color:var(--c-error)]" : "bg-[color:var(--c-primary)]",
                            )}
                            style={{ width: `${Math.min(100, Math.max(balance.used > 0 ? 2 : 0, pct))}%` }}
                        />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[12px] text-[color:var(--c-text-muted)]">
                        <span>
                            <span className="font-bold text-[color:var(--c-text)]">{fmtPoints(balance.used)}</span> of{" "}
                            {fmtPoints(balance.allowance ?? 0)} Prowl Points used ({pct}%)
                        </span>
                        <span>Resets {fmtDate(balance.periodEnd)}</span>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── the plan ladder ─────────────────────────────────────────────────────────
function PlanLadder({ tiers, current, canManage }: { tiers: TierSpec[]; current: string; canManage: boolean }) {
    const currentIdx = tiers.findIndex((t) => t.id === current)
    return (
        <div>
            <h4 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                Plans
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {tiers.map((t, i) => (
                    <TierCard key={t.id} tier={t} isCurrent={t.id === current} isBelow={i < currentIdx} canManage={canManage} />
                ))}
            </div>
        </div>
    )
}

function TierCard({ tier, isCurrent, isBelow, canManage }: { tier: TierSpec; isCurrent: boolean; isBelow: boolean; canManage: boolean }) {
    const accent = TIER_ACCENT[tier.id] ?? TIER_ACCENT.kit
    return (
        <article
            className={cn(
                "relative flex flex-col rounded-[16px] border bg-[color:var(--c-surface)] p-4 transition-colors",
                isCurrent
                    ? "border-[color:var(--c-primary)] shadow-[0_0_0_1px_var(--c-primary)]"
                    : "border-[color:var(--c-border)]",
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
                {tier.monthlyPoints === null ? "Uncapped Prowl Points" : `${fmtPoints(tier.monthlyPoints)} Prowl Points / mo`}
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

// ─── usage breakdown by kind ─────────────────────────────────────────────────
function UsageBreakdown({ breakdown, total }: { breakdown: UsageByKind[]; total: number }) {
    const max = Math.max(1, ...breakdown.map((b) => b.points))
    return (
        <div className="card">
            <h4 className="text-[13px] font-bold tracking-[-0.005em]">Usage this period</h4>
            {breakdown.length === 0 ? (
                <p className="mt-3 text-[12.5px] text-[color:var(--c-text-dim)]">
                    No AI usage yet this month. Run an issue analysis or compose a draft to see spend here.
                </p>
            ) : (
                <div className="mt-3 flex flex-col gap-2.5">
                    {breakdown.map((b) => (
                        <div key={b.kind}>
                            <div className="flex items-center justify-between text-[12px]">
                                <span className="font-semibold text-[color:var(--c-text)]">{KIND_LABEL[b.kind] ?? b.kind}</span>
                                <span className="tabular-nums text-[color:var(--c-text-muted)]">
                                    {fmtPoints(b.points)} PP · {b.calls} {b.calls === 1 ? "call" : "calls"}
                                </span>
                            </div>
                            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--c-surface-2)]">
                                <div className="h-full rounded-full bg-[color:var(--c-accent)]" style={{ width: `${(b.points / max) * 100}%` }} />
                            </div>
                        </div>
                    ))}
                    <div className="mt-1 flex items-center justify-between border-t border-[color:var(--c-border)] pt-2 text-[12px] font-bold">
                        <span>Total</span>
                        <span className="tabular-nums">{fmtPoints(total)} PP</span>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── recent activity ─────────────────────────────────────────────────────────
function RecentActivity({ recent }: { recent: UsageEventRow[] }) {
    return (
        <div className="card">
            <h4 className="text-[13px] font-bold tracking-[-0.005em]">Recent activity</h4>
            {recent.length === 0 ? (
                <p className="mt-3 text-[12.5px] text-[color:var(--c-text-dim)]">No calls recorded yet.</p>
            ) : (
                <ul className="mt-2 flex flex-col divide-y divide-[color:var(--c-border)]">
                    {recent.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                            <div className="min-w-0">
                                <div className="truncate text-[12.5px] font-semibold text-[color:var(--c-text)]">
                                    {KIND_LABEL[e.kind] ?? e.kind}
                                </div>
                                <div className="text-[11px] text-[color:var(--c-text-dim)]">
                                    {e.model ? `${e.model} · ` : ""}
                                    {fmtRelative(e.created_at)}
                                </div>
                            </div>
                            <span className="shrink-0 tabular-nums text-[12.5px] font-bold text-[color:var(--c-text)]">
                                {fmtPoints(e.points)} PP
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

// ─── bits ────────────────────────────────────────────────────────────────────
function CheckIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0 text-[color:var(--c-success)]" aria-hidden>
            <path d="M13 4.5 6.5 11 3 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function PanelSkeleton() {
    return (
        <div className="flex flex-col gap-6">
            <div className="skeleton h-32 w-full rounded-[16px]" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="skeleton h-72 w-full rounded-[16px]" />
                ))}
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="skeleton h-40 w-full rounded-[16px]" />
                <div className="skeleton h-40 w-full rounded-[16px]" />
            </div>
        </div>
    )
}
