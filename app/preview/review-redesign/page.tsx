"use client"

import { useState } from "react"
import { PrReview } from "@/components/pulls/pr-review"
import { cn } from "@/components/ui/cn"
import type { PullRequestAnalysis } from "@/lib/shared/types"
import { REVIEW, REVIEW_MANY } from "./fixture"
import { FindingRow, Footer, MetaRail, MoreDetail, Rounds, SEV, sevOf, VerdictBand } from "./parts"
import { Icon } from "./glyphs"

// Three ways to render one review, so a direction can be chosen by looking
// rather than by describing.
//
// The problem being solved is not spacing. The shipped panel puts TWELVE
// near-identical <details> boxes in a column — reviewed-this-push, carried,
// impact, affected files, contract changes, history, dependencies, blockers,
// worth-a-review, looks-good, fix-claims, nice-to-check — so a critical blocker
// has exactly the weight of "nice to check", and the reader has to open drawers
// to find out which is which.

const ANALYSIS: PullRequestAnalysis = {
    id: "preview",
    project_id: "preview-project",
    pr_number: 1,
    status: "done",
    github_comment_id: null,
    head_sha: null,
    result: REVIEW,
    review_profile_id: null,
    review_profile: { kind: "default" },
    review_scope: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
}

/** A — Brief. Verdict at full size, findings flat and ranked, metadata in a
 *  rail, and ONE disclosure for everything that is reference. */
function Brief({ r }: { r: typeof REVIEW }) {
    const findings = [...(r.findings ?? [])].sort(
        (a, b) => ["critical", "review", "good"].indexOf(sevOf(a)) - ["critical", "review", "good"].indexOf(sevOf(b)),
    )
    const groups = [
        { key: "critical" as const, title: "Blocking" },
        { key: "review" as const, title: "Worth a look" },
        { key: "good" as const, title: "Done well" },
    ]
    return (
        <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="mb-4 flex items-center gap-2">
                <h2 className="text-[14px] font-bold tracking-[-0.005em]">Ucelot · PR review</h2>
                <span className="ml-auto rounded-full border border-[color:var(--c-border)] px-2 py-[2px] text-[11px] text-[color:var(--c-text-muted)]">
                    Payments — strict
                </span>
            </div>

            <div className="mb-4">
                <Rounds />
            </div>

            <VerdictBand r={r} />

            <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="min-w-0">
                    {groups.map((g) => {
                        const items = findings.filter((f) => sevOf(f) === g.key)
                        if (!items.length) return null
                        return (
                            <div key={g.key} className="mb-5 last:mb-0">
                                <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">
                                    <Icon name={SEV[g.key].icon} size={13} className={SEV[g.key].text} />
                                    {g.title}
                                    <span className="rounded-full bg-[color:var(--c-surface-2)] px-1.5 text-[10px] font-semibold normal-case tracking-normal">
                                        {items.length}
                                    </span>
                                </h3>
                                <div className="divide-y divide-[color:var(--c-border)]">
                                    {items.map((f, i) => (
                                        <FindingRow key={i} f={f} />
                                    ))}
                                </div>
                            </div>
                        )
                    })}
                    <MoreDetail r={r} />
                </div>
                <MetaRail r={r} />
            </div>

            <Footer r={r} />
        </section>
    )
}

/** B — Thread. One continuous rail, severity as a dot on it, no boxes at all.
 *  Reads like a colleague's comments rather than a form. */
function Thread() {
    const findings = [...(REVIEW.findings ?? [])].sort(
        (a, b) => ["critical", "review", "good"].indexOf(sevOf(a)) - ["critical", "review", "good"].indexOf(sevOf(b)),
    )
    return (
        <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="mb-4 flex items-center gap-2">
                <h2 className="text-[14px] font-bold tracking-[-0.005em]">Ucelot · PR review</h2>
                <span className="ml-auto text-[11px] text-[color:var(--c-text-dim)]">round 2 · 41.2s</span>
            </div>

            <VerdictBand r={REVIEW} />

            <ul className="mt-4 flex max-w-[72ch] list-disc flex-col gap-1 pl-4 text-[13px] leading-[1.7] text-[color:var(--c-text-muted)]">
                {(REVIEW.summary ?? "")
                    .split("\n")
                    .filter(Boolean)
                    .map((l, i) => (
                        <li key={i}>{l.replace(/^-\s*/, "")}</li>
                    ))}
            </ul>

            <div className="relative mt-5 border-l border-[color:var(--c-border)] pl-0">
                <div className="divide-y divide-[color:var(--c-border)]/60 pl-4">
                    {findings.map((f, i) => (
                        <FindingRow key={i} f={f} rail />
                    ))}
                </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[color:var(--c-border)] pt-3.5 text-[11.5px] text-[color:var(--c-text-dim)]">
                <span>
                    correctness <b className="text-amber-600">medium</b>
                </span>
                <span>
                    security <b className="text-rose-600">low</b>
                </span>
                <span>
                    load / perf <b className="text-rose-600">low</b>
                </span>
                <span className="ml-auto">2 callers · 2 precedents · 1 test · build af71ce4</span>
            </div>

            <div className="mt-3">
                <MoreDetail r={REVIEW} />
            </div>
        </section>
    )
}

const OPTIONS = [
    { key: "brief", label: "A — Brief (8 findings)", note: "The pick. Verdict at full size, findings grouped by what you can do about them, metadata in a rail, one disclosure for reference. Shown at a realistic finding count, because three flatters any layout." },
    { key: "brief3", label: "A — Brief (3 findings)", note: "The same layout on the small review the other options use, for a like-for-like comparison." },
    { key: "thread", label: "B — Thread", note: "One rail, severity as a dot, no boxes. Reads like a colleague's comments; the metadata becomes a single quiet footer line." },
    { key: "current", label: "Current", note: "What ships today: twelve stacked <details> boxes, each with the same border, header and chevron." },
] as const

export default function ReviewRedesignPreview() {
    const [key, setKey] = useState<(typeof OPTIONS)[number]["key"]>("brief")
    const opt = OPTIONS.find((o) => o.key === key)!
    return (
        <div className="mx-auto flex max-w-[980px] flex-col gap-4 px-4 py-8">
            <h1 className="text-[18px] font-bold tracking-[-0.01em]">Review panel — proposals</h1>
            <p className="max-w-[70ch] text-[13px] leading-[1.65] text-[color:var(--c-text-muted)]">
                One review, three renderings. The same fixture the block preview uses, so the difference is the layout and
                nothing else.
            </p>

            <div className="flex flex-wrap gap-2">
                {OPTIONS.map((o) => (
                    <button
                        key={o.key}
                        type="button"
                        onClick={() => setKey(o.key)}
                        className={cn(
                            "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
                            key === o.key
                                ? "border-transparent bg-[color:var(--c-text)] text-[color:var(--c-surface)]"
                                : "border-[color:var(--c-border)] text-[color:var(--c-text-muted)] hover:border-[color:var(--c-border-strong)]",
                        )}
                    >
                        {o.label}
                    </button>
                ))}
            </div>
            <p className="max-w-[70ch] text-[12.5px] leading-[1.6] text-[color:var(--c-text-muted)]">{opt.note}</p>

            {key === "brief" && <Brief r={REVIEW_MANY} />}
            {key === "brief3" && <Brief r={REVIEW} />}
            {key === "thread" && <Thread />}
            {key === "current" && <PrReview analysis={ANALYSIS} rounds={[]} delta={null} />}
        </div>
    )
}
