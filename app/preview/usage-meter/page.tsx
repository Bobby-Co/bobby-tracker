"use client"

import { useState } from "react"
import { BalancePillSkeleton, BalancePillView, FuelGauge, type BalanceJSON } from "@/components/layout/balance-pill"

// The morphing usage meter. The real BalancePill needs a signed-in team to fetch
// a balance, so this feeds FuelGauge fabricated balances — and lets you toggle
// collapsed to watch the dashes sweep along curved (polar) paths from the row
// below the flame into the ring around it.

function balance(fraction: number, opts: Partial<BalanceJSON> = {}): BalanceJSON {
    const allowance = 100_000
    return {
        tierName: "Prowl",
        allowance,
        used: Math.round(allowance * fraction),
        remaining: Math.round(allowance * (1 - fraction)),
        fraction,
        isExhausted: fraction >= 1,
        uncapped: false,
        ...opts,
    }
}

const accentFor = (b: BalanceJSON) => (b.isExhausted ? "var(--c-error)" : b.fraction >= 0.85 ? "var(--c-warn)" : "var(--c-primary)")

const SAMPLES: { label: string; b: BalanceJSON }[] = [
    { label: "12% used", b: balance(0.12) },
    { label: "48% used", b: balance(0.48) },
    { label: "72% used", b: balance(0.72) },
    { label: "90% (warn)", b: balance(0.9) },
    { label: "Empty", b: balance(1) },
    { label: "Unlimited", b: balance(0.3, { uncapped: true }) },
]

export default function UsageMeterPreview() {
    const [collapsed, setCollapsed] = useState(false)
    const b = balance(0.62)

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-6 py-10">
            <header className="flex flex-col gap-1">
                <h1 className="text-[20px] font-extrabold tracking-[-0.012em]">Usage meter</h1>
                <p className="text-[12.5px] text-[color:var(--c-text-muted)]">
                    The segment row curls into a ring along curved paths (polar interpolation, rAF).
                </p>
            </header>

            <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5 shadow-[var(--shadow-card)]">
                <div className="mb-3 flex items-center justify-between">
                    <div className="h-section">The morph</div>
                    <button onClick={() => setCollapsed((v) => !v)} className="btn-ghost text-[12px]">
                        {collapsed ? "Expand (→ row)" : "Collapse (→ ring)"}
                    </button>
                </div>
                <div className="flex items-center justify-center rounded-[12px] bg-[color:var(--c-shell)] p-8">
                    <FuelGauge collapsed={collapsed} b={b} accent={accentFor(b)} />
                </div>
            </section>

            <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5 shadow-[var(--shadow-card)]">
                <div className="mb-3 flex items-center justify-between">
                    <div className="h-section">The full pill (in a sidebar-width column)</div>
                    <button onClick={() => setCollapsed((v) => !v)} className="btn-ghost text-[12px]">
                        {collapsed ? "Expand" : "Collapse"}
                    </button>
                </div>
                <div className="flex items-start gap-6 rounded-[12px] bg-[color:var(--c-shell)] p-5">
                    <div className="w-[224px] rounded-[10px] bg-[color:var(--c-surface)] p-2">
                        <BalancePillView collapsed={collapsed} b={balance(0.194, { remaining: 8060, used: 1940, allowance: 10000 })} />
                    </div>
                    <p className="max-w-[220px] text-[12px] text-[color:var(--c-text-muted)]">
                        Flame + credits on the top row, bar + percentage below — the reference two-row pill. Toggle to watch it fold into the ring.
                    </p>
                </div>
            </section>

            <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5 shadow-[var(--shadow-card)]">
                <div className="mb-3 h-section">Loading skeleton (same element, muted + shimmer)</div>
                <div className="flex items-start gap-8 rounded-[12px] bg-[color:var(--c-shell)] p-5">
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-[224px] rounded-[10px] bg-[color:var(--c-surface)] p-2">
                            <BalancePillSkeleton />
                        </div>
                        <span className="text-[11px] text-[color:var(--c-text-muted)]">Expanded</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                        <div className="rounded-[10px] bg-[color:var(--c-surface)] p-2">
                            <BalancePillSkeleton collapsed />
                        </div>
                        <span className="text-[11px] text-[color:var(--c-text-muted)]">Collapsed (rail)</span>
                    </div>
                </div>
            </section>

            <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5 shadow-[var(--shadow-card)]">
                <div className="mb-3 h-section">Ring — states</div>
                <div className="flex flex-wrap gap-5">
                    {SAMPLES.map((s) => (
                        <div key={s.label} className="flex flex-col items-center gap-1.5">
                            <div className="rounded-[10px] bg-[color:var(--c-shell)] p-2">
                                <FuelGauge collapsed b={s.b} accent={accentFor(s.b)} />
                            </div>
                            <span className="text-[11px] text-[color:var(--c-text-muted)]">{s.label}</span>
                        </div>
                    ))}
                </div>
            </section>

            <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5 shadow-[var(--shadow-card)]">
                <div className="mb-3 h-section">Expanded — states (row below the flame)</div>
                <div className="flex flex-wrap gap-5">
                    {SAMPLES.map((s) => (
                        <div key={s.label} className="flex flex-col items-center gap-1.5">
                            <div className="rounded-[10px] bg-[color:var(--c-shell)] p-2">
                                <FuelGauge collapsed={false} b={s.b} accent={accentFor(s.b)} />
                            </div>
                            <span className="text-[11px] text-[color:var(--c-text-muted)]">{s.label}</span>
                        </div>
                    ))}
                </div>
            </section>
        </main>
    )
}
