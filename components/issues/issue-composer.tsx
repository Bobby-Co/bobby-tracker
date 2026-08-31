"use client"

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react"
import { usePathname } from "next/navigation"
import { cn } from "@/components/ui/cn"
import { IssueForm } from "@/components/issues/issue-form"
import {
    DRAFTS_STORAGE_KEY,
    EMPTY_DRAFT_FIELDS,
    draftIsEmpty,
    draftSummary,
    parseDraftStore,
    type DraftFields,
    type IssueDraft,
} from "@/modules/issues/domain/IssueDraft"

// The New Issue composer — a right-docked panel that never throws away work.
//
// Creating an issue is the app's main act, so it gets a first-class surface: a
// panel that pushes the page aside (never an overlay that dims it). But you
// don't always finish in one sitting, so a draft with any content is KEPT when
// you minimize or navigate away — persisted per project in the browser — and
// collapses to a peeking tab on the right edge that pulls it back open. Multiple
// drafts stack as tabs; only a blank draft is discarded. Opening a different
// project shows that project's own drafts.
//
// State lives in one context so any "New issue" trigger opens the same panel,
// and the shell can read `expanded` to fold the sidebar while a draft is open.

type DraftStore = Record<string, IssueDraft[]>

interface ComposerState {
    store: DraftStore
    // The draft currently blown up into the full panel (null = only peeking).
    openId: string | null
    openProjectId: string | null
    // Hydrated from localStorage yet? Drafts render only after, to avoid an
    // SSR/first-client mismatch and a flash of tabs that then move.
    ready: boolean
}

interface ComposerContext {
    /** A draft is expanded in the full panel. */
    expanded: boolean
    /** The expanded draft (its live fields), or null. */
    openDraft: IssueDraft | null
    openProjectId: string | null
    /** Drafts to show as peeking tabs for the active project context. */
    peekDrafts: IssueDraft[]
    /** Start a fresh draft for a project and open it. */
    startDraft: (projectId: string) => void
    /** Re-open a peeking draft into the full panel. */
    resumeDraft: (id: string) => void
    /** Collapse the open draft: kept as a tab if it has content, else discarded. */
    minimize: () => void
    /** Delete a draft outright, wherever it lives. */
    discardDraft: (id: string) => void
    /** Patch the open draft's fields (each keystroke persists). */
    updateOpenDraft: (patch: Partial<DraftFields>) => void
}

const Ctx = createContext<ComposerContext | null>(null)

export function useIssueComposer(): ComposerContext {
    const ctx = useContext(Ctx)
    if (!ctx) throw new Error("useIssueComposer must be used within <IssueComposerProvider>")
    return ctx
}

const PROJECT_ROUTE = /^\/projects\/([^/]+)/

function newId(): string {
    try {
        return crypto.randomUUID()
    } catch {
        // Older engines without randomUUID — good enough for a client-only id.
        return `d-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    }
}

/** Drop the empty drafts from a project's list (abandoned blank starts). */
function pruneEmpty(list: IssueDraft[]): IssueDraft[] {
    return list.filter((d) => !draftIsEmpty(d))
}

export function IssueComposerProvider({
    children,
    // Previews/tests that don't live under a real /projects/<id> route can name
    // the project whose drafts are in scope. Production omits it and reads the route.
    projectScope,
}: {
    children: React.ReactNode
    projectScope?: string
}) {
    const [state, setState] = useState<ComposerState>({ store: {}, openId: null, openProjectId: null, ready: false })
    const pathname = usePathname()

    // The project whose drafts are "in context": the open draft's project while
    // one is expanded, otherwise the project of the route you're on.
    const routeProjectId = PROJECT_ROUTE.exec(pathname)?.[1] ?? null
    const contextProjectId = state.openProjectId ?? routeProjectId ?? projectScope ?? null

    // Hydrate the store once, client-side.
    useEffect(() => {
        let store: DraftStore = {}
        try {
            store = parseDraftStore(window.localStorage.getItem(DRAFTS_STORAGE_KEY))
        } catch {
            /* storage disabled — start empty, just won't persist */
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState((s) => ({ ...s, store, ready: true }))
    }, [])

    // Persist the store on every change (after hydration).
    useEffect(() => {
        if (!state.ready) return
        try {
            window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(state.store))
        } catch {
            /* private mode / disabled — drafts just won't survive a reload */
        }
    }, [state.store, state.ready])

    const startDraft = useCallback((projectId: string) => {
        const draft: IssueDraft = { id: newId(), projectId, updatedAt: Date.now(), ...EMPTY_DRAFT_FIELDS }
        setState((s) => {
            const list = pruneEmpty(s.store[projectId] ?? [])
            return {
                ...s,
                store: { ...s.store, [projectId]: [...list, draft] },
                openId: draft.id,
                openProjectId: projectId,
            }
        })
    }, [])

    const resumeDraft = useCallback((id: string) => {
        setState((s) => {
            for (const [projectId, list] of Object.entries(s.store)) {
                if (list.some((d) => d.id === id)) return { ...s, openId: id, openProjectId: projectId }
            }
            return s
        })
    }, [])

    const minimize = useCallback(() => {
        setState((s) => {
            if (!s.openId || !s.openProjectId) return s
            const list = s.store[s.openProjectId] ?? []
            const draft = list.find((d) => d.id === s.openId)
            // Blank on the way out → discard; anything written → keep as a tab.
            const nextList = draft && draftIsEmpty(draft) ? list.filter((d) => d.id !== s.openId) : list
            return { ...s, store: { ...s.store, [s.openProjectId]: nextList }, openId: null, openProjectId: null }
        })
    }, [])

    const discardDraft = useCallback((id: string) => {
        setState((s) => {
            const store: DraftStore = {}
            for (const [projectId, list] of Object.entries(s.store)) {
                store[projectId] = list.filter((d) => d.id !== id)
            }
            const closing = s.openId === id
            return { ...s, store, openId: closing ? null : s.openId, openProjectId: closing ? null : s.openProjectId }
        })
    }, [])

    const updateOpenDraft = useCallback((patch: Partial<DraftFields>) => {
        setState((s) => {
            if (!s.openId || !s.openProjectId) return s
            const list = s.store[s.openProjectId] ?? []
            const nextList = list.map((d) => (d.id === s.openId ? { ...d, ...patch, updatedAt: Date.now() } : d))
            return { ...s, store: { ...s.store, [s.openProjectId]: nextList } }
        })
    }, [])

    // Navigating away (a rail icon, a submit that lands on the new issue, a tab
    // switch) minimizes the open draft rather than losing it — it lives on as a
    // tab. Skip the first run so a deep-link into the app doesn't clear anything.
    const first = useRef(true)
    useEffect(() => {
        if (first.current) {
            first.current = false
            return
        }
        minimize()
    }, [pathname, minimize])

    const openDraft = useMemo(() => {
        if (!state.openId || !state.openProjectId) return null
        return state.store[state.openProjectId]?.find((d) => d.id === state.openId) ?? null
    }, [state.store, state.openId, state.openProjectId])

    const peekDrafts = useMemo(() => {
        if (!state.ready || !contextProjectId) return []
        return (state.store[contextProjectId] ?? [])
            .filter((d) => d.id !== state.openId && !draftIsEmpty(d))
            .sort((a, b) => a.updatedAt - b.updatedAt)
    }, [state.ready, state.store, state.openId, contextProjectId])

    const value = useMemo<ComposerContext>(
        () => ({
            expanded: state.openId != null,
            openDraft,
            openProjectId: state.openProjectId,
            peekDrafts,
            startDraft,
            resumeDraft,
            minimize,
            discardDraft,
            updateOpenDraft,
        }),
        [state.openId, state.openProjectId, openDraft, peekDrafts, startDraft, resumeDraft, minimize, discardDraft, updateOpenDraft],
    )

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

const MIN_WIDTH = 420
const MAX_WIDTH = 920
const DEFAULT_WIDTH = 580
const WIDTH_KEY = "composer:width"
// Width of the strip the peek tabs keep at the far-right edge. When the tray is
// open with other drafts still peeking, the panel is inset by this so the stack
// stays pinned to the edge instead of being shoved under the panel.
const TAB_W = 48

function readStoredWidth(): number {
    if (typeof window === "undefined") return DEFAULT_WIDTH
    try {
        const raw = window.localStorage.getItem(WIDTH_KEY)
        const n = raw ? Number(raw) : NaN
        return Number.isFinite(n) ? clampWidth(n) : DEFAULT_WIDTH
    } catch {
        return DEFAULT_WIDTH
    }
}

function clampWidth(n: number): number {
    // Leave room for the issue list to stay browsable — but the tray is the
    // focus while composing, so it may take most of the width.
    const ceiling = typeof window === "undefined" ? MAX_WIDTH : Math.min(MAX_WIDTH, window.innerWidth - 340)
    return Math.max(MIN_WIDTH, Math.min(n, Math.max(MIN_WIDTH, ceiling)))
}

/** The docked composer + the peeking-draft rail. Rendered once by the app shell:
 *  the panel as the last flex child (so the content column yields the width — a
 *  push, not an overlay), the rail fixed to the window's right edge. */
export function IssueComposerPanel() {
    const { expanded, openDraft, peekDrafts, minimize, discardDraft, resumeDraft, updateOpenDraft } = useIssueComposer()
    const [width, setWidth] = useState(DEFAULT_WIDTH)
    const [dragging, setDragging] = useState(false)
    // Reserve the tab strip at the edge whenever other drafts are peeking WHILE
    // THE PANEL IS OPEN, so the panel opens to its LEFT and the stack stays on
    // the right rather than being shoved under it.
    //
    // Only while open. Collapsed, the panel has no width, and reserving the
    // strip anyway narrowed the whole content column by 48px for a rail that is
    // `fixed` and floats over everything regardless — the issue list gave up a
    // margin to something that was never going to occupy it. Now the content
    // runs full width and the tabs sit on top of its right edge.
    const rightInset = expanded && peekDrafts.length > 0 ? TAB_W : 0

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setWidth(readStoredWidth())
    }, [])

    useEffect(() => {
        if (typeof window === "undefined") return
        try {
            window.localStorage.setItem(WIDTH_KEY, String(width))
        } catch {
            /* private mode / disabled storage — the width just won't persist */
        }
    }, [width])

    // Esc minimizes, matching every other dismissible surface — and keeps the draft.
    useEffect(() => {
        if (!expanded) return
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") minimize()
        }
        document.addEventListener("keydown", onKey)
        return () => document.removeEventListener("keydown", onKey)
    }, [expanded, minimize])

    // Drag the left edge to resize. The panel is flush to the window's right, so
    // its width is simply the distance from the pointer to that edge.
    useEffect(() => {
        if (!dragging) return
        function move(e: PointerEvent) {
            setWidth(clampWidth(window.innerWidth - rightInset - e.clientX))
        }
        function up() {
            setDragging(false)
        }
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", up)
        const prevSelect = document.body.style.userSelect
        const prevCursor = document.body.style.cursor
        document.body.style.userSelect = "none"
        document.body.style.cursor = "col-resize"
        return () => {
            window.removeEventListener("pointermove", move)
            window.removeEventListener("pointerup", up)
            document.body.style.userSelect = prevSelect
            document.body.style.cursor = prevCursor
        }
    }, [dragging, rightInset])

    return (
        <>
            <aside
                aria-hidden={!expanded}
                aria-label="New issue"
                style={{ width: expanded ? width : 0, marginRight: rightInset }}
                className={cn(
                    "relative z-40 flex shrink-0 flex-col overflow-hidden bg-[color:var(--c-surface)]",
                    "md:h-full md:rounded-tl-[22px] md:shadow-[var(--shadow-panel)]",
                    expanded ? "md:ml-2" : "md:ml-0",
                    // marginRight (the reserved tab strip) must not inset the mobile
                    // full-screen sheet — clear it below md.
                    "max-md:fixed max-md:inset-0 max-md:z-50 max-md:!mr-0 max-md:!h-full max-md:!w-full",
                    !dragging && "transition-[width,margin] duration-500",
                    expanded ? "max-md:flex" : "pointer-events-none max-md:hidden",
                )}
            >
                <button
                    type="button"
                    aria-label="Resize panel"
                    onPointerDown={(e) => {
                        e.preventDefault()
                        setDragging(true)
                    }}
                    className="group absolute left-0 top-0 z-10 hidden h-full w-3 -translate-x-1/2 cursor-col-resize md:block"
                >
                    <span
                        className={cn(
                            "absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 transition-colors duration-150",
                            dragging ? "bg-[color:var(--c-primary)]" : "bg-transparent group-hover:bg-[color:var(--c-primary)]",
                        )}
                    />
                </button>

                <div style={{ width }} className="flex h-full flex-col max-md:!w-full">
                    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[color:var(--c-border)] px-5 py-3.5">
                        <div className="min-w-0">
                            <h2 className="text-[15px] font-bold tracking-[-0.005em]">New issue</h2>
                            <p className="mt-0.5 text-[12px] text-[color:var(--c-text-muted)]">
                                Draft it in full — the analyser reads what you write.
                            </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <button
                                type="button"
                                onClick={() => openDraft && discardDraft(openDraft.id)}
                                aria-label="Discard draft"
                                title="Discard draft"
                                className="grid h-7 w-7 place-items-center rounded-md text-[color:var(--c-text-dim)] transition-colors hover:bg-[color:var(--c-error-bg)] hover:text-[color:var(--c-error)]"
                            >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                                </svg>
                            </button>
                            <button
                                type="button"
                                onClick={minimize}
                                aria-label="Minimize to a draft tab"
                                title="Minimize — keep as a draft"
                                className="grid h-7 w-7 place-items-center rounded-md text-[color:var(--c-text-dim)] transition-colors hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
                            >
                                {/* a panel-to-the-right glyph: "tuck me away" */}
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <path d="M13 5l7 7-7 7M20 12H8" />
                                </svg>
                            </button>
                        </div>
                    </header>

                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                        {openDraft ? (
                            <IssueForm
                                key={openDraft.id}
                                projectId={openDraft.projectId}
                                variant="panel"
                                value={openDraft}
                                onChange={updateOpenDraft}
                                onSuccess={() => discardDraft(openDraft.id)}
                                onCancel={minimize}
                                submitLabel="Create issue"
                            />
                        ) : null}
                    </div>
                </div>
            </aside>

            <PeekRail drafts={peekDrafts} onResume={resumeDraft} onDiscard={discardDraft} />
        </>
    )
}

// A minimized draft is the composer tray RETRACTED — a tall, full-height tab
// slid off the right edge with just a strip poking back in, like a folder pushed
// into a filing drawer. Several stack front-to-back; hovering fans them apart so
// each poking tab is legible and pickable. Newest sits in front, flush to the edge.
// TAB_W (the strip width) lives up by the panel constants — the panel reserves it.
const DEPTH_IDLE = 8 // how far each card behind recedes when stacked
const SPREAD_HOVER = 32 // hover offset per tab — ~half a tab, so they stay overlapped, just enough to tell apart

/** The stack of retracted-tray drafts, docked to the right edge. When a draft is
 *  expanded the whole stack slides left to sit against the panel, so every draft
 *  stays one grab away. Hovering fans the drawer open. */
function PeekRail({
    drafts,
    onResume,
    onDiscard,
}: {
    drafts: IssueDraft[]
    onResume: (id: string) => void
    onDiscard: (id: string) => void
}) {
    const [open, setOpen] = useState(false)
    if (drafts.length === 0) return null

    const n = drafts.length
    const gap = open ? SPREAD_HOVER : DEPTH_IDLE
    const railWidth = (n - 1) * gap + TAB_W

    return (
        // Pinned to the window's right edge, ABOVE the panel (z-50) so it stays put
        // when the tray opens — the panel reserves a strip (its marginRight) so the
        // tabs sit beside it, not under it. Idle the container lets clicks through
        // (pointer-events none); once a tab is entered we turn it on so one leave
        // collapses the whole drawer.
        <div
            aria-label="Issue drafts"
            style={{ right: 0, width: railWidth, pointerEvents: open ? "auto" : "none" }}
            className="fixed top-[68px] bottom-3 z-50 transition-[width] duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
            onPointerLeave={() => setOpen(false)}
            onFocus={() => setOpen(true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
            }}
        >
            {drafts.map((d, i) => {
                const back = n - 1 - i // 0 = newest, sits in front flush to the edge
                const tx = -back * gap
                return (
                    <div
                        key={d.id}
                        className="group/card pointer-events-auto absolute inset-y-0 right-0"
                        style={{
                            width: TAB_W,
                            zIndex: i,
                            transform: `translateX(${tx.toFixed(1)}px)`,
                            transition: "transform 420ms cubic-bezier(0.16,1,0.3,1)",
                        }}
                        onPointerEnter={() => setOpen(true)}
                    >
                        <button
                            type="button"
                            onClick={() => onResume(d.id)}
                            title={`Resume draft: ${draftSummary(d)}`}
                            className="relative flex h-full w-full flex-col items-center gap-3 overflow-hidden rounded-l-[18px] border border-r-0 border-[color:var(--c-border)] bg-[color:var(--c-surface)] pt-4 shadow-[var(--shadow-panel)] transition-colors duration-200 hover:bg-[color:var(--c-surface-2)]"
                        >
                            {/* The ember spine down the left edge — the tray's colour. */}
                            <span className="absolute inset-y-0 left-0 w-[4px] bg-[color:var(--c-primary)] opacity-80" aria-hidden />
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[color:var(--c-surface-2)] text-[color:var(--c-primary)]" aria-hidden>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                </svg>
                            </span>
                            {/* Title runs up the tab, like a label on a file folder. */}
                            <span
                                className="min-h-0 flex-1 overflow-hidden truncate text-[13px] font-semibold text-[color:var(--c-text)]"
                                style={{ writingMode: "vertical-rl" }}
                            >
                                {draftSummary(d)}
                            </span>
                            <span
                                className="pb-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--c-text-dim)]"
                                style={{ writingMode: "vertical-rl" }}
                                aria-hidden
                            >
                                Draft
                            </span>
                        </button>
                        {/* Discard without opening. */}
                        <button
                            type="button"
                            onClick={() => onDiscard(d.id)}
                            aria-label={`Discard draft: ${draftSummary(d)}`}
                            title="Discard draft"
                            className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full text-[color:var(--c-text-dim)] opacity-0 transition-opacity duration-150 hover:bg-[color:var(--c-error-bg)] hover:text-[color:var(--c-error)] focus-visible:opacity-100 group-hover/card:opacity-100"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                                <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </button>
                    </div>
                )
            })}
        </div>
    )
}
