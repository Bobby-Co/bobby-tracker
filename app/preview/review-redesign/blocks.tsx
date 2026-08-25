"use client"

import { cn } from "@/components/ui/cn"
import type { BlockItem, BlockTone } from "@/lib/shared/report/registry"
import { Icon, type IconName } from "./glyphs"

// The five INLINE report blocks — the ones that carry their own payload rather
// than re-rendering canonical analysis fields. A review profile decides which
// appear, so the panel has to render all of them well, not just the ones the
// default layout happens to emit.

const TONE: Record<BlockTone, { box: string; head: string; icon: IconName }> = {
    neutral: { box: "border-[color:var(--c-border)]", head: "text-[color:var(--c-text)]", icon: "list" },
    info: { box: "border-blue-200 bg-blue-50/50", head: "text-blue-800", icon: "chat" },
    good: { box: "border-emerald-200 bg-emerald-50/50", head: "text-emerald-800", icon: "check" },
    warn: { box: "border-amber-200 bg-amber-50/50", head: "text-amber-800", icon: "alert" },
    critical: { box: "border-rose-200 bg-rose-50/60", head: "text-rose-800", icon: "alert" },
}

export function SectionHead({ icon, children, count }: { icon: IconName; children: React.ReactNode; count?: number }) {
    return (
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">
            <Icon name={icon} size={12} />
            {children}
            {count != null && (
                <span className="rounded-full bg-[color:var(--c-surface-2)] px-1.5 text-[10px] font-semibold normal-case tracking-normal">{count}</span>
            )}
        </h3>
    )
}

/** callout — a single thing the reviewer wants read before anything else. */
export function Callout({ title, body, tone = "warn" }: { title: string; body: string; tone?: BlockTone }) {
    const t = TONE[tone]
    return (
        <div className={cn("rounded-[12px] border px-4 py-3", t.box)}>
            <p className={cn("flex items-center gap-1.5 text-[13px] font-bold", t.head)}>
                <Icon name={t.icon} size={14} />
                {title}
            </p>
            <p className="mt-1.5 max-w-[72ch] text-[12.5px] leading-[1.65] text-[color:var(--c-text-muted)]">{body}</p>
        </div>
    )
}

/** risk_matrix — likelihood × impact, as a table rather than prose. */
export function RiskMatrix({ items }: { items: BlockItem[] }) {
    const rank = (v?: string) => (v === "high" ? "text-rose-600" : v === "medium" ? "text-amber-600" : "text-[color:var(--c-text-muted)]")
    return (
        <div>
            <SectionHead icon="alert" count={items.length}>Risks</SectionHead>
            <div className="divide-y divide-[color:var(--c-border)] rounded-[10px] border border-[color:var(--c-border)]">
                {items.map((it, i) => (
                    <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3.5 py-2.5">
                        <span className="min-w-0 flex-1 text-[12.5px] font-medium text-[color:var(--c-text)]">{it.label}</span>
                        <span className="shrink-0 text-[11px]">
                            <span className={rank(it.likelihood)}>{it.likelihood}</span>
                            <span className="text-[color:var(--c-text-dim)]"> likelihood · </span>
                            <span className={rank(it.impact)}>{it.impact}</span>
                            <span className="text-[color:var(--c-text-dim)]"> impact</span>
                        </span>
                        {it.detail && <p className="w-full text-[12px] leading-[1.6] text-[color:var(--c-text-muted)]">{it.detail}</p>}
                    </div>
                ))}
            </div>
        </div>
    )
}

/** spec_table — a contract, before and after, with who calls it. */
export function SpecTable({ items }: { items: BlockItem[] }) {
    return (
        <div>
            <SectionHead icon="code" count={items.length}>Contract changes</SectionHead>
            <div className="overflow-x-auto rounded-[10px] border border-[color:var(--c-border)]">
                <table className="w-full min-w-[520px] text-left">
                    <thead>
                        <tr className="text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">
                            {["symbol", "before", "after", "callers"].map((h) => (
                                <th key={h} className="border-b border-[color:var(--c-border)] px-3.5 py-2 font-bold">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[color:var(--c-border)]">
                        {items.map((it, i) => (
                            <tr key={i} className="text-[12px]">
                                <td className="px-3.5 py-2 font-mono text-[11.5px] text-[color:var(--c-text)]">{it.label}</td>
                                <td className="px-3.5 py-2 font-mono text-[11px] text-[color:var(--c-text-muted)]">{it.from}</td>
                                <td className="px-3.5 py-2 font-mono text-[11px] text-[color:var(--c-text)]">{it.to}</td>
                                <td className="px-3.5 py-2 tabular-nums text-[color:var(--c-text-muted)]">{it.detail}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

/** timeline — what happened to this code before, so a regression is visible. */
export function Timeline({ items }: { items: BlockItem[] }) {
    return (
        <div>
            <SectionHead icon="chat" count={items.length}>History</SectionHead>
            <ol className="relative ml-1 border-l border-[color:var(--c-border)] pl-4">
                {items.map((it, i) => (
                    <li key={i} className="relative py-2">
                        <span className="absolute -left-[21px] top-[13px] h-1.5 w-1.5 rounded-full bg-[color:var(--c-border-strong)] ring-4 ring-[color:var(--c-surface)]" />
                        <div className="flex flex-wrap items-baseline gap-x-2">
                            <code className="font-mono text-[10.5px] text-[color:var(--c-text-dim)]">{it.when}</code>
                            <span className="text-[12.5px] text-[color:var(--c-text)]">{it.label}</span>
                        </div>
                        {it.detail && <p className="mt-0.5 text-[12px] leading-[1.6] text-[color:var(--c-text-muted)]">{it.detail}</p>}
                    </li>
                ))}
            </ol>
        </div>
    )
}

/** dependency_list — version moves, with why they matter. */
export function DependencyList({ items }: { items: BlockItem[] }) {
    return (
        <div>
            <SectionHead icon="nodes" count={items.length}>Dependencies</SectionHead>
            <ul className="divide-y divide-[color:var(--c-border)] rounded-[10px] border border-[color:var(--c-border)]">
                {items.map((it, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2.5 px-3.5 py-2.5 text-[12px]">
                        <code className="font-mono text-[11.5px] font-semibold text-[color:var(--c-text)]">{it.label}</code>
                        <code className="font-mono text-[11px] text-[color:var(--c-text-dim)]">
                            {it.from} <span className="opacity-60">→</span> {it.to}
                        </code>
                        <span className="text-[color:var(--c-text-muted)]">{it.detail}</span>
                    </li>
                ))}
            </ul>
        </div>
    )
}

/** checklist — what to do before merging. */
export function Checklist({ items }: { items: string[] }) {
    return (
        <div>
            <SectionHead icon="list" count={items.length}>Before merging</SectionHead>
            <ul className="flex flex-col gap-1.5">
                {items.map((c, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-[12.5px] leading-[1.6] text-[color:var(--c-text-muted)]">
                        <span className="mt-[3px] h-3 w-3 shrink-0 rounded-[3px] border border-[color:var(--c-border-strong)]" />
                        {c}
                    </li>
                ))}
            </ul>
        </div>
    )
}

/** claims_table — what the PR said it did, and whether it did. */
export function Claims({ items }: { items: { claim: string; verdict?: string; reason?: string }[] }) {
    const tone = (v?: string) =>
        v === "likely" ? "bg-emerald-50 text-emerald-700" : v === "unlikely" ? "bg-rose-50 text-rose-700" : v === "partial" ? "bg-amber-50 text-amber-700" : "bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]"
    return (
        <div>
            <SectionHead icon="target" count={items.length}>Fix claims</SectionHead>
            <ul className="divide-y divide-[color:var(--c-border)] rounded-[10px] border border-[color:var(--c-border)]">
                {items.map((c, i) => (
                    <li key={i} className="px-3.5 py-2.5">
                        <div className="flex items-baseline gap-2">
                            <span className="min-w-0 flex-1 text-[12.5px] text-[color:var(--c-text)]">{c.claim}</span>
                            <span className={cn("shrink-0 rounded-full px-2 py-[1px] text-[10.5px] font-semibold", tone(c.verdict))}>{c.verdict ?? "unclear"}</span>
                        </div>
                        {c.reason && <p className="mt-1 text-[12px] leading-[1.6] text-[color:var(--c-text-muted)]">{c.reason}</p>}
                    </li>
                ))}
            </ul>
        </div>
    )
}
