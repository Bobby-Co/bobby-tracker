"use client"

import { useState } from "react"
import { PrReview } from "@/components/pulls/pr-review"
import { cn } from "@/components/ui/cn"
import type { PullRequestAnalysis } from "@/lib/shared/types"
import { REVIEW, REVIEW_MANY } from "./fixture"
import { Callout, Checklist, Claims, DependencyRail, RiskMatrix, SectionHead, SpecTable, TimelineRail } from "./blocks"
import { Icon } from "./glyphs"
import {
    ArchiveBanner,
    DegradedNote,
    EmptyState,
    FindingRow,
    Footer,
    InFlight,
    Meters,
    MetaRail,
    MoreDetail,
    ProgressLine,
    RailHeading,
    Rounds,
    ScoreBar,
    SEV,
    sevOf,
    VerdictBand,
} from "./parts"

// Every state the panel can be in, switchable, because a layout is only as good
// as its worst case and the worst cases are the ones nobody previews: an
// in-flight re-review over a standing round, a degraded pass, a profile that
// emits a risk matrix and a contract table, eight findings, none at all.

type Status = "done" | "analysing" | "queued" | "failed" | "cancelled"

const BLOCKS = [
    ["rounds", "Round strip"],
    ["progress", "Progress line"],
    ["callout", "Callout"],
    ["verdict", "Verdict + readiness"],
    ["risks", "Risk matrix"],
    ["summary", "Summary prose"],
    ["findings", "Findings"],
    ["contracts", "Contract changes"],
    ["timeline", "History"],
    ["deps", "Dependencies"],
    ["claims", "Fix claims"],
    ["checklist", "Checklist"],
    ["rail", "Metadata rail"],
    ["more", "More-detail disclosure"],
    ["footer", "Footer"],
] as const
type BlockKey = (typeof BLOCKS)[number][0]

const RISKS = [
    { label: "Purge runs against the home database", likelihood: "medium", impact: "high", detail: "An unbound project id reaches the regional delete with no cell resolved." },
    { label: "Partial delete leaves orphaned rows", likelihood: "low", impact: "medium", detail: "The purge aborts mid-way if the first regional read throws." },
]
const CONTRACTS = [
    { label: "ProjectDeletionService.delete", from: "(id: string)", to: "(id: string) throws", detail: "2" },
    { label: "ProjectsRepository.findCell", from: "string", to: "string | null", detail: "5" },
]
const HISTORY = [
    { when: "0062", label: "Added project_cells", detail: "Introduced the column this review depends on; no backfill." },
    { when: "4e25c98", label: "Cut C — multi-region data plane", detail: "Made the home fallback reachable in production." },
]
const DEPS = [
    { label: "pg", from: "8.11.3", to: "8.13.0", detail: "the driver the regional pool uses" },
    { label: "zod", from: "3.22.4", to: "4.0.1", detail: "major bump — parse errors changed shape" },
]

export default function ReviewStatesPreview() {
    const [status, setStatus] = useState<Status>("done")
    const [many, setMany] = useState(true)
    const [degraded, setDegraded] = useState(false)
    const [archived, setArchived] = useState(false)
    const [on, setOn] = useState<Record<BlockKey, boolean>>({
        rounds: true, progress: true, callout: false, verdict: true, risks: false, summary: true,
        findings: true, contracts: false, timeline: false, deps: false, claims: false,
        checklist: false, rail: true, more: true, footer: true,
    })
    const [compare, setCompare] = useState(false)

    const r = many ? REVIEW_MANY : REVIEW
    const toggle = (k: BlockKey) => setOn((o) => ({ ...o, [k]: !o[k] }))
    const all = (v: boolean) => setOn(Object.fromEntries(BLOCKS.map(([k]) => [k, v])) as Record<BlockKey, boolean>)

    const findings = [...(r.findings ?? [])].sort(
        (a, b) => ["critical", "review", "good"].indexOf(sevOf(a)) - ["critical", "review", "good"].indexOf(sevOf(b)),
    )
    const groups = [
        { key: "critical" as const, title: "Blocking" },
        { key: "review" as const, title: "Worth a look" },
        { key: "good" as const, title: "Done well" },
    ]

    const analysis: PullRequestAnalysis = {
        id: "preview", project_id: "p", pr_number: 1, status, github_comment_id: null, head_sha: null,
        result: r, review_profile_id: null, review_profile: { kind: "default" }, review_scope: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }

    const terminal = status === "failed" || status === "cancelled"

    return (
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 py-8">
            <header className="flex flex-col gap-1.5">
                <h1 className="text-[18px] font-bold tracking-[-0.01em]">Review panel — every state</h1>
                <p className="max-w-[76ch] text-[13px] leading-[1.65] text-[color:var(--c-text-muted)]">
                    Turn parts on and off. A review profile decides which blocks a review emits, so the panel has to hold
                    up for any subset — not just the one the default layout happens to produce.
                </p>
            </header>

            <div className="flex flex-col gap-3 rounded-[14px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] p-4">
                <Group label="Status">
                    {(["done", "analysing", "queued", "failed", "cancelled"] as Status[]).map((s) => (
                        <Pill key={s} on={status === s} onClick={() => setStatus(s)}>{s}</Pill>
                    ))}
                </Group>

                <Group label="Shape">
                    <Pill on={many} onClick={() => setMany((v) => !v)}>8 findings</Pill>
                    <Pill on={!many} onClick={() => setMany((v) => !v)}>3 findings</Pill>
                    <Pill on={degraded} onClick={() => setDegraded((v) => !v)}>degraded</Pill>
                    <Pill on={archived} onClick={() => setArchived((v) => !v)}>viewing round 1</Pill>
                    <Pill on={compare} onClick={() => setCompare((v) => !v)}>compare with current UI</Pill>
                </Group>

                <Group label="Blocks">
                    {BLOCKS.map(([k, label]) => (
                        <Check key={k} on={on[k]} onClick={() => toggle(k)}>{label}</Check>
                    ))}
                    <button type="button" onClick={() => all(true)} className="text-[11.5px] font-medium text-[color:var(--c-text-muted)] underline underline-offset-2">all</button>
                    <button type="button" onClick={() => all(false)} className="text-[11.5px] font-medium text-[color:var(--c-text-muted)] underline underline-offset-2">none</button>
                </Group>
            </div>

            <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5 shadow-[var(--shadow-card)] sm:p-6">
                <div className="mb-4 flex items-center gap-2">
                    <Icon name="search" size={15} className="text-amber-600" />
                    <h2 className="text-[14px] font-bold tracking-[-0.005em]">Ucelot · PR review</h2>
                    <span className="ml-auto rounded-full border border-[color:var(--c-border)] px-2 py-[2px] text-[11px] text-[color:var(--c-text-muted)]">
                        Payments — strict
                    </span>
                </div>

                <div className="flex flex-col gap-4">
                    {on.rounds && <Rounds />}
                    {(status === "analysing" || status === "queued") && <InFlight queued={status === "queued"} />}
                    {archived && <ArchiveBanner round={1} />}
                    {degraded && <DegradedNote />}

                    {terminal ? (
                        <EmptyState kind={status as "failed" | "cancelled"} />
                    ) : (
                        <>
                            {on.progress && <ProgressLine fixed={1} added={2} />}
                            {on.callout && (
                                <Callout
                                    title="Unbound projects reach a destructive path"
                                    body="Projects created before migration 0062 have no cell. findCell returns null and the delete proceeds against whatever the context is bound to."
                                    tone="critical"
                                />
                            )}
                            {on.verdict && <VerdictBand r={r} />}
                            {on.risks && <RiskMatrix items={RISKS} />}

                            <div className={cn("grid gap-6", on.rail && "lg:grid-cols-[minmax(0,1fr)_252px]")}>
                                <div className="flex min-w-0 flex-col gap-5">
                                    {on.summary && (
                                        <ul className="flex max-w-[72ch] list-disc flex-col gap-1 pl-4 text-[13px] leading-[1.7] text-[color:var(--c-text-muted)]">
                                            {(r.summary ?? "").split("\n").filter(Boolean).map((l, i) => <li key={i}>{l.replace(/^-\s*/, "")}</li>)}
                                        </ul>
                                    )}

                                    {on.findings &&
                                        groups.map((g) => {
                                            const items = findings.filter((f) => sevOf(f) === g.key)
                                            if (!items.length) return null
                                            return (
                                                <div key={g.key}>
                                                    <SectionHead icon={SEV[g.key].icon} count={items.length}>{g.title}</SectionHead>
                                                    <div className="divide-y divide-[color:var(--c-border)]">
                                                        {items.map((f, i) => <FindingRow key={i} f={f} />)}
                                                    </div>
                                                </div>
                                            )
                                        })}

                                    {on.contracts && <SpecTable items={CONTRACTS} />}
                                    {on.claims && <Claims items={r.fix_claims ?? []} />}
                                    {on.checklist && <Checklist items={r.checklist ?? []} />}
                                    {on.more && <MoreDetail r={r} />}

                                    {!on.rail && on.timeline && (
                                        <div>
                                            <SectionHead icon="chat" count={HISTORY.length}>History</SectionHead>
                                            <TimelineRail items={HISTORY} />
                                        </div>
                                    )}
                                    {!on.rail && on.deps && (
                                        <div>
                                            <SectionHead icon="nodes" count={DEPS.length}>Dependencies</SectionHead>
                                            <DependencyRail items={DEPS} />
                                        </div>
                                    )}

                                    {!on.summary && !on.findings && !on.contracts && !on.claims && !on.checklist && !on.more && !(on.timeline && !on.rail) && !(on.deps && !on.rail) && (
                                        <EmptyState kind="none" />
                                    )}
                                </div>
                                {on.rail && (
                                    <MetaRail
                                        r={r}
                                        extra={
                                            <>
                                                {on.timeline && (
                                                    <div>
                                                        <RailHeading icon="chat">History</RailHeading>
                                                        <TimelineRail items={HISTORY} />
                                                    </div>
                                                )}
                                                {on.deps && (
                                                    <div>
                                                        <RailHeading icon="nodes">Dependencies</RailHeading>
                                                        <DependencyRail items={DEPS} />
                                                    </div>
                                                )}
                                            </>
                                        }
                                    />
                                )}
                            </div>
                        </>
                    )}

                    {on.footer && !terminal && <Footer r={r} />}
                </div>
            </section>

            {compare && (
                <>
                    <h2 className="mt-2 text-[13px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">Current UI, same review</h2>
                    <PrReview analysis={analysis} rounds={[]} delta={null} />
                </>
            )}
        </div>
    )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span className="w-[54px] shrink-0 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">{label}</span>
            {children}
        </div>
    )
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "rounded-full border px-2.5 py-[3px] text-[11.5px] font-medium transition-colors",
                on
                    ? "border-transparent bg-[color:var(--c-text)] text-[color:var(--c-surface)]"
                    : "border-[color:var(--c-border)] text-[color:var(--c-text-muted)] hover:border-[color:var(--c-border-strong)]",
            )}
        >
            {children}
        </button>
    )
}

function Check({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "inline-flex items-center gap-1.5 rounded-[7px] border px-2 py-[3px] text-[11.5px] transition-colors",
                on
                    ? "border-[color:var(--c-border-strong)] bg-[color:var(--c-surface)] text-[color:var(--c-text)]"
                    : "border-[color:var(--c-border)] text-[color:var(--c-text-dim)]",
            )}
        >
            <span className={cn("grid h-3 w-3 place-items-center rounded-[3px] border", on ? "border-transparent bg-emerald-500 text-white" : "border-[color:var(--c-border-strong)]")}>
                {on && <Icon name="check" size={9} />}
            </span>
            {children}
        </button>
    )
}
