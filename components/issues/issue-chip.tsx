"use client"

import Link from "next/link"
import type { ReactNode } from "react"

// An inline issue reference, rendered from an `issue:` markdown link by
// MarkdownBody. It reads as a pill mid-sentence ("blocked by #42 Login loops")
// and links to the real issue route — the `issue:` href it came from is inert on
// its own. Self-contained: both ids ride in the reference, so no lookup and no
// signed map are needed to draw or follow it.
export function IssueChip({
    projectId,
    issueId,
    children,
}: {
    projectId: string
    issueId: string
    children?: ReactNode
}) {
    return (
        <Link
            href={`/projects/${projectId}/issues/${issueId}`}
            prefetch={false}
            className="mx-[1px] inline-flex max-w-full items-center gap-1 rounded-[7px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-1.5 py-[1px] align-[-0.15em] text-[0.92em] font-medium leading-tight text-[color:var(--c-text)] no-underline transition-colors hover:border-[color:var(--c-border-strong)] hover:bg-[color:var(--c-overlay)]"
        >
            <IssueGlyph />
            <span className="truncate">{children}</span>
        </Link>
    )
}

function IssueGlyph() {
    return (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-[color:var(--c-text-dim)]">
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="8" cy="8" r="1.6" fill="currentColor" />
        </svg>
    )
}
