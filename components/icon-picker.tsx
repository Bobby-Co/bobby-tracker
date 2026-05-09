"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/components/cn"
import { IconlyIcon } from "@/components/iconly-icon"
import { useHoverTooltip } from "@/components/icon-tooltip"
import { Modal } from "@/components/modal"
import { ICONLY_CATALOG, type IconlyCatalogEntry } from "@/lib/iconly-catalog"

// IconPicker — searchable gallery for assigning an icon to a label.
//
// Search has two layers, surfaced separately to the consumer:
//   - direct: substring matches against slug + tags. Shown
//             instantly on every keystroke.
//   - extra:  semantic matches from /api/icons/search that aren't
//             already in `direct`. Shown after the API resolves.
//   - loading: true while the semantic call is in flight. The UI
//              renders a few skeleton tiles after `direct` so the
//              user sees that "more is being fetched" without the
//              list jumping when results land.
//
// Same-query cache: results are memoised by trimmed lowercase
// query for the lifetime of the page. Re-typing a query you just
// searched skips the API call entirely.
const SEARCH_DEBOUNCE_MS = 250
const SEMANTIC_MIN_CHARS = 3
const SKELETON_COUNT = 8

export function IconPicker({
    open,
    label,
    current,
    onClose,
    onPick,
}: {
    open: boolean
    label: string
    current: string | null
    onClose: () => void
    onPick: (iconName: string) => void
}) {
    const [q, setQ] = useState("")
    const { direct, extra, loading } = useFilteredCatalog(q)
    const empty = direct.length === 0 && extra.length === 0 && !loading

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={`Choose an icon for "${label}"`}
            description="Iconly Bold. Used wherever this label appears on the timeline."
            size="lg"
        >
            <div className="flex flex-col gap-4">
                <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search icons (e.g. bug, calendar, raindrop, weather)…"
                    className="w-full rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-2 text-[13px] outline-none focus:border-zinc-400"
                />
                <div
                    className="grid max-h-[60vh] gap-2 overflow-y-auto pr-1"
                    style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}
                >
                    {direct.map((icon) => (
                        <IconTile
                            key={icon.name}
                            icon={icon}
                            active={current === icon.name}
                            onPick={onPick}
                        />
                    ))}
                    {direct.length > 0 && (loading || extra.length > 0) && <RelatedDivider />}
                    {loading && Array.from({ length: SKELETON_COUNT }, (_, i) => <SkeletonTile key={`s-${i}`} />)}
                    {extra.map((icon) => (
                        <IconTile
                            key={icon.name}
                            icon={icon}
                            active={current === icon.name}
                            onPick={onPick}
                        />
                    ))}
                    {empty && (
                        <div className="col-span-full rounded-[10px] border border-dashed border-[color:var(--c-border)] px-4 py-6 text-center text-[12.5px] text-[color:var(--c-text-muted)]">
                            No icons match “{q}”.
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    )
}

function IconTile({
    icon,
    active,
    onPick,
}: {
    icon: IconlyCatalogEntry
    active: boolean
    onPick: (iconName: string) => void
}) {
    const tip = useHoverTooltip(icon.name)
    return (
        <>
            <button
                type="button"
                onClick={() => onPick(icon.name)}
                {...tip.triggerProps}
                className={cn(
                    "group flex flex-col items-center gap-1 rounded-[10px] border px-2 py-3 text-[10.5px] font-medium transition-colors",
                    active
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-[color:var(--c-border)] bg-white text-[color:var(--c-text-muted)] hover:border-zinc-400 hover:text-[color:var(--c-text)]",
                )}
            >
                <IconlyIcon name={icon.name} size={22} />
                <span className="line-clamp-1 break-all">{icon.name}</span>
            </button>
            {tip.overlay}
        </>
    )
}

// Loading placeholder rendered between direct + semantic results.
//
//   variant="default"  → mirrors IconTile (icon + name label, taller).
//                        Used by the full-size IconPicker grid.
//   variant="compact"  → mirrors IconButton (icon-only, h-10 square).
//                        Used by the new-label modal's suggestion
//                        strip and dense picker grid.
export function SkeletonTile({
    className,
    variant = "default",
}: {
    className?: string
    variant?: "default" | "compact"
}) {
    if (variant === "compact") {
        return (
            <div
                className={cn(
                    "grid h-10 place-items-center rounded-[8px] border border-[color:var(--c-border)] bg-[color:var(--c-overlay)] animate-pulse",
                    className,
                )}
                aria-hidden
            >
                <div className="h-[18px] w-[18px] rounded-[4px] bg-zinc-200" />
            </div>
        )
    }
    return (
        <div
            className={cn(
                "flex flex-col items-center gap-1 rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-overlay)] px-2 py-3 animate-pulse",
                className,
            )}
            aria-hidden
        >
            <div className="h-[22px] w-[22px] rounded-full bg-zinc-200" />
            <div className="h-[10px] w-12 rounded bg-zinc-200" />
        </div>
    )
}

// Full-row label that separates direct substring matches from
// semantic-only ones. Spans the grid via col-span-full.
export function RelatedDivider() {
    return (
        <div className="col-span-full flex items-center gap-2 pt-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
            <span>Related</span>
            <div className="h-px flex-1 bg-[color:var(--c-border)]" />
        </div>
    )
}

export interface FilteredCatalogResult {
    /** Substring matches. Always rendered. */
    direct: IconlyCatalogEntry[]
    /** Semantic-only matches (those not already in `direct`).
     *  Empty until the API resolves. */
    extra: IconlyCatalogEntry[]
    /** True while the semantic call is in flight for this query. */
    loading: boolean
}

// Shared search hook — used by both IconPicker and NewLabelModal.
export function useFilteredCatalog(query: string): FilteredCatalogResult {
    const trimmed = query.trim().toLowerCase()
    const direct = useMemo(() => filterLocal(trimmed), [trimmed])
    const { hits, loading } = useSemanticIconRanking(trimmed)

    const extra = useMemo(() => {
        if (!hits) return []
        const seen = new Set(direct.map((i) => i.name))
        const out: IconlyCatalogEntry[] = []
        for (const hit of hits) {
            if (seen.has(hit.name)) continue
            const entry = CATALOG_BY_NAME[hit.name]
            if (entry) out.push(entry)
        }
        return out
    }, [hits, direct])

    return { direct, extra, loading }
}

// Local substring scoring. Returns 0 for "no match", or a value in
// (0, 1] reflecting the strongest tag confidence that matches. Slug
// matches always score 1.0 (the slug is canonical). Sorting by this
// score keeps "true" matches above icons that picked up the term as
// a low-confidence software-context tag.
function localScore(needle: string, entry: IconlyCatalogEntry): number {
    if (!needle) return 1
    if (entry.name.includes(needle)) return 1
    let best = 0
    for (const t of entry.tags) {
        if (t.name.includes(needle) && t.confidence > best) {
            best = t.confidence
        }
    }
    return best
}

function filterLocal(needle: string): IconlyCatalogEntry[] {
    if (!needle) return ICONLY_CATALOG
    const scored: { entry: IconlyCatalogEntry; score: number }[] = []
    for (const entry of ICONLY_CATALOG) {
        const score = localScore(needle, entry)
        if (score > 0) scored.push({ entry, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.map((s) => s.entry)
}

const CATALOG_BY_NAME: Record<string, IconlyCatalogEntry> = Object.fromEntries(
    ICONLY_CATALOG.map((i) => [i.name, i]),
)

interface SemanticHit { name: string; similarity: number }

// Module-scope cache so repeated queries within a session don't
// hit the API. Keyed by trimmed lowercase query. Invalidated
// when the server reports a different `version` — that signal
// flips after scripts/embed-icons.ts re-runs, so a deployed
// re-index doesn't leave clients stuck on stale rankings.
const SEMANTIC_CACHE = new Map<string, SemanticHit[]>()
let lastSeenVersion: string | null = null

function reconcileVersion(serverVersion: string | undefined): void {
    if (!serverVersion) return
    if (lastSeenVersion && lastSeenVersion !== serverVersion) {
        SEMANTIC_CACHE.clear()
    }
    lastSeenVersion = serverVersion
}

interface SemanticState {
    /** Query the cached `hits` were fetched for. Used to discard
     *  stale results when the input changes faster than the
     *  debounce timer fires. */
    q: string
    hits: SemanticHit[] | null
    loading: boolean
}

interface SemanticReturn {
    hits: SemanticHit[] | null
    loading: boolean
}

function useSemanticIconRanking(query: string): SemanticReturn {
    const tooShort = query.length < SEMANTIC_MIN_CHARS
    const cached = !tooShort ? SEMANTIC_CACHE.get(query) ?? null : null

    const initial: SemanticState = cached
        ? { q: query, hits: cached, loading: false }
        : { q: "", hits: null, loading: false }
    const [state, setState] = useState<SemanticState>(initial)
    const reqIdRef = useRef(0)

    // Adjust state on prop change idiom — when the input flips to
    // a new query we either hydrate from cache synchronously
    // (no flicker, no API call) or mark as loading and let the
    // effect kick off the fetch.
    if (state.q !== query) {
        if (tooShort) {
            setState({ q: query, hits: null, loading: false })
        } else if (cached) {
            setState({ q: query, hits: cached, loading: false })
        } else {
            setState({ q: query, hits: null, loading: true })
        }
    }

    useEffect(() => {
        if (tooShort) return
        if (SEMANTIC_CACHE.has(query)) return
        const myId = ++reqIdRef.current
        const controller = new AbortController()
        const timer = setTimeout(async () => {
            try {
                const res = await fetch("/api/icons/search", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ q: query, limit: 60 }),
                    signal: controller.signal,
                })
                if (!res.ok) {
                    if (myId === reqIdRef.current) {
                        setState((s) => (s.q === query ? { ...s, loading: false } : s))
                    }
                    return
                }
                const json = (await res.json()) as { icons?: SemanticHit[]; version?: string }
                // Apply server version BEFORE we store this query's
                // hits — clearing the in-memory map only kicks out
                // stale entries from the previous version.
                reconcileVersion(json.version)
                const hits = json.icons ?? []
                SEMANTIC_CACHE.set(query, hits)
                if (myId !== reqIdRef.current) return
                setState({ q: query, hits, loading: false })
            } catch {
                // Aborted or network blip. Drop the loading flag if
                // this is still the current query so the skeleton
                // stops spinning forever.
                if (myId === reqIdRef.current) {
                    setState((s) => (s.q === query ? { ...s, loading: false } : s))
                }
            }
        }, SEARCH_DEBOUNCE_MS)
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [query, tooShort])

    if (tooShort) return { hits: null, loading: false }
    if (state.q !== query) return { hits: null, loading: true }
    return { hits: state.hits, loading: state.loading }
}
