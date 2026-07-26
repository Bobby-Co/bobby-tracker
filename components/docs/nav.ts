// Docs navigation model. A flat list of groups, each with items. `soon` marks a
// placeholder section that renders disabled with a "Soon" tag — the content is
// planned but not written yet. Keep this the single source of truth for both the
// sidebar (docs-shell) and any "next page" footers.

export type DocItem = {
    label: string
    href: string
    /** Placeholder — no page yet. Rendered disabled in the sidebar. */
    soon?: boolean
}

export type DocGroup = {
    title: string
    items: DocItem[]
}

export const DOC_NAV: DocGroup[] = [
    {
        title: "Getting started",
        items: [
            { label: "What is Ucelot", href: "/docs" },
            { label: "Codebase intelligence", href: "/docs/intelligence" },
            { label: "How your data is processed", href: "/docs/data-processing" },
        ],
    },
    {
        title: "Graph analysis system",
        items: [
            { label: "Overview", href: "/docs/graph-analysis" },
            { label: "The knowledge graph", href: "/docs/graph-analysis#knowledge-graph" },
            { label: "Asking your codebase", href: "/docs/graph-analysis#ask", soon: true },
            { label: "Indexing & refresh", href: "/docs/graph-analysis#indexing", soon: true },
        ],
    },
    {
        title: "Issue management",
        items: [
            { label: "Creating an issue", href: "/docs/issues#create" },
            { label: "Timeline view", href: "/docs/issues#timeline" },
            { label: "Groups & collections", href: "/docs/issues#groups", soon: true },
            { label: "Public sessions", href: "/docs/issues#sessions", soon: true },
        ],
    },
]

// Flat, ordered list of the real content pages — used to compute the prev/next
// pager at the bottom of each page. Kept explicit (one entry per route) so the
// chain stays correct even though several nav items point at in-page anchors.
export const DOC_PAGES: DocItem[] = [
    { label: "What is Ucelot", href: "/docs" },
    { label: "Codebase intelligence", href: "/docs/intelligence" },
    { label: "How your data is processed", href: "/docs/data-processing" },
    { label: "Graph analysis system", href: "/docs/graph-analysis" },
    { label: "Issue management", href: "/docs/issues" },
]
