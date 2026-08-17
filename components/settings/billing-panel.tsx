"use client"

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import Link from "next/link"
import { cn } from "@/components/ui/cn"
import { useApi } from "@/lib/client/hooks/use-api"
import { useTeam } from "@/lib/client/auth/team-context"
import PixelScatter from "@/components/ui/pixel-scatter"

// Prowl — the Usage & Billing panel. Focused on the CURRENT plan + spend, in the
// ember/primary family: the app's block meter (.seg), an ember stat-tile row, and
// a stacked spend bar in ember shades with a legend. Choosing a plan is its own
// page (plan-ladder.tsx, linked from the tile). Driven by GET /api/billing.

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
interface BillingSummary {
    role: string
    status: string
    balance: BalanceJSON
    breakdown: UsageByKind[]
}

// Uniform ember chip for the stat-tile icons — on-theme; the glyph distinguishes.
const EMBER_CHIP = "bg-[color:var(--c-primary-tint)] text-[color:var(--c-accent)]"

// Per-kind identity for the usage bar + legend: a label and a shade from the EMBER
// ramp, so the whole page reads in the primary family.
const KIND: Record<string, { label: string; color: string }> = {
    issue_analyse: { label: "Issue analysis", color: "#E9730F" },
    pr_analyse:    { label: "PR review",      color: "#C2410C" },
    mcp_ask:       { label: "MCP · ask",      color: "#EF9F27" },
    mcp_locate:    { label: "MCP · locate",   color: "#CF6310" },
    mcp_neighbours:{ label: "MCP · neighbours", color: "#D9A066" },
    mind_chat:     { label: "Mind chat",      color: "#F3B36A" },
    index:         { label: "KB indexing",    color: "#9A3412" },
    compose:       { label: "AI compose",     color: "#B85C1E" },
    embed:         { label: "Embedding",      color: "#D9A066" },
    // Filed by a visitor through a public link — the spend is theirs, the bill is
    // the publishing team's, so it gets its own line rather than hiding inside
    // AI compose. Covers both the draft and its routing embedding.
    public_issue:  { label: "Public issues",  color: "#A16207" },
    query:         { label: "Query",          color: "#EF9F27" },
    chat:          { label: "Chat",           color: "#F3B36A" },
    deep_dive:     { label: "Deep dive",      color: "#9A3412" },
}
function kindMeta(kind: string): { label: string; color: string } {
    return KIND[kind] ?? { label: kind, color: "#D9A066" }
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
function daysUntil(iso: string): number {
    return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
}

export function BillingPanel() {
    const { activeTeam } = useTeam()
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

    const b = data.balance
    const canManage = data.role === "owner" || data.role === "admin"
    const calls = data.breakdown.reduce((n, k) => n + k.calls, 0)

    return (
        <div className="flex flex-col gap-3.5">
            <PlanHero balance={b} status={data.status} canManage={canManage} />
            <StatTiles balance={b} calls={calls} />
            <UsageBar breakdown={data.breakdown} total={b.used} />
        </div>
    )
}

// ─── the current-plan hero: tier + block meter ───────────────────────────────
function PlanHero({ balance: b, status, canManage }: { balance: BalanceJSON; status: string; canManage: boolean }) {
    const pct = Math.round(b.fraction * 100)
    const danger = b.fraction >= 0.9 || b.isExhausted
    return (
        <div className="relative overflow-hidden rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-4 sm:p-5">
            {/* Ember pixel bloom in the corner — the same texture as the sidebar
                account card, so the billing hero reads as the Ucelot identity. */}
            <div aria-hidden className="pointer-events-none absolute inset-0">
                <PixelScatter corners={["br"]} cell={16} fill={0.34} reach={0.62} falloff={1.2} animate={false} className="opacity-70" />
            </div>
            <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-dim)]">Current plan</span>
                        {status !== "active" && (
                            <span className="rounded-full bg-[color:var(--c-warn-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--c-warn)]">
                                {status}
                            </span>
                        )}
                    </div>
                    <h3 className="mt-1 text-[26px] font-extrabold leading-none tracking-[-0.02em]">{b.tierName}</h3>
                    <Link
                        href="/settings/billing/plans"
                        className="mt-2 inline-flex items-center gap-0.5 text-[12px] font-bold text-[color:var(--c-accent)] hover:text-[color:var(--c-primary-hover)]"
                    >
                        {canManage ? "Change plan" : "View plans"}
                        <Chevron />
                    </Link>
                </div>
                <div className="text-right">
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-dim)]">
                        {b.uncapped ? "Credits" : "Remaining"}
                    </div>
                    <div className="mt-1 flex items-baseline justify-end gap-1.5">
                        <span className={cn("text-[30px] font-extrabold leading-none tabular-nums tracking-[-0.02em]", danger ? "text-[color:var(--c-error)]" : "text-[color:var(--c-text)]")}>
                            {b.uncapped ? "∞" : fmtPoints(b.remaining ?? 0)}
                        </span>
                        {!b.uncapped && <span className="text-[14px] font-semibold text-[color:var(--c-text-dim)]">/ {fmtPoints(b.allowance ?? 0)}</span>}
                    </div>
                </div>
            </div>

            {b.uncapped ? (
                <div className="mt-4 rounded-[10px] bg-[color:var(--c-primary-tint)] px-3 py-2.5 text-[12.5px] font-semibold text-[color:var(--c-accent)]">
                    Uncapped usage — {fmtPoints(b.used)} credits spent this period.
                </div>
            ) : (
                <>
                    <SegMeter fraction={b.fraction} danger={danger} />
                    <div className="mt-2.5 flex items-center justify-between text-[12px] text-[color:var(--c-text-muted)]">
                        <span>
                            <span className="font-bold text-[color:var(--c-text)]">{fmtPoints(b.used)}</span> of {fmtPoints(b.allowance ?? 0)} used · {pct}%
                        </span>
                        <span>Resets {fmtDate(b.periodEnd)}</span>
                    </div>
                </>
            )}
            </div>
        </div>
    )
}

// The app's segmented block meter (.seg / .seg-on) — chunky amber ticks fill
// proportional to spend; red at/near the limit.
function SegMeter({ fraction, danger }: { fraction: number; danger: boolean }) {
    const N = 24
    const on = Math.min(N, Math.max(fraction > 0 ? 1 : 0, Math.round(fraction * N)))
    const dangerStyle: CSSProperties = { background: "var(--c-error)", boxShadow: "none" }
    return (
        <span className="seg-track mt-4">
            {Array.from({ length: N }).map((_, i) => (
                <span key={i} className={cn("seg", i < on && "seg-on")} style={i < on && danger ? dangerStyle : undefined} />
            ))}
        </span>
    )
}

// ─── stat tiles (uniform ember chips) ────────────────────────────────────────
function StatTiles({ balance: b, calls }: { balance: BalanceJSON; calls: number }) {
    const pct = Math.round(b.fraction * 100)
    return (
        <div className="grid grid-cols-3 gap-3">
            <StatTile glyph={<FlameGlyph />} label="Used" value={fmtPoints(b.used)} unit="credits" sub={b.uncapped ? "uncapped" : `${pct}% of allowance`} />
            <StatTile glyph={<PulseGlyph />} label="Calls" value={`${calls}`} sub="this period" />
            <StatTile glyph={<CalendarGlyph />} label="Resets" value={fmtDate(b.periodEnd)} sub={`in ${daysUntil(b.periodEnd)} days`} />
        </div>
    )
}

function StatTile({ glyph, label, value, unit, sub }: { glyph: ReactNode; label: string; value: string; unit?: string; sub: string }) {
    return (
        <div className="rounded-[14px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-3 sm:p-3.5">
            <div className="flex items-center gap-2">
                <span className={cn("grid h-[22px] w-[22px] place-items-center rounded-[7px]", EMBER_CHIP)}>{glyph}</span>
                <span className="text-[12px] font-semibold text-[color:var(--c-text-muted)]">{label}</span>
            </div>
            <div className="mt-2 text-[20px] font-extrabold leading-none tracking-[-0.01em]">
                {value}
                {unit && <span className="ml-1 text-[12px] font-semibold text-[color:var(--c-text-dim)]">{unit}</span>}
            </div>
            <div className="mt-1 text-[11px] text-[color:var(--c-text-muted)]">{sub}</div>
        </div>
    )
}

// ─── usage this period: stacked spend bar (ember shades) + legend ────────────
function UsageBar({ breakdown, total }: { breakdown: UsageByKind[]; total: number }) {
    const sorted = [...breakdown].sort((a, b) => b.points - a.points)
    const sum = sorted.reduce((n, k) => n + k.points, 0)
    return (
        <div className="card">
            <div className="flex items-center justify-between">
                <h4 className="text-[13px] font-bold tracking-[-0.005em]">Usage this period</h4>
                {sum > 0 && <span className="text-[12px] font-bold tabular-nums">{fmtPoints(total)} credits</span>}
            </div>
            {sum === 0 ? (
                <p className="mt-3 text-[12.5px] text-[color:var(--c-text-dim)]">
                    No AI usage yet this month. Run an issue analysis or ask a question to see spend here.
                </p>
            ) : (
                <>
                    <SpendBlocks sorted={sorted} sum={sum} />
                    <div className="mt-3.5 grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2">
                        {sorted.map((k) => {
                            const m = kindMeta(k.kind)
                            return (
                                <div key={k.kind} className="flex items-center gap-2">
                                    <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: m.color }} />
                                    <span className="flex-1 truncate text-[12px] font-semibold text-[color:var(--c-text)]">{m.label}</span>
                                    <span className="shrink-0 text-[12px] tabular-nums text-[color:var(--c-text-muted)]">
                                        {fmtPoints(k.points)} · {k.calls}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                </>
            )}
        </div>
    )
}

// Segmented spend bar — slim ticks coloured by kind, the same motif as the hero
// meter. The tick COUNT scales to the measured card width (~5px per tick) and the
// ticks flex-fill, so they stay slim AND span the row edge-to-edge on any width.
// Each kind claims a proportional run (at least one, so small kinds still show).
function SpendBlocks({ sorted, sum }: { sorted: UsageByKind[]; sum: number }) {
    const ref = useRef<HTMLDivElement>(null)
    const [cols, setCols] = useState(64)
    useEffect(() => {
        const el = ref.current
        if (!el) return
        const measure = () => {
            const w = el.clientWidth
            if (w > 0) setCols(Math.max(sorted.length, Math.round((w + 3) / 8))) // ~5px tick + 3px gap
        }
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [sorted.length])

    const colors: string[] = []
    for (const k of sorted) {
        const count = Math.max(1, Math.round((k.points / sum) * cols))
        const color = kindMeta(k.kind).color
        for (let i = 0; i < count; i++) colors.push(color)
    }
    return (
        <div ref={ref} className="mt-3 flex gap-[3px]">
            {colors.map((c, i) => (
                <span key={i} className="h-[16px] flex-1 rounded-[2px]" style={{ background: c }} />
            ))}
        </div>
    )
}

function PanelSkeleton() {
    return (
        <div className="flex flex-col gap-3.5">
            <div className="skeleton h-40 w-full rounded-[16px]" />
            <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton h-[92px] w-full rounded-[14px]" />
                ))}
            </div>
            <div className="skeleton h-32 w-full rounded-[16px]" />
        </div>
    )
}

// ─── glyphs (16-box line icons, inherit currentColor from the chip) ──────────
function G({ children }: { children: ReactNode }) {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {children}
        </svg>
    )
}
function FlameGlyph() { return <G><path d="M8 2.5c2.2 2.8 3.8 4.4 3.8 7A3.8 3.8 0 1 1 4.2 9.5c0-.9.3-1.6.8-2.3.3 1 .9 1.5 1.7 1.7-.3-2 .5-3.5 1.3-4.4Z" /></G> }
function PulseGlyph() { return <G><path d="M2.5 8h2.5l1.5-3.5L9 12l1.5-4H13.5" /></G> }
function CalendarGlyph() { return <G><rect x="2.6" y="3.4" width="10.8" height="10" rx="1.6" /><path d="M2.6 6.4h10.8M5.5 2.4v2M10.5 2.4v2" /></G> }
function Chevron() { return <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden><path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg> }
