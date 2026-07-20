"use client"

import { useEffect, useState } from "react"
import { cn } from "@/components/ui/cn"
import {
    mergeGate,
    MERGE_METHOD_LABEL,
    type MergeBlockCode,
    type MergeGate,
    type MergeMethod,
    type MergeMethods,
} from "@/lib/pulls/merge-gate"
import type { PullRequest, PullRequestAnalysis } from "@/lib/supabase/types"

// The merge control on the PR-detail page. Sits between the header and the
// review panel because it depends on both: the PR's lifecycle AND the review's
// verdict.
//
// The gate is computed CLIENT-SIDE from the same mergeGate() the server enforces
// — so the common blocked states (in review, has blockers, already merged) paint
// instantly with no round-trip. The GitHub-backed extras (which merge methods
// the repo allows, live conflict state) are only fetched when the gate passes,
// exactly as the route does. The POST re-checks the gate regardless: this UI is
// convenience, not the security boundary.

interface MergeInfo {
    connected: boolean
    methods: MergeMethods | null
    default_method: MergeMethod | null
    mergeable: boolean | null
    mergeable_state: string | null
}

export function PrMergeBar({
    projectId,
    pull,
    analysis,
    onMerged,
}: {
    projectId: string
    pull: PullRequest
    analysis: PullRequestAnalysis | null
    onMerged: () => void
}) {
    const gate = mergeGate(pull, analysis)

    // Already merged is its own terminal, celebratory state — not a "blocked"
    // one. Show it and stop.
    if (pull.merged) {
        return (
            <Frame tone="merged">
                <MergedGlyph />
                <span className="font-semibold text-[color:var(--c-text)]">
                    Merged{pull.merged_at ? ` · ${new Date(pull.merged_at).toLocaleDateString()}` : ""}
                </span>
            </Frame>
        )
    }

    if (!gate.mergeable) return <BlockedBar gate={gate} pull={pull} projectId={projectId} onReviewStarted={onMerged} />

    return <MergeableBar projectId={projectId} pull={pull} onMerged={onMerged} />
}

// The two block states a manual review can rescue: a PR that never got one
// (opened before the project was connected, or while the system was down), and
// one whose run failed or was cancelled. Both are dead-ends the analyser won't
// retry on its own, so the button is the only way forward short of GitHub.
const CAN_RUN_REVIEW = new Set<MergeBlockCode>(["no_review", "review_incomplete"])

// ── blocked ───────────────────────────────────────────────────────────────
// The gate said no. Explain why, and offer the fix when there is one in-app.
function BlockedBar({
    gate,
    pull,
    projectId,
    onReviewStarted,
}: {
    gate: MergeGate
    pull: PullRequest
    projectId: string
    onReviewStarted: () => void
}) {
    const block = gate.block!
    const [running, setRunning] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    const runReview = async () => {
        setRunning(true)
        setErr(null)
        try {
            const res = await fetch(`/api/projects/${projectId}/pulls/${pull.pr_number}/review`, {
                method: "POST",
                credentials: "same-origin",
            })
            const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
            if (!res.ok) {
                setErr(body?.error?.message ?? "Couldn't start the review.")
                return
            }
            // Row is now 'analysing' (the route confirms it before returning) —
            // refetch so the bar flips to "Review in progress…".
            onReviewStarted()
        } catch {
            setErr("Network error — the review may not have started. Refresh to check.")
        } finally {
            setRunning(false)
        }
    }

    // Blockers and the "review in progress" wait are amber (attention / wait);
    // the terminal lifecycle states are just muted (nothing to do here).
    const attention = block.code === "critical" || block.transient
    const canRun = CAN_RUN_REVIEW.has(block.code)

    return (
        <Frame tone={attention ? "warn" : "muted"} column={canRun}>
            <div className="flex w-full items-center gap-2">
                <StatusDot code={block.code} />
                <span className="font-semibold text-[color:var(--c-text)]">{block.label}</span>
                <span className="ml-auto flex items-center gap-3">
                    {block.code === "critical" && (
                        // The blockers are already rendered below — scroll to them rather
                        // than restating them here.
                        <a href="#pr-review" className="text-[12px] font-semibold text-[color:var(--c-primary)] hover:underline">
                            View blockers
                        </a>
                    )}
                    {canRun && (
                        <button
                            type="button"
                            onClick={runReview}
                            disabled={running}
                            className="btn-primary px-3 py-1.5 text-[12px]"
                        >
                            {running ? "Starting…" : block.code === "review_incomplete" ? "Re-run review" : "Run review"}
                        </button>
                    )}
                    <GithubLink pull={pull} />
                </span>
            </div>
            {err && <p className="w-full text-[11.5px] font-medium text-[color:var(--c-error)]">{err}</p>}
        </Frame>
    )
}

// ── mergeable ───────────────────────────────────────────────────────────────
function MergeableBar({
    projectId,
    pull,
    onMerged,
}: {
    projectId: string
    pull: PullRequest
    onMerged: () => void
}) {
    const [info, setInfo] = useState<MergeInfo | null>(null)
    const [loading, setLoading] = useState(true)
    const [method, setMethod] = useState<MergeMethod | null>(null)
    const [armed, setArmed] = useState(false)
    const [merging, setMerging] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    // Fetch the repo's allowed methods + GitHub's live mergeability. The gate
    // already passed, so this is the only round-trip.
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const res = await fetch(`/api/projects/${projectId}/pulls/${pull.pr_number}/merge`, {
                    cache: "no-store",
                    credentials: "same-origin",
                })
                if (!res.ok || cancelled) return
                const data = (await res.json()) as MergeInfo
                if (cancelled) return
                setInfo(data)
                setMethod(data.default_method ?? "merge")
            } catch {
                // Leave info null → the "couldn't load merge options" note renders.
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [projectId, pull.pr_number])

    const doMerge = async () => {
        if (!method) return
        setMerging(true)
        setErr(null)
        try {
            const res = await fetch(`/api/projects/${projectId}/pulls/${pull.pr_number}/merge`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ method }),
            })
            const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
            if (!res.ok) {
                setErr(body?.error?.message ?? "Merge failed.")
                setArmed(false)
                return
            }
            onMerged()
        } catch {
            setErr("Network error — the merge may or may not have happened. Refresh to check.")
            setArmed(false)
        } finally {
            setMerging(false)
        }
    }

    if (loading) {
        return (
            <Frame tone="ready">
                <span className="skeleton h-4 w-40 rounded" />
            </Frame>
        )
    }

    // App not linked to this repo — can't merge from here.
    if (info && !info.connected) {
        return (
            <Frame tone="muted">
                <StatusDot code="review_incomplete" />
                <span className="font-semibold text-[color:var(--c-text)]">Connect the GitHub App to merge here</span>
                <span className="ml-auto">
                    <GithubLink pull={pull} />
                </span>
            </Frame>
        )
    }

    const methods = info?.methods ?? { merge: true, squash: true, rebase: true }
    const available = (["merge", "squash", "rebase"] as MergeMethod[]).filter((m) => methods[m])
    // GitHub says it can't cleanly merge (conflicts / branch protection). We still
    // let them try — GitHub is the authority and returns a precise error — but we
    // warn first so the failure isn't a surprise.
    const conflict = info?.mergeable === false || info?.mergeable_state === "dirty"

    return (
        <Frame tone="ready" column>
            <div className="flex w-full flex-wrap items-center gap-2">
                <CheckGlyph />
                <span className="font-semibold text-[color:var(--c-text)]">Ready to merge</span>
                {pull.base_ref && (
                    <span className="text-[12px] text-[color:var(--c-text-muted)]">
                        into <span className="font-mono text-[color:var(--c-text)]">{pull.base_ref}</span>
                    </span>
                )}

                <span className="ml-auto flex items-center gap-2">
                    {!armed ? (
                        <button
                            type="button"
                            onClick={() => setArmed(true)}
                            disabled={available.length === 0}
                            className="btn-primary px-3.5 py-1.5 text-[12.5px]"
                        >
                            {method ? MERGE_METHOD_LABEL[method] : "Merge"}
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={() => setArmed(false)}
                                disabled={merging}
                                className="btn-ghost px-3 py-1.5 text-[12.5px]"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={doMerge}
                                disabled={merging}
                                className="btn-primary px-3.5 py-1.5 text-[12.5px]"
                            >
                                {merging ? "Merging…" : `Confirm — ${pull.base_ref ? `merge into ${pull.base_ref}` : "merge"}`}
                            </button>
                        </>
                    )}
                </span>
            </div>

            {/* Method picker — only when the repo enables more than one, and only
                before arming (changing strategy mid-confirm would be a foot-gun). */}
            {!armed && available.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {available.map((m) => (
                        <button
                            key={m}
                            type="button"
                            onClick={() => setMethod(m)}
                            className={cn(
                                "rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                                method === m
                                    ? "border-transparent bg-[color:var(--c-primary)] text-white"
                                    : "border-[color:var(--c-border)] bg-white text-[color:var(--c-text-muted)] hover:border-[color:var(--c-border-strong)]",
                            )}
                        >
                            {MERGE_METHOD_LABEL[m]}
                        </button>
                    ))}
                </div>
            )}

            {conflict && (
                <p className="text-[11.5px] text-[color:var(--c-warn)]">
                    GitHub reports this branch isn&apos;t cleanly mergeable (conflicts or branch protection). You can
                    still try — GitHub will say exactly why if it refuses.
                </p>
            )}
            {err && <p className="text-[11.5px] font-medium text-[color:var(--c-error)]">{err}</p>}
        </Frame>
    )
}

// ── chrome ────────────────────────────────────────────────────────────────
type Tone = "ready" | "warn" | "muted" | "merged"
const TONE_RING: Record<Tone, string> = {
    ready: "border-emerald-200 bg-emerald-50/40",
    warn: "border-amber-200 bg-amber-50/40",
    muted: "border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]",
    merged: "border-violet-200 bg-violet-50/40",
}

function Frame({ tone, column, children }: { tone: Tone; column?: boolean; children: React.ReactNode }) {
    return (
        <div
            className={cn(
                "rounded-[14px] border px-4 py-3 text-[13px]",
                TONE_RING[tone],
                column ? "flex flex-col gap-2" : "flex items-center gap-2",
            )}
        >
            {children}
        </div>
    )
}

function GithubLink({ pull }: { pull: PullRequest }) {
    if (!pull.html_url) return null
    return (
        <a
            href={pull.html_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)] hover:underline"
        >
            On GitHub
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M7 17 17 7M9 7h8v8" />
            </svg>
        </a>
    )
}

function StatusDot({ code }: { code: MergeBlockCode }) {
    const color =
        code === "critical"
            ? "bg-rose-500"
            : code === "review_pending"
              ? "bg-amber-500 animate-pulse"
              : code === "no_review"
                ? "bg-amber-400"
                : "bg-zinc-400"
    return <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", color)} />
}

function CheckGlyph() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-emerald-600">
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 12.5l2.5 2.5 4.5-5" />
        </svg>
    )
}
function MergedGlyph() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-violet-600">
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="6" cy="18" r="2.5" />
            <circle cx="18" cy="9" r="2.5" />
            <path d="M6 8.5v7M18 11.5v.5a6 6 0 0 1-6 6H8" />
        </svg>
    )
}
