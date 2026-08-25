"use client"

import type { PrAnalysis, PrFinding } from "@/lib/shared/types"
import { cn } from "@/components/ui/cn"

// Shared pieces for the redesign proposals. Deliberately small and local: this
// is a proposal, so nothing here touches the shipped panel until a direction is
// chosen.

export const SEV = {
    critical: { dot: "bg-rose-500", text: "text-rose-700", chip: "bg-rose-50 text-rose-700 ring-rose-200", label: "Blocker" },
    review: { dot: "bg-amber-500", text: "text-amber-700", chip: "bg-amber-50 text-amber-700 ring-amber-200", label: "Worth a look" },
    good: { dot: "bg-emerald-500", text: "text-emerald-700", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Good" },
} as const

export type Sev = keyof typeof SEV
export const sevOf = (f: PrFinding): Sev =>
    f.severity === "critical" || f.severity === "bug" ? "critical" : f.severity === "good" ? "good" : "review"

/** The one thing a reader is here for, said once, at full size. */
export function VerdictBand({ r }: { r: PrAnalysis }) {
    const blocking = r.verdict === "request_changes"
    const tone = blocking
        ? "border-rose-200 bg-rose-50/70 text-rose-900"
        : r.verdict === "approve"
          ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
          : "border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] text-[color:var(--c-text)]"
    const blockers = (r.findings ?? []).filter((f) => sevOf(f) === "critical").length
    return (
        <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] border px-4 py-3.5", tone)}>
            <span className="text-[17px] font-bold tracking-[-0.01em]">
                {blocking ? "Changes requested" : r.verdict === "approve" ? "Looks good to merge" : "Reviewed"}
            </span>
            <span className="text-[13px] opacity-80">{r.verdict_reason}</span>
            <span className="ml-auto flex items-baseline gap-1.5">
                <span className="text-[22px] font-bold leading-none">{r.score}</span>
                <span className="text-[12px] opacity-70">/ {r.score_max} ready</span>
            </span>
            {blockers > 0 && (
                <span className="rounded-full bg-white/70 px-2 py-[3px] text-[11.5px] font-semibold ring-1 ring-rose-200">
                    {blockers} blocker{blockers === 1 ? "" : "s"}
                </span>
            )}
        </div>
    )
}

/** A finding, with severity carried by a rail rather than by a badge inside a
 *  box inside a drawer. */
export function FindingRow({ f, rail }: { f: PrFinding; rail?: boolean }) {
    const s = SEV[sevOf(f)]
    return (
        <div className={cn("relative py-3", rail && "pl-5")}>
            {rail && <span className={cn("absolute left-0 top-[18px] h-2 w-2 rounded-full ring-4 ring-[color:var(--c-surface)]", s.dot)} />}
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                {!rail && <span className={cn("h-2 w-2 shrink-0 translate-y-[-1px] rounded-full", s.dot)} />}
                <span className="text-[13.5px] font-semibold leading-5 text-[color:var(--c-text)]">{f.title}</span>
                {f.provenance?.carried && (
                    <span className="rounded-full bg-[color:var(--c-surface-2)] px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-wide text-[color:var(--c-text-muted)]">
                        carried
                    </span>
                )}
                <code className="ml-auto shrink-0 font-mono text-[10.5px] text-[color:var(--c-text-dim)]">
                    {f.file?.split("/").pop()}
                    {f.line ? `:${f.line}` : ""}
                </code>
            </div>
            {f.detail && <p className="mt-1.5 max-w-[70ch] text-[12.5px] leading-[1.65] text-[color:var(--c-text-muted)]">{f.detail}</p>}
            {f.evidence?.length ? (
                <ul className="mt-2 flex flex-col gap-1">
                    {f.evidence.map((e, i) => (
                        <li key={i} className="flex items-baseline gap-1.5 font-mono text-[10.5px] text-[color:var(--c-text-dim)]">
                            <span className="opacity-60">↳</span>
                            <span className="truncate">
                                {e.file}
                                {e.line ? `:${e.line}` : ""}
                            </span>
                            {e.note && <span className="truncate font-sans opacity-70">— {e.note}</span>}
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    )
}

/** Metadata, as a quiet rail rather than as five more drawers. */
export function MetaRail({ r }: { r: PrAnalysis }) {
    const dims = [
        ["correctness", r.confidences?.correctness],
        ["load / perf", r.confidences?.load_perf],
        ["security", r.confidences?.security],
    ] as const
    return (
        <aside className="flex flex-col gap-5 text-[12px]">
            <div>
                <h4 className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">Confidence</h4>
                <div className="flex flex-col gap-1.5">
                    {dims.map(([label, d]) =>
                        d ? (
                            <div key={label} className="flex items-center justify-between gap-2" title={d.basis}>
                                <span className="text-[color:var(--c-text-muted)]">{label}</span>
                                <span
                                    className={cn(
                                        "font-semibold",
                                        d.level === "high" ? "text-emerald-600" : d.level === "medium" ? "text-amber-600" : "text-rose-600",
                                    )}
                                >
                                    {d.level}
                                </span>
                            </div>
                        ) : null,
                    )}
                </div>
            </div>

            <div>
                <h4 className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">Files touched</h4>
                <ul className="flex flex-col gap-1.5">
                    {(r.impact_files ?? []).map((f, i) => (
                        <li key={i} className="min-w-0">
                            <code className="block truncate font-mono text-[11px] text-[color:var(--c-text)]" title={f.file}>
                                {f.file}
                            </code>
                            <span className="text-[11px] text-[color:var(--c-text-dim)]">{f.reason}</span>
                        </li>
                    ))}
                </ul>
            </div>

            <div>
                <h4 className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">Checked</h4>
                <p className="leading-[1.7] text-[color:var(--c-text-muted)]">
                    {r.checks?.callers} callers · {r.checks?.precedents} precedents · {r.checks?.tests} test ·{" "}
                    {r.checks?.failure_probes} failure probe
                </p>
                <p className="mt-1 font-mono text-[10.5px] text-[color:var(--c-text-dim)]">build {r.analyser_build}</p>
            </div>
        </aside>
    )
}

/** Everything that is reference rather than review, behind ONE disclosure. */
export function MoreDetail({ r }: { r: PrAnalysis }) {
    return (
        <details className="group rounded-[12px] border border-[color:var(--c-border)]">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[12px] font-semibold text-[color:var(--c-text-muted)] [&::-webkit-details-marker]:hidden">
                <span className="transition-transform group-open:rotate-90">›</span>
                Impact, claims and checklist
            </summary>
            <div className="flex flex-col gap-4 border-t border-[color:var(--c-border)] px-4 py-4 text-[12.5px]">
                <div>
                    <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">Impact</h4>
                    <ul className="flex list-disc flex-col gap-1 pl-4 leading-[1.65] text-[color:var(--c-text-muted)]">
                        {(r.impact ?? "").split("\n").filter(Boolean).map((l, i) => <li key={i}>{l.replace(/^-\s*/, "")}</li>)}
                    </ul>
                </div>
                <div>
                    <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">Fix claims</h4>
                    {(r.fix_claims ?? []).map((c, i) => (
                        <p key={i} className="leading-[1.65] text-[color:var(--c-text-muted)]">
                            <span className="text-[color:var(--c-text)]">{c.claim}</span> — {c.reason}{" "}
                            <span className="rounded-full bg-emerald-50 px-1.5 py-[1px] text-[10.5px] font-semibold text-emerald-700">{c.verdict}</span>
                        </p>
                    ))}
                </div>
                <div>
                    <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">Before merging</h4>
                    <ul className="flex list-disc flex-col gap-1 pl-4 leading-[1.65] text-[color:var(--c-text-muted)]">
                        {(r.checklist ?? []).map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                </div>
            </div>
        </details>
    )
}
