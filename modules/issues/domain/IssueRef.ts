// How an issue is REFERENCED inside a markdown body, and how it's found again.
//
// A reference is a plain markdown link whose target is an `issue:` URI carrying
// the two ids needed to resolve it without a lookup:
//
//     [#42 Login button loops](issue:<projectId>:<issueId>)
//
// react-markdown hands that to the `a` renderer as `href="issue:<…>"`, which is
// inert on its own — no browser can navigate an `issue:` URL — so the renderer
// (markdown-body) turns it into a chip that links to the real issue route. A
// body that reaches a surface without the override degrades to its label text,
// never a broken link. The ids travel IN the reference (unlike embeds, which
// sign per render) because an issue link needs no credential — the route it
// points at is access-checked on its own.

export const ISSUE_URI_SCHEME = "issue:"

// projectId and issueId are opaque ids without a colon (uuids, slugs), so a
// single colon cleanly separates them.
const ISSUE_REF = /^issue:([^:\s]+):([^:\s]+)$/

export interface IssueRef {
    projectId: string
    issueId: string
}

/** The `issue:` URI to persist for a reference (what goes in the link target). */
export function issueRefHref(projectId: string, issueId: string): string {
    return `${ISSUE_URI_SCHEME}${projectId}:${issueId}`
}

/** The ids behind an anchor href, or null when it's an ordinary link. */
export function parseIssueRef(href: string | null | undefined): IssueRef | null {
    if (!href || !href.startsWith(ISSUE_URI_SCHEME)) return null
    const m = ISSUE_REF.exec(href.trim())
    return m ? { projectId: m[1], issueId: m[2] } : null
}

/** The full markdown for a reference, label included.
 *
 *  `[` and `]` would end the label early, so they're stripped from the title —
 *  the number keeps the reference identifiable even if a title is all brackets. */
export function issueRefMarkdown(projectId: string, issueId: string, number: number, title: string): string {
    const safeTitle = (title ?? "").replace(/[[\]]/g, "").trim()
    const label = safeTitle ? `#${number} ${safeTitle}` : `#${number}`
    return `[${label}](${issueRefHref(projectId, issueId)})`
}
