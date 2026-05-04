"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Spinner } from "@/components/spinner"

export interface SimilarIssue {
    id: string
    issue_number: number
    title: string
    status: string
    similarity: number
}

// Variants:
//   "auth"   — links to /projects/<projectId>/issues/<id> and shows
//              a "Mark as duplicate of #N" action that talks to
//              /api/issues/<currentId>/duplicate-of.
//   "public" — links to /p/<token>/issues/<id> and renders read-only
//              (anonymous submitters can't mutate the maintainer's
//              issues from the public flow).
type Variant = "auth" | "public"

// Polled-on-mount card that shows already-existing issues whose
// embeddings are nearest to the current one. Lives on the issue
// detail page (both auth + public). The fetch is on the client
// because the embedding for a freshly-created issue is generated
// fire-and-forget by the create endpoint — the row may still be
// empty when the page first renders. We retry a handful of times
// with backoff so the card pops in once the embedder catches up,
// instead of showing "no similar issues" and never updating.
export function SimilarIssuesCard({
    issueId,
    variant,
    projectId,
    token,
    duplicateOfIssueId,
}: {
    issueId: string
    variant: Variant
    /** Required for variant="auth" — used to build issue links. */
    projectId?: string
    /** Required for variant="public" — used to build issue links and
     *  to authorize the lookup against the session. */
    token?: string
    /** When set, the current issue is already linked as a duplicate
     *  of another. We render that prominently and skip the lookup. */
    duplicateOfIssueId?: string | null
}) {
    const [similar, setSimilar] = useState<SimilarIssue[] | null>(null)
    // "missing" — the embedding row never showed up after the
    // backoff window ran out. Most likely an issue created before
    // the embedding pipeline existed; we surface that state to the
    // user instead of silently rendering nothing or spinning forever.
    const [status, setStatus] = useState<"loading" | "ready" | "error" | "missing">("loading")
    const [marking, setMarking] = useState<string | null>(null)
    const [markErr, setMarkErr] = useState<string | null>(null)

    useEffect(() => {
        if (duplicateOfIssueId) {
            // Already a known duplicate — no lookup needed; we render
            // the banner short-circuit above. Setting status here is
            // the cleanup path for the polling effect.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setStatus("ready")
            return
        }
        let cancelled = false

        // Poll: 0s, 1.5s, 4s, 8s. The embedder usually finishes in
        // ~600ms but cold OpenAI calls can stretch to a few seconds.
        const delays = [0, 1500, 4000, 8000]
        let attempt = 0

        async function tick() {
            if (cancelled) return
            const url = variant === "auth"
                ? `/api/issues/${issueId}/similar`
                : `/api/public-issues/${issueId}/similar?token=${encodeURIComponent(token ?? "")}`
            try {
                const res = await fetch(url, { cache: "no-store" })
                if (cancelled) return
                if (!res.ok) {
                    setStatus("error")
                    return
                }
                const data = await res.json() as {
                    similar?: SimilarIssue[]
                    pending?: boolean
                    missing?: boolean
                }
                const list = Array.isArray(data.similar) ? data.similar : []
                // Server-decided "missing": the issue is old enough
                // that no embedding will ever come. Skip the rest of
                // the polling window — render "not available" right
                // away instead of sitting on a spinner.
                if (data.missing) {
                    setSimilar([])
                    setStatus("missing")
                    return
                }
                if (list.length > 0 || !data.pending) {
                    setSimilar(list)
                    setStatus("ready")
                    return
                }
                // Pending: embedder is probably still working.
                // Schedule next attempt; if the window runs out
                // without a response, treat as missing too as a
                // belt-and-suspenders against the server's age check.
                attempt += 1
                if (attempt < delays.length) {
                    setTimeout(tick, delays[attempt])
                } else {
                    setSimilar([])
                    setStatus("missing")
                }
            } catch {
                if (!cancelled) setStatus("error")
            }
        }
        const t = setTimeout(tick, delays[0])
        return () => { cancelled = true; clearTimeout(t) }
    }, [issueId, variant, token, duplicateOfIssueId])

    function hrefFor(s: SimilarIssue) {
        return variant === "auth"
            ? `/projects/${projectId}/issues/${s.id}`
            : `/p/${token}/issues/${s.id}`
    }

    async function markAsDuplicate(target: SimilarIssue) {
        if (variant !== "auth") return
        setMarkErr(null)
        setMarking(target.id)
        try {
            const res = await fetch(`/api/issues/${issueId}/duplicate-of`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ duplicate_of_issue_id: target.id }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => ({}))
                setMarkErr(e?.error?.message || `Failed (${res.status})`)
                return
            }
            // Soft-reload: easiest way to refresh the page's
            // duplicate banner + remove this card.
            window.location.reload()
        } catch (e) {
            setMarkErr(e instanceof Error ? e.message : String(e))
        } finally {
            setMarking(null)
        }
    }

    // Already a known duplicate — short, clear banner.
    if (duplicateOfIssueId) {
        return (
            <section className="rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                <span className="font-bold">Marked as duplicate.</span>{" "}
                Linked to{" "}
                <Link
                    href={
                        variant === "auth"
                            ? `/projects/${projectId}/issues/${duplicateOfIssueId}`
                            : `/p/${token}/issues/${duplicateOfIssueId}`
                    }
                    className="font-mono underline"
                >
                    the original issue
                </Link>.
            </section>
        )
    }

    if (status === "loading") {
        return (
            <section className="rounded-[14px] border border-dashed border-[color:var(--c-border)] bg-white px-4 py-3 text-[12.5px] text-[color:var(--c-text-muted)]">
                <Spinner /> Looking for similar issues…
            </section>
        )
    }
    if (status === "missing") {
        // Old issue, never embedded. Tell the user explicitly so
        // they don't wonder whether the lookup is just slow or
        // whether there genuinely are no similar issues.
        return (
            <section className="rounded-[14px] border border-dashed border-[color:var(--c-border)] bg-white px-4 py-3 text-[12.5px] text-[color:var(--c-text-muted)]">
                <span className="font-semibold text-[color:var(--c-text)]">Similarity check unavailable.</span>{" "}
                This issue was filed before similarity indexing was added, so we can&apos;t suggest related issues for it yet.
            </section>
        )
    }
    if (status === "error" || !similar || similar.length === 0) return null

    return (
        <section className="rounded-[14px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
            <header className="flex items-baseline justify-between gap-2">
                <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                    Looks similar to
                </h2>
                <span className="text-[11.5px] tabular-nums text-[color:var(--c-text-dim)]">
                    {similar.length} match{similar.length === 1 ? "" : "es"}
                </span>
            </header>

            <ul className="mt-3 flex flex-col divide-y divide-[color:var(--c-border)]">
                {similar.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 py-2.5">
                        <Link
                            href={hrefFor(s)}
                            className="flex min-w-0 flex-1 items-center gap-3 hover:underline"
                        >
                            <span className="rounded-md bg-[color:var(--c-surface-2)] px-1.5 py-0.5 font-mono text-[11.5px] font-semibold tabular-nums">
                                #{s.issue_number}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[13px]">{s.title}</span>
                        </Link>
                        <span className="shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--c-text-dim)]">
                            {Math.round(s.similarity * 100)}%
                        </span>
                        {variant === "auth" && (
                            <button
                                type="button"
                                onClick={() => markAsDuplicate(s)}
                                disabled={marking !== null}
                                className="shrink-0 rounded-[8px] bg-zinc-900 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-zinc-950 disabled:opacity-60"
                            >
                                {marking === s.id ? "Marking…" : "Duplicate of"}
                            </button>
                        )}
                    </li>
                ))}
            </ul>
            {markErr && (
                <p role="alert" className="mt-2 rounded-[8px] bg-rose-50 px-3 py-1.5 text-[11.5px] text-rose-800">
                    {markErr}
                </p>
            )}
        </section>
    )
}
