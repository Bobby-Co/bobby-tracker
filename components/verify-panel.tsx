"use client"

import { useEffect, useState } from "react"
import { cn } from "@/components/cn"
import { createClient } from "@/lib/supabase/client"
import { blobUrl, type RepoRef } from "@/lib/github"
import type { VerifyReport, VerifyBrokenCite, VerifyStaleNote, VerifyContentStaleNote } from "@/lib/analyser"

// VerifyPanel shows a "graph health" coverage report for a project.
// No LLM cost — the analyser server clones the repo, validates every
// note's file:line citations against live source, and computes last-
// commit drift.
//
// Persistence model: every verify run (manual button, post-update QC,
// post-bootstrap QC) writes the latest report to project_analyser.
// last_health_report. The page passes that as initialReport; we then
// subscribe to realtime so the panel auto-refreshes whenever a
// server-side run finishes a new report. Refreshing the tab no longer
// clears the data.
export function VerifyPanel({
    projectId,
    repo,
    indexedSha,
    ready,
    initialReport,
    initialCheckedAt,
}: {
    projectId: string
    repo: RepoRef | null
    indexedSha: string | null
    ready: boolean
    initialReport: unknown
    initialCheckedAt: string | null
}) {
    const [report, setReport] = useState<VerifyReport | null>(
        (initialReport as VerifyReport | null) ?? null,
    )
    const [checkedAt, setCheckedAt] = useState<string | null>(initialCheckedAt)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [collapsed, setCollapsed] = useState(false)
    // `flash` rides a brief CSS ring + soft pulse whenever the report
    // changes (manual click, realtime delivery from a server-side QC).
    // Toggled on for 1.5s then off — the transition classes do the rest.
    const [flash, setFlash] = useState(false)

    useEffect(() => {
        if (!flash) return
        const t = setTimeout(() => setFlash(false), 1500)
        return () => clearTimeout(t)
    }, [flash])

    // Realtime: when project_analyser.last_health_report changes
    // (post-update QC, post-bootstrap QC, or another tab clicked
    // verify), pick it up here so the panel always shows the latest
    // run without a manual refresh. Trigger the flash so the user
    // notices the data just changed.
    useEffect(() => {
        const supabase = createClient()
        const channel = supabase
            .channel(`project-analyser-health-${projectId}`)
            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "tracker",
                    table: "project_analyser",
                    filter: `project_id=eq.${projectId}`,
                },
                (payload) => {
                    const row = payload.new as { last_health_report?: unknown; last_health_check_at?: string | null }
                    if (row.last_health_report) {
                        setReport(row.last_health_report as VerifyReport)
                        setFlash(true)
                    }
                    if (row.last_health_check_at) {
                        setCheckedAt(row.last_health_check_at)
                    }
                },
            )
            .subscribe()
        return () => {
            void supabase.removeChannel(channel)
        }
    }, [projectId])

    async function run() {
        setBusy(true)
        setError(null)
        try {
            const res = await fetch(`/api/projects/${projectId}/verify`, { method: "POST" })
            if (!res.ok) {
                const e = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
                setError(e?.error?.message || `Failed (${res.status})`)
                return
            }
            const r = (await res.json()) as VerifyReport
            setReport(r)
            setCheckedAt(new Date().toISOString())
            setFlash(true)
            // The route also persists to Supabase; realtime will deliver
            // the same payload to other tabs / sessions automatically.
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div
            className={cn(
                "card transition-shadow duration-700",
                flash && "ring-2 ring-emerald-400/70 shadow-lg shadow-emerald-100",
            )}
        >
            <div className="card-title">
                <ShieldIcon />
                <span>Graph health</span>
                {report && <HealthChip score={report.overall_health} />}
                <span className="ml-auto" />
                {report && (
                    <button
                        type="button"
                        onClick={() => setCollapsed((v) => !v)}
                        aria-expanded={!collapsed}
                        title={collapsed ? "Expand" : "Collapse"}
                        className="btn-ghost px-2 py-1.5 text-[12px]"
                    >
                        <Chevron open={!collapsed} />
                    </button>
                )}
                <button
                    onClick={run}
                    disabled={!ready || busy}
                    title={!ready ? "Index this project first" : undefined}
                    className="btn-primary px-3 py-1.5 text-[12px]"
                >
                    {busy ? "Verifying…" : report ? "Re-verify" : "Verify graph"}
                </button>
            </div>
            <p className="mt-1.5 text-[12.5px] text-[color:var(--c-text-muted)]">
                Walks every note&apos;s <span className="font-mono">file:line</span> citations and last-commit drift against live source. No LLM cost; ~10–30s.
            </p>

            {error && (
                <p className="mt-3 rounded-[12px] bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                    {error}
                </p>
            )}

            {/* Collapsible body. Grid-rows trick gives a smooth height
                animation without measuring DOM heights — the inner div
                takes auto height and the outer grid expands into it. */}
            <div
                className={cn(
                    "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
                    collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
                )}
                aria-hidden={collapsed}
            >
                <div className="overflow-hidden">

            {report && (
                <div className="mt-4 flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
                        <Stat label="Notes" value={String(report.notes)} />
                        <Stat
                            label="Citation hit rate"
                            value={
                                report.citations_total === 0
                                    ? "n/a"
                                    : `${Math.round(report.hit_rate * 100)}% (${report.citations_resolved}/${report.citations_total})`
                            }
                        />
                        <Stat
                            label="Coverage"
                            value={
                                report.indexed_files === 0
                                    ? "n/a"
                                    : `${Math.round(report.coverage_rate * 100)}% (${report.covered_files}/${report.indexed_files})`
                            }
                            sub={
                                report.uncovered_total > 0
                                    ? `${report.uncovered_total} file${report.uncovered_total === 1 ? "" : "s"} uncovered`
                                    : undefined
                            }
                        />
                        <Stat
                            label="Median drift"
                            value={
                                Object.values(report.drift_buckets ?? {}).reduce((a, b) => a + b, 0) === 0
                                    ? "n/a"
                                    : `${report.drift_median} commit${report.drift_median === 1 ? "" : "s"}`
                            }
                            sub={
                                report.content_stale_total > 0
                                    ? `${report.content_stale_total} content-stale`
                                    : undefined
                            }
                        />
                        <Stat
                            label="HEAD"
                            value={report.head_sha ? report.head_sha.slice(0, 7) : "—"}
                            mono
                        />
                    </div>

                    <DriftBars buckets={report.drift_buckets} />

                    {report.citations_broken && report.citations_broken.length > 0 && (
                        <BrokenCites items={report.citations_broken} repo={repo} sha={indexedSha} />
                    )}

                    {report.content_stale_notes && report.content_stale_notes.length > 0 && (
                        <ContentStaleList items={report.content_stale_notes} repo={repo} sha={indexedSha} />
                    )}

                    {report.uncovered_files && report.uncovered_files.length > 0 && (
                        <UncoveredFilesList
                            items={report.uncovered_files}
                            total={report.uncovered_total}
                            repo={repo}
                            sha={indexedSha}
                        />
                    )}

                    {report.stalest_notes && report.stalest_notes.length > 0 && (
                        <StaleList items={report.stalest_notes} />
                    )}

                    <p className="text-[10.5px] text-[color:var(--c-text-dim)]">
                        {checkedAt
                            ? `Last verified ${new Date(checkedAt).toLocaleString()}`
                            : `Generated ${new Date(report.generated_at).toLocaleString()}`}
                        .
                    </p>
                </div>
            )}
                </div>
            </div>
        </div>
    )
}

function Chevron({ open }: { open: boolean }) {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={cn("transition-transform duration-200", open ? "rotate-180" : "rotate-0")}
        >
            <path d="M6 9l6 6 6-6" />
        </svg>
    )
}

function HealthChip({ score }: { score: number }) {
    const pct = Math.round(score * 100)
    let cls = "pill pill-success"
    if (score < 0.85) cls = "pill pill-warn"
    if (score < 0.6) cls = "pill pill-error"
    return <span className={`ml-2 ${cls}`}>{pct}%</span>
}

function DriftBars({ buckets }: { buckets: Record<string, number> }) {
    const order = ["0", "1-10", "11-50", "51+"]
    const total = order.reduce((a, k) => a + (buckets[k] ?? 0), 0)
    if (total === 0) return null
    return (
        <div>
            <SectionLabel>Notes by commit drift</SectionLabel>
            <div className="mt-2 flex flex-col gap-1.5">
                {order.map((k) => {
                    const n = buckets[k] ?? 0
                    const pct = total > 0 ? (n / total) * 100 : 0
                    return (
                        <div key={k} className="flex items-center gap-3 text-[12px]">
                            <span className="w-14 shrink-0 font-mono text-[color:var(--c-text-muted)]">{k}</span>
                            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--c-border)]">
                                <div
                                    className={cn(
                                        "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500",
                                        k === "0" && "bg-emerald-500",
                                        k === "1-10" && "bg-amber-400",
                                        k === "11-50" && "bg-amber-600",
                                        k === "51+" && "bg-rose-600",
                                    )}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                            <span className="w-10 shrink-0 text-right tabular-nums text-[color:var(--c-text-muted)]">{n}</span>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

function BrokenCites({ items, repo, sha }: { items: VerifyBrokenCite[]; repo: RepoRef | null; sha: string | null }) {
    return (
        <div>
            <SectionLabel>Broken citations ({items.length} shown)</SectionLabel>
            <ul className="mt-2 flex flex-col gap-1">
                {items.map((c, i) => {
                    const url = repo ? blobUrl(repo, c.file, c.line, sha) : null
                    const label = c.line ? `${c.file}:${c.line}` : c.file
                    return (
                        <li key={`${c.note_path}:${c.file}:${c.line ?? 0}:${i}`} className="text-[12.5px]">
                            <span className="font-mono text-[color:var(--c-text-muted)]">{c.note_path}</span>
                            <span className="text-[color:var(--c-text-muted)]"> → </span>
                            {url ? (
                                <a href={url} target="_blank" rel="noreferrer" className="font-mono text-[color:var(--c-text)] hover:underline">
                                    {label}
                                </a>
                            ) : (
                                <span className="font-mono">{label}</span>
                            )}
                            <span className="ml-2 text-[11px] text-rose-700">{c.reason}</span>
                        </li>
                    )
                })}
            </ul>
        </div>
    )
}

function StaleList({ items }: { items: VerifyStaleNote[] }) {
    return (
        <div>
            <SectionLabel>Stalest notes</SectionLabel>
            <ul className="mt-2 flex flex-col gap-1">
                {items.map((s) => (
                    <li key={s.path} className="flex items-center gap-3 text-[12.5px]">
                        <span className="flex-1 truncate font-mono">{s.path}</span>
                        <span className="font-mono text-[color:var(--c-text-muted)]">{s.last_commit.slice(0, 7)}</span>
                        <span className="w-24 shrink-0 text-right tabular-nums text-[color:var(--c-text-muted)]">
                            {s.commits_behind < 0 ? "unknown" : `${s.commits_behind} commit${s.commits_behind === 1 ? "" : "s"} behind`}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    )
}

function Stat({ label, value, mono, sub }: { label: string; value: string; mono?: boolean; sub?: string }) {
    return (
        <div>
            <div className="text-[10.5px] font-bold uppercase tracking-[0.10em] text-[color:var(--c-text-dim)]">
                {label}
            </div>
            <div className={cn("mt-0.5 truncate text-[12.5px]", mono && "font-mono")}>{value}</div>
            {sub && <div className="mt-0.5 truncate text-[10.5px] text-[color:var(--c-text-dim)]">{sub}</div>}
        </div>
    )
}

function ContentStaleList({
    items,
    repo,
    sha,
}: {
    items: VerifyContentStaleNote[]
    repo: RepoRef | null
    sha: string | null
}) {
    return (
        <div>
            <SectionLabel>Content-stale notes ({items.length} shown)</SectionLabel>
            <p className="mt-1 text-[11px] text-[color:var(--c-text-muted)]">
                Cited files have changed since the note was written. Sharper than commit-distance — the underlying code actually moved.
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
                {items.map((s) => (
                    <li key={s.path} className="text-[12.5px]">
                        <div className="flex items-center gap-2">
                            <span className="font-mono">{s.path}</span>
                            <span className="text-[11px] text-[color:var(--c-text-muted)]">
                                last_commit {s.last_commit.slice(0, 7)}
                            </span>
                        </div>
                        <ul className="mt-0.5 ml-4 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px]">
                            {s.changed_cited_files.map((f) => {
                                const url = repo ? blobUrl(repo, f, undefined, sha) : null
                                return (
                                    <li key={f}>
                                        {url ? (
                                            <a href={url} target="_blank" rel="noreferrer" className="font-mono text-[color:var(--c-text-muted)] hover:underline">
                                                {f}
                                            </a>
                                        ) : (
                                            <span className="font-mono text-[color:var(--c-text-muted)]">{f}</span>
                                        )}
                                    </li>
                                )
                            })}
                        </ul>
                    </li>
                ))}
            </ul>
        </div>
    )
}

function UncoveredFilesList({
    items,
    total,
    repo,
    sha,
}: {
    items: string[]
    total: number
    repo: RepoRef | null
    sha: string | null
}) {
    const remainder = total - items.length
    return (
        <div>
            <SectionLabel>Uncovered indexed files ({items.length} shown of {total})</SectionLabel>
            <p className="mt-1 text-[11px] text-[color:var(--c-text-muted)]">
                The indexer knows about these files but no note cites them. Smart-update will mention them when the next commit touches them.
            </p>
            <ul className="mt-2 flex flex-col gap-0.5">
                {items.map((f) => {
                    const url = repo ? blobUrl(repo, f, undefined, sha) : null
                    return (
                        <li key={f} className="text-[12px]">
                            {url ? (
                                <a href={url} target="_blank" rel="noreferrer" className="font-mono hover:underline">
                                    {f}
                                </a>
                            ) : (
                                <span className="font-mono">{f}</span>
                            )}
                        </li>
                    )
                })}
                {remainder > 0 && (
                    <li className="text-[11px] text-[color:var(--c-text-muted)]">
                        … and {remainder} more
                    </li>
                )}
            </ul>
        </div>
    )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-[10.5px] font-bold uppercase tracking-[0.10em] text-[color:var(--c-text-dim)]">
            {children}
        </div>
    )
}

function ShieldIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
            <path d="M9 12l2 2 4-4" />
        </svg>
    )
}
