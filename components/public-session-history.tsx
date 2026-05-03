"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { readIssues, type PublicSubmittedIssue } from "@/lib/public-profile"

// Per-link submission history rendered under the form. Reads from
// localStorage (this browser only — the server doesn't track who
// submitted what) and re-reads on the custom append event so a fresh
// submission lands in the list without a refresh.
export function PublicSessionHistory({ token }: { token: string }) {
    const [items, setItems] = useState<PublicSubmittedIssue[]>([])
    const [hydrated, setHydrated] = useState(false)

    useEffect(() => {
        setItems(readIssues(token))
        setHydrated(true)
        function reread(e: Event) {
            const detail = (e as CustomEvent<{ token: string }>).detail
            if (!detail || detail.token === token) setItems(readIssues(token))
        }
        function rereadStorage(e: StorageEvent) {
            if (e.key && e.key.endsWith(`:${token}`)) setItems(readIssues(token))
        }
        window.addEventListener("bobby:public-issues-changed", reread as EventListener)
        window.addEventListener("storage", rereadStorage)
        return () => {
            window.removeEventListener("bobby:public-issues-changed", reread as EventListener)
            window.removeEventListener("storage", rereadStorage)
        }
    }, [token])

    if (!hydrated) return null
    if (items.length === 0) return null

    return (
        <section className="rounded-[14px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
            <header className="flex items-baseline justify-between gap-2">
                <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                    Your submissions
                </h2>
                <span className="text-[11px] text-[color:var(--c-text-dim)]">
                    Saved on this device only
                </span>
            </header>
            <ul className="mt-3 flex flex-col divide-y divide-[color:var(--c-border)]">
                {items.map((it) => (
                    <li key={it.id}>
                        <Link
                            href={`/p/${token}/issues/${it.id}`}
                            className="-mx-2 flex items-start gap-3 rounded-[10px] px-2 py-2.5 transition-colors hover:bg-[color:var(--c-surface-2)]"
                        >
                            <span className="shrink-0 rounded-md bg-[color:var(--c-surface-2)] px-1.5 py-0.5 font-mono text-[11.5px] font-semibold tabular-nums text-[color:var(--c-text)]">
                                #{it.issue_number}
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-medium text-[color:var(--c-text)]">
                                    {it.title}
                                </div>
                                <div className="text-[11px] text-[color:var(--c-text-dim)]">
                                    <time dateTime={it.created_at}>
                                        {new Date(it.created_at).toLocaleString()}
                                    </time>
                                </div>
                            </div>
                            <svg
                                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                strokeWidth="2" strokeLinecap="round"
                                className="mt-1 shrink-0 text-[color:var(--c-text-dim)]"
                                aria-hidden
                            >
                                <path d="M9 6l6 6-6 6" />
                            </svg>
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    )
}
