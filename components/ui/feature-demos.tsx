"use client"

// Interactive demos for the landing's feature showcase.
//
// These reuse the REAL product surfaces rather than inventing landing-only
// chrome. The finding rows and the duplicate list are rebuilt from
// IssueSuggestions' FindingCard and SimilarIssuesCard with their own light
// state — no data fetching. The board is the actual TimelineGridPlayful,
// mounted with mock issues, which is why the landing does pull in
// framer-motion for this section.
//
// Each one is driven by a scripted cursor (see useScriptedCursor) that presses
// the very same elements a reader would, and HANDS OVER the moment a real
// pointer arrives — the script and a person would otherwise be dragging the
// same tile at once. Nothing here is a keyframe imitation of an interaction:
// the board really re-plans, and pushNeighbours() runs for real.
//
// Light panels on the dark section, exactly as the real app looks.
// Reduced-motion is handled once at the bottom; classes are `fx-` prefixed.

import { forwardRef, useEffect, useMemo, useRef, useState } from "react"
import { IconlyIcon } from "@/components/icons/iconly-icon"
import {
    TimelineGridPlayful,
    type BoardDemoHandle,
} from "@/components/timeline/timeline-grid-playful"
import { useScriptedCursor, type Step } from "@/components/ui/scripted-cursor"
import type { Issue, ProjectLabelIcon } from "@/lib/shared/types"

export function DemoStyles() {
    return <style>{DEMO_CSS}</style>
}

// Window dots. Small thing, load-bearing: they mark each demo as a picture of
// the app rather than as page furniture, which is what lets the scripted
// cursor inside read as part of the depicted screen. Without that, a second
// cursor moving around the page just competes with the reader's own.
function Dots() {
    return (
        <span className="fx-dots" aria-hidden>
            <i /><i /><i />
        </span>
    )
}

/** The white product surface the demos sit on. Also the frame the scripted
 *  cursor is positioned within, so it's clipped to the window. */
function Surface({
    title,
    surfaceRef,
    children,
}: {
    title: string
    surfaceRef?: React.RefObject<HTMLDivElement | null>
    children: React.ReactNode
}) {
    return (
        <div ref={surfaceRef} className="fx-surface">
            <div className="fx-head">
                <Dots />
                {title}
            </div>
            {children}
        </div>
    )
}

// Runs a demo only while it's actually on screen — off-screen it would
// otherwise burn a rAF loop through the whole 400vh hero runway.
function useInView(ref: React.RefObject<Element | null>) {
    const [inView, setInView] = useState(false)
    useEffect(() => {
        const el = ref.current
        if (!el) return
        const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.35 })
        io.observe(el)
        return () => io.disconnect()
    }, [ref])
    return inView
}

// The hand the reader is watching. Positioned within the demo's own frame (so
// it's clipped to it, and immune to any transformed ancestor on the landing)
// and never a hit-test target, so the surface underneath behaves exactly as it
// would with nothing drawn over it. useScriptedCursor writes straight to this
// node — position, `data-shown`, `data-down` — so the loop costs no re-renders.
// Offered once the reader has taken a demo over, to hand it back to the loop.
// `data-demo-resume` is what keeps pressing it — or moving across it — from
// counting as taking over again; see useScriptedCursor.
function ResumeButton({ onClick }: { onClick: () => void }) {
    return (
        <button type="button" data-demo-resume className="fx-resume" onClick={onClick}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
            </svg>
            Replay
        </button>
    )
}

const ScriptedCursor = forwardRef<HTMLDivElement>(function ScriptedCursor(_, ref) {
    return (
        <div ref={ref} className="fx-cursor" data-shown="false" data-down="false" aria-hidden>
            <span className="fx-cursor-ring" />
            <svg width="22" height="24" viewBox="0 0 22 24" fill="none">
                <path
                    d="M4 2.2 17.4 13.1l-5.9.55 3.2 6.6-2.6 1.25-3.2-6.6-4.9 3.3z"
                    fill="#0a0d1c"
                    stroke="#fffae8"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                />
            </svg>
        </div>
    )
})

// ─── 1. Know your repo — IssueSuggestions' findings ─────────────────────────
// The first row opens on the loop, revealing what the real FindingCard shows
// when expanded: the symbol, the analyser's reasoning, and the full path.
const FINDINGS = [
    {
        name: "total.ts:42",
        symbol: "applyDiscount()",
        conf: "high",
        path: "src/checkout/total.ts",
        reason: "Line total is summed before the discount is applied, so a percentage code never reaches the cart total.",
    },
    { name: "discount.ts:17", symbol: "resolveCode()", conf: "medium", path: "src/pricing/discount.ts", reason: "Percentage codes resolve to a ratio here, but fixed-amount codes fall through and return null." },
    { name: "summary.tsx:88", symbol: "<CartTotals/>", conf: "low", path: "src/cart/summary.tsx", reason: "Renders whatever total it is handed — worth confirming it is not caching the pre-discount value." },
]

// The reader watches a cursor work down the list, opening each finding in
// turn. There is no separate "loop" rendering any more: the scripted pointer
// clicks the very same buttons a person would, so the demo has exactly one
// behaviour and the hand-over is just the script stopping.
const ANALYSIS_SCRIPT: Step[] = [
    { act: "click", sel: '[data-demo="find-1"]', aim: "start" },
    { act: "click", sel: '[data-demo="find-2"]', aim: "start" },
    { act: "click", sel: '[data-demo="find-0"]', aim: "start", rest: 1200 },
]

export function AnalysisDemo() {
    const rootRef = useRef<HTMLDivElement>(null)
    const [auto, setAuto] = useState(true)
    const inView = useInView(rootRef)
    const [open, setOpen] = useState(0)

    const cursorRef = useScriptedCursor({
        rootRef,
        steps: ANALYSIS_SCRIPT,
        enabled: auto && inView,
        onCycleEnd: () => setOpen(0),
        onAbort: () => setAuto(false),
    })

    return (
        <Surface title="Suggested places to look" surfaceRef={rootRef}>
            <div className="fx-finds">
                {FINDINGS.map((f, i) => {
                    const shown = open === i
                    return (
                        <div key={f.name} className="fx-find" style={{ ["--i" as string]: i }}>
                            <button
                                type="button"
                                data-demo={`find-${i}`}
                                onClick={() => setOpen(shown ? -1 : i)}
                                aria-expanded={shown}
                                className="fx-fhead"
                            >
                                <span className="fx-file">{f.name}</span>
                                {!shown && <span className="fx-sym">{f.symbol}</span>}
                                <span className={`fx-conf fx-conf-${f.conf}`}>{f.conf}</span>
                                <svg
                                    className="fx-chev"
                                    width="12" height="12" viewBox="0 0 24 24"
                                    fill="none" stroke="currentColor" strokeWidth="2" aria-hidden
                                    style={{ transform: shown ? "rotate(180deg)" : "none" }}
                                >
                                    <path d="M6 9l6 6 6-6" />
                                </svg>
                            </button>
                            {/* Animating grid-template-rows 0fr → 1fr eases to
                                the body's OWN height — no guessed max-height. */}
                            <div className="fx-fslot" data-open={shown}>
                                <div className="fx-fbody">
                                    <div className="fx-sym">{f.symbol}</div>
                                    {f.reason && <p className="fx-reason">{f.reason}</p>}
                                    <span className="fx-fpath">
                                        {f.path}
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                                        </svg>
                                    </span>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
            <ScriptedCursor ref={cursorRef} />
            {!auto && <ResumeButton onClick={() => setAuto(true)} />}
        </Surface>
    )
}

// ─── 2. Help you manage — SimilarIssuesCard ─────────────────────────────────
const SIMILAR = [
    { n: 128, title: "Discount not applied at checkout", pct: 94 },
    { n: 96, title: "Total ignores promo code", pct: 88 },
]

// PeekTile — the playful brick at CELL = 32 (board 100% zoom): solid card whose
// width is the duration, a detached dashed ghost borrowing room for the label,
// and a label spanning both. Same derivation as components/timeline/timeline-peek.
const P_CELL = 32
const P_RADIUS = clampP(P_CELL * 0.3, 8, 17)
const P_ICON_BOX = clampP(P_CELL * 0.4, 12, 22)
const P_ICON = Math.round(clampP(P_CELL * 0.24, 8, 13))
const P_TITLE = clampP(P_CELL * 0.3, 8, 15)
const P_NUM = clampP(P_CELL * 0.24, 7, 12)
const P_ROW_H = P_CELL - clampP(P_CELL * 0.09, 2, 6) * 2
const P_PAD_L = Math.max(5, P_CELL * 0.13)
const P_SLOT = P_PAD_L + P_ICON_BOX + Math.max(8, P_CELL * 0.2)
const P_MIN_LABEL = 108
function clampP(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(v, hi))
}

const PEEK = [
    { n: 131, t: "Checkout total…", left: 30, width: 34, bg: "#FBE9C9", fg: "#C57F0C", icon: "danger", focal: true },
    { n: 128, t: "Discount not…", left: 2, width: 26, bg: "#EAE6FB", fg: "#7350D6", icon: "coins-1" },
    { n: 96, t: "Promo code…", left: 62, width: 30, bg: "#D7F2EC", fg: "#10917F", icon: "chat" },
]

// The cursor works down the similar-issues list and files each one against
// #131 — the actual button, the actual state change, not a keyframe.
const DUPLICATES_SCRIPT: Step[] = [
    { act: "click", sel: '[data-demo="dup-0"]', reach: 640 },
    { act: "click", sel: '[data-demo="dup-1"]', rest: 1300 },
]

export function DuplicatesDemo() {
    const rootRef = useRef<HTMLDivElement>(null)
    const [auto, setAuto] = useState(true)
    const inView = useInView(rootRef)
    const [filed, setFiled] = useState<number[]>([])

    const cursorRef = useScriptedCursor({
        rootRef,
        steps: DUPLICATES_SCRIPT,
        enabled: auto && inView,
        onCycleEnd: () => setFiled([]),
        onAbort: () => setAuto(false),
    })

    return (
        <Surface title="Issue #131" surfaceRef={rootRef}>
            {/* The detail page's two-column shape: the issue body on the left,
                meta + labels + the timeline peek stacked in the right rail. */}
            <div className="fx-detail">
                <div className="fx-imain">
                    <div className="fx-ititle">Checkout total ignores the discount</div>
                    {/* markdown-rendered body, as the real issue shows it */}
                    <div className="fx-md">
                        <p>
                            Applying <code>SAVE20</code> at checkout updates the line items but the
                            order total stays at full price.
                        </p>
                        <ul>
                            <li>Add two items to the cart</li>
                            <li>Apply a percentage code</li>
                            <li>Total is unchanged</li>
                        </ul>
                    </div>
                </div>

                <aside className="fx-iside">
                    <div className="fx-srow">
                        <span className="fx-pill">
                            <i className="fx-dot" style={{ background: "#16a34a" }} />
                            Open
                        </span>
                        <span className="fx-pill">
                            <i className="fx-dot" style={{ background: "#b45309" }} />
                            Medium
                        </span>
                    </div>
                    <div className="fx-skey">Labels</div>
                    <div className="fx-srow">
                        <span className="fx-lab" style={{ background: "#FCE3DD", color: "#D45441" }}>
                            bug
                        </span>
                        <span className="fx-lab" style={{ background: "#FBE3EF", color: "#C84C86" }}>
                            billing
                        </span>
                    </div>

                    {/* TimelinePeek — centred on this issue */}
                    <div className="fx-peek">
                        <div className="fx-peekhead">
                            <span>Timeline</span>
                            <span className="fx-peekopen">Open ↗</span>
                        </div>
                        <div className="fx-peekbody">
                            <span className="fx-centre" />
                            <span className="fx-today" />
                            {PEEK.map((p) => {
                                const ring = `color-mix(in srgb, ${p.fg} 24%, transparent)`
                                const faint = `color-mix(in srgb, ${p.fg} 7%, transparent)`
                                const dash = `color-mix(in srgb, ${p.fg} 34%, transparent)`
                                const top = p.focal ? 6 : 44
                                const op = p.focal ? 1 : 0.72
                                return (
                                    <span key={p.n}>
                                        {/* solid card — width IS the duration */}
                                        <span
                                            className="fx-pcard"
                                            style={{
                                                left: `${p.left}%`,
                                                width: `${p.width}%`,
                                                top,
                                                height: P_ROW_H,
                                                opacity: op,
                                                background: p.bg,
                                                borderRadius: P_RADIUS,
                                                boxShadow: p.focal
                                                    ? `0 0 0 1.5px ${ring}, 0 0 0 3px #fff, 0 3px 8px -3px ${ring}`
                                                    : `0 0 0 1.5px ${ring}, 0 3px 8px -3px ${ring}`,
                                            }}
                                        />
                                        {/* detached dashed ghost — borrowed room */}
                                        <span
                                            className="fx-pcard"
                                            style={{
                                                left: `calc(${p.left}% + ${p.width}% + 3px)`,
                                                width: `max(0px, calc(${P_MIN_LABEL}px - ${p.width}% - 3px))`,
                                                top,
                                                height: P_ROW_H,
                                                opacity: op,
                                                borderRadius: P_RADIUS,
                                                border: `1.5px dashed ${dash}`,
                                                background: faint,
                                            }}
                                        />
                                        {/* label spanning both pieces */}
                                        <span
                                            className="fx-plabel"
                                            style={{
                                                left: `${p.left}%`,
                                                width: `max(${P_MIN_LABEL}px, ${p.width}%)`,
                                                top,
                                                height: P_ROW_H,
                                                opacity: op,
                                                color: p.fg,
                                            }}
                                        >
                                            <span className="fx-pslot" style={{ width: P_SLOT, paddingLeft: P_PAD_L }}>
                                                <span
                                                    className="fx-pchip"
                                                    style={{ width: P_ICON_BOX, height: P_ICON_BOX, background: p.fg, boxShadow: `0 1px 2px ${ring}` }}
                                                >
                                                    <IconlyIcon name={p.icon} size={P_ICON} color="#ffffff" secondColor="#ffffff" />
                                                </span>
                                            </span>
                                            <span className="fx-ptitle" style={{ fontSize: P_TITLE }}>{p.t}</span>
                                            <span className="fx-pnum" style={{ fontSize: P_NUM }}>#{p.n}</span>
                                        </span>
                                    </span>
                                )
                            })}
                        </div>
                    </div>
                </aside>
            </div>

            {/* …and only then, the duplicate check */}
            <div className="fx-simhead">Similar issues</div>
            <ul className="fx-sim">
                {SIMILAR.map((s, i) => {
                    const done = filed.includes(i)
                    return (
                        <li key={s.n} className="fx-simrow" data-filed={done} style={{ ["--i" as string]: i }}>
                            <span className="fx-num">#{s.n}</span>
                            <span className="fx-title">{s.title}</span>
                            <span className="fx-pct">{s.pct}%</span>
                            {/* The label swaps but the button's width doesn't,
                                so filing a row never re-flows the row. */}
                            <button
                                type="button"
                                data-demo={`dup-${i}`}
                                className="fx-dupbtn"
                                onClick={() => setFiled((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))}
                            >
                                {done ? "✓ Filed" : "Duplicate of"}
                            </button>
                        </li>
                    )
                })}
            </ul>
            <ScriptedCursor ref={cursorRef} />
            {!auto && <ResumeButton onClick={() => setAuto(true)} />}
        </Surface>
    )
}

// ─── 3. Collaborate — the real playful board ────────────────────────────────
// The real board, mounted with mock issues and `persist={false}` so drags stay
// local instead of PATCHing a project that doesn't exist here. Everything else
// — drag, resize, pushNeighbours, the tray — is the shipped mechanism, not a
// reimplementation of it.
const DAY = 24 * 60 * 60 * 1000
const midnight = (offset: number) => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + offset)
    return d.toISOString()
}

let seq = 0
function mockIssue(
    title: string,
    opts: { startDay: number; days: number; lane: number; label: string; body?: string },
): Issue {
    seq += 1
    return {
        id: `demo-${seq}`,
        project_id: "demo",
        user_id: "demo",
        title,
        body: opts.body ?? "",
        status: "open",
        priority: "medium",
        labels: [opts.label],
        github_issue_number: null,
        github_node_id: null,
        sync_source: null,
        last_synced_hash: null,
        github_synced_at: null,
        github_analysis_comment_id: null,
        analysis_status: null,
        issue_number: 106 + seq,
        ai_proposed: false,
        duplicate_of_issue_id: null,
        starts_at: midnight(opts.startDay),
        ends_at: midnight(opts.startDay + opts.days),
        lane_y: opts.lane,
        color: null,
        analyse_effort: null,
        created_at: new Date(Date.now() - DAY).toISOString(),
        updated_at: new Date().toISOString(),
    } as Issue
}

const DEMO_ISSUES: Issue[] = [
    mockIssue("Stripe usage billing", { startDay: 0, days: 2, lane: 0, label: "billing" }),
    mockIssue("AI issue summaries", {
        startDay: 4, days: 3, lane: 0, label: "ai",
        body: "Summarise long issue threads into a two-line brief so triage starts warm.",
    }),
    mockIssue("Funnel analytics", { startDay: 0, days: 2, lane: 1, label: "analytics" }),
    mockIssue("Realtime chat", {
        startDay: 8, days: 3, lane: 1, label: "chat",
        body: "Presence and typing indicators over the existing socket, so comment threads update live.",
    }),
    mockIssue("Refund webhooks", { startDay: 4, days: 2, lane: 2, label: "api" }),
    mockIssue("Billing plans", {
        startDay: 0, days: 3, lane: 6, label: "billing",
        body: "Split the seat and usage tiers so a workspace can move between them mid-cycle.",
    }),
    mockIssue("Write tickets", { startDay: 0, days: 2, lane: 3, label: "docs" }),
    mockIssue("Terraform tidy-up", { startDay: 8, days: 2, lane: 3, label: "infra" }),
    mockIssue("Vectorise embeddings", {
        startDay: 4, days: 4, lane: 4, label: "data",
        body: "Backfill embeddings for every issue so similar-report detection covers the backlog.",
    }),
    mockIssue("Sprint calendar", { startDay: 9, days: 2, lane: 5, label: "calendar" }),
]

const DEMO_LABEL_ICONS = [
    { label: "billing", icon_name: "bank-card" },
    { label: "ai", icon_name: "bot" },
    { label: "analytics", icon_name: "chart-circle" },
    { label: "chat", icon_name: "chat" },
    { label: "api", icon_name: "cloud-connect" },
    { label: "docs", icon_name: "book" },
    { label: "infra", icon_name: "building" },
    { label: "data", icon_name: "category" },
    { label: "calendar", icon_name: "calendar" },
].map((l, i) => ({ ...l, id: `li-${i}`, project_id: "demo" }) as unknown as ProjectLabelIcon)

// The board is built to own the whole viewport, where there is nothing to
// scroll. Embedded in a scrolling page, a press-and-drag reads as a scroll
// gesture and the page runs away under the tile. So while a pointer is held
// inside the frame we suppress wheel/touch scrolling — preventDefault rather
// than overflow:hidden, which would jump the layout by the scrollbar width.
function BoardFrame({
    title,
    children,
    overlay,
    footer,
    frameRef,
    onEngage,
}: {
    title: string
    children: React.ReactNode
    /** Drawn inside the board's clipping viewport, in its coordinate space —
     *  the scripted cursor. */
    overlay?: React.ReactNode
    /** Drawn on the card, outside the board — the replay control. Deliberately
     *  not inside the viewport, so crossing it is never a board interaction. */
    footer?: React.ReactNode
    frameRef?: React.RefObject<HTMLDivElement | null>
    onEngage?: () => void
}) {
    const [held, setHeld] = useState(false)

    useEffect(() => {
        if (!held) return
        const stop = (e: Event) => e.preventDefault()
        const release = () => setHeld(false)
        window.addEventListener("wheel", stop, { passive: false })
        window.addEventListener("touchmove", stop, { passive: false })
        window.addEventListener("pointerup", release)
        window.addEventListener("pointercancel", release)
        return () => {
            window.removeEventListener("wheel", stop)
            window.removeEventListener("touchmove", stop)
            window.removeEventListener("pointerup", release)
            window.removeEventListener("pointercancel", release)
        }
    }, [held])

    return (
        <div
            className="fx-surface"
            // Only a REAL pointer counts as the reader arriving.
            onPointerDown={(e) => {
                if (!e.nativeEvent.isTrusted) return
                setHeld(true)
                onEngage?.()
            }}
        >
            <div className="fx-head">
                <Dots />
                {title}
            </div>
            {/* The frame is the board's VIEWPORT, not the card: the grid's
                `localOf` measures from there, so the cursor must share that
                box to be positioned in the same space. */}
            <div ref={frameRef} className="fx-boardwrap">
                {children}
                {overlay}
            </div>
            {footer}
        </div>
    )
}

// The board performs LIVE, driven in CELL space through the grid's demo handle
// — the tile lifts, shoves its neighbours out of the lane while it's held, and
// commits on release, all through the shipped mechanism.
//
// It is deliberately NOT driven by synthetic pointer events. That version
// looked identical on a still page and came apart on a scrolling one: turning
// cells into client coordinates for the board to turn back means depending on
// where the viewport is, and mid-scroll the main thread cannot know that — the
// compositor owns the scroll, so every rect read is stale by a varying amount
// and the tile stutters between cells that don't match the cursor. Cells have
// no viewport in the path, so there is nothing to be stale about.
//
// The board's own drag is untouched by any of this; a real hand still goes
// through framer exactly as it always did.
const BOARD_SCRIPT: Step[] = [
    // "Write tickets" carried four days on and up a lane, into the lane
    // "Refund webhooks" is already holding — which shoves it clear.
    { act: "move", id: "demo-7", dx: 4, dy: -1 },
    // "Terraform tidy-up" pulled back a day and up two lanes, under
    // "Realtime chat", which drops away in front of it.
    { act: "move", id: "demo-8", dx: -1, dy: -2, reach: 620 },
    // …and then the other half of planning: "Refund webhooks" given three
    // more days by its right edge, with the board's own start → end pill
    // counting up under the grip as it stretches.
    { act: "resize", id: "demo-5", dx: 3, reach: 640, rest: 760 },
]

export function TimelineDemo() {
    const frameRef = useRef<HTMLDivElement>(null)
    const boardRef = useRef<BoardDemoHandle | null>(null)
    const [auto, setAuto] = useState(true)
    const inView = useInView(frameRef)
    // A fresh array identity resets the board's local mirror (useScheduleSync),
    // gliding every dragged and pushed tile back to plan — so each pass starts
    // from the same picture, including after one is cut short by a scroll.
    const [pass, setPass] = useState(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const issues = useMemo(() => DEMO_ISSUES.map((i) => ({ ...i })), [pass])

    const cursorRef = useScriptedCursor({
        rootRef: frameRef,
        boardRef,
        steps: BOARD_SCRIPT,
        enabled: auto && inView,
        // Two halves to a full reset: the schedules (dates and lanes) come
        // from a fresh issues array, and the board's own view state — tile
        // heights, reserved widths, anything mid-gesture — is cleared through
        // the handle. Without the second, a reader who resized a tile before
        // pressing replay would watch the loop run over their edit.
        onCycleEnd: () => {
            boardRef.current?.reset()
            setPass((n) => n + 1)
        },
        onAbort: () => setAuto(false),
    })

    return (
        <BoardFrame
            title="Timeline · Q3 plan"
            frameRef={frameRef}
            onEngage={() => setAuto(false)}
            overlay={<ScriptedCursor ref={cursorRef} />}
            footer={!auto ? <ResumeButton onClick={() => setAuto(true)} /> : null}
        >
            <TimelineGridPlayful
                projectId="demo"
                issues={issues}
                labelIcons={DEMO_LABEL_ICONS}
                statusColors={[]}
                persist={false}
                demoRef={boardRef}
                // The viewport is fixed, full stop: no wheel, no zoom, no
                // grab-panning the canvas, and no auto-pan when a drag nears
                // an edge. The reader gets the composed shot and plays with
                // the tiles inside it; the wheel passes through to the page.
                //
                // Edge auto-pan in particular is sized for a full-screen board
                // — in a 400px frame its bands cover the top lanes, so merely
                // grabbing a tile there panned the camera away for good.
                lockCamera
                edgeAutoPan={false}
                initialTileRows={{ "demo-2": 2, "demo-4": 2, "demo-6": 2, "demo-9": 2 }}
            />
        </BoardFrame>
    )
}

const DEMO_CSS = `
/* the app's own card surface, floated on the dark section */
.fx-surface{
  position:relative;overflow:hidden;
  background:#fff;
  border:1px solid var(--c-border);
  border-radius:14px;
  /* The bottom strip is reserved for the replay pill, so it never lands on
     top of a row the reader might want to press. */
  padding:16px 16px 42px;
  box-shadow:0 40px 80px -40px rgba(0,0,0,.75);
  color:var(--c-text);
}

/* Hand the demo back to the loop. Only present once the reader has taken
   over — while the script is running there is nothing to resume. */
.fx-resume{
  position:absolute;right:14px;bottom:12px;z-index:70;
  display:inline-flex;align-items:center;gap:6px;
  font:inherit;font-size:10.5px;font-weight:700;
  letter-spacing:.08em;text-transform:uppercase;
  color:var(--c-text-muted);background:var(--c-surface);
  border:1px solid var(--c-border);border-radius:999px;
  padding:5px 11px 5px 9px;cursor:pointer;
  box-shadow:var(--shadow-pop);
  transition:color 160ms ease,background 160ms ease;
  animation:fx-rise 260ms cubic-bezier(.22,1,.36,1) both;
}
.fx-resume:hover{color:var(--c-text);background:var(--c-overlay)}
.fx-head{
  display:flex;align-items:center;gap:10px;
  font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
  color:var(--c-text-muted);margin-bottom:12px;
}
.fx-dots{display:flex;gap:5px;flex:none}
.fx-dots i{
  display:block;width:8px;height:8px;border-radius:999px;
  background:var(--c-border);
}

/* 1 — findings (IssueSuggestions/FindingCard) */
/* The list is height-locked to its tallest state — a FIXED height, not a
   floor — so a row opening under the scripted cursor can never resize the
   card and shove the rows below it down the page. The three collapsed headers
   plus one open body are sized to fit it (see .fx-reason's line clamp). */
.fx-finds{display:flex;flex-direction:column;gap:8px;height:236px;overflow:hidden}
.fx-find{
  border:1px solid var(--c-border);border-radius:10px;
  background:#fafafa;overflow:hidden;
  animation:fx-rise 420ms cubic-bezier(.22,1,.36,1) both;
  animation-delay:calc(var(--i,0)*.09s);
}
.fx-fhead{
  display:flex;align-items:center;gap:8px;width:100%;padding:8px 11px;
  background:#fff;border:0;text-align:left;cursor:pointer;font:inherit;
  transition:background 160ms ease;
}
/* synthetic events can't trigger :hover, so the scripted cursor marks what
   it's over and the same styling keys off that. */
.fx-fhead:hover,.fx-fhead[data-hot="true"]{background:#f1f1f2}
.fx-chev{color:#a1a1aa;flex:none;transition:transform .2s}
.fx-file{
  font-family:ui-monospace,Menlo,monospace;font-size:12.5px;
  color:#18181b;min-width:0;flex:1;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.fx-sym{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:#71717a;flex:none}
.fx-conf{
  flex:none;border-radius:6px;padding:2px 6px;
  font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.04em;
}
.fx-conf-high{background:#dcfce7;color:#166534}
.fx-conf-medium{background:#fef3c7;color:#92400e}
.fx-conf-low{background:#f4f4f5;color:#52525b}
/* The drop-down. Animating grid-template-rows 0fr → 1fr eases to the content's
   OWN height — no guessed max-height and no reserved slot to keep in sync. */
.fx-fslot{
  display:grid;grid-template-rows:0fr;overflow:hidden;background:#fff;
  transition:grid-template-rows 320ms cubic-bezier(.22,1,.36,1);
}
.fx-fslot[data-open="true"]{grid-template-rows:1fr}
.fx-fslot > *{min-height:0}
.fx-fbody{
  border-top:1px solid rgba(228,228,231,.6);
  padding:9px 11px 10px;opacity:0;transition:opacity 240ms ease;
}
.fx-fslot[data-open="true"] .fx-fbody{opacity:1}
/* Clamped so every finding's body is the same maximum height, which is what
   makes the fixed .fx-finds height above safe for any row. */
.fx-reason{
  margin:4px 0 0;font-size:12.5px;line-height:1.45;color:#3f3f46;
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;
}
.fx-fpath{
  display:inline-flex;align-items:center;gap:5px;margin-top:9px;
  font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:#71717a;
}

/* 2a — the issue detail: body left, meta/labels/timeline in the right rail */
.fx-detail{display:flex;gap:14px;padding-bottom:12px;border-bottom:1px solid var(--c-border)}
.fx-imain{min-width:0;flex:1}
.fx-iside{width:172px;flex:none}
.fx-ititle{font-size:14px;font-weight:800;letter-spacing:-.01em;color:var(--c-text)}
.fx-md{margin-top:7px;font-size:12.5px;line-height:1.55;color:var(--c-text-muted)}
.fx-md p{margin:0}
.fx-md code{
  font-family:ui-monospace,Menlo,monospace;font-size:11.5px;
  background:var(--c-overlay);border-radius:4px;padding:1px 4px;color:var(--c-text);
}
.fx-md ul{margin:6px 0 0;padding-left:16px;list-style:disc}
.fx-md li{margin:2px 0}
.fx-srow{display:flex;flex-wrap:wrap;gap:6px}
.fx-skey{
  margin:10px 0 5px;font-size:10px;font-weight:700;letter-spacing:.12em;
  text-transform:uppercase;color:var(--c-text-dim);
}
.fx-pill{
  display:inline-flex;align-items:center;gap:5px;
  border:1px solid var(--c-border);background:var(--c-surface-2);
  border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;
}
.fx-dot{width:7px;height:7px;border-radius:999px;display:block}
.fx-lab{border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700}
.fx-peek{
  margin:12px 0 0;border:1px solid var(--c-border);border-radius:14px;
  background:var(--c-surface-2);padding:12px;
}
.fx-peekhead{
  display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;
  font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  color:var(--c-text-muted);
}
.fx-peekopen{font-weight:600;letter-spacing:normal;text-transform:none}
.fx-peekbody{position:relative;height:80px;overflow:hidden}
.fx-centre{position:absolute;left:50%;top:0;bottom:0;width:1px;background:#d4d4d8}
.fx-today{
  position:absolute;left:44%;top:0;bottom:0;width:1px;
  background-image:linear-gradient(to bottom,#ef4444 0 4px,transparent 4px 8px);
  background-size:100% 8px;
}
/* real PeekTile — card + detached ghost + label overlay */
.fx-pcard{position:absolute;display:block}
.fx-plabel{position:absolute;display:flex;align-items:center;overflow:hidden;pointer-events:none}
.fx-pslot{display:flex;flex:none;align-items:center}
.fx-pchip{display:grid;place-items:center;border-radius:7px;flex:none}
.fx-ptitle{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800;line-height:1}
.fx-pnum{flex:none;padding-left:4px;padding-right:8px;font-family:ui-monospace,Menlo,monospace;font-weight:700;opacity:.45}
.fx-simhead{
  font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
  color:var(--c-text-muted);margin-bottom:2px;
}

/* 2 — similar issues (SimilarIssuesCard) */
.fx-sim{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.fx-simrow{
  display:flex;align-items:center;gap:10px;padding:11px 0;
  border-top:1px solid var(--c-border);
  animation:fx-rise 420ms cubic-bezier(.22,1,.36,1) both;
  animation-delay:calc(var(--i,0)*.09s);
  transition:opacity 240ms ease;
}
.fx-simrow:first-child{border-top:0}
/* filed against #131 — the row settles into a handled state */
.fx-simrow[data-filed="true"]{opacity:.6}
.fx-simrow[data-filed="true"] .fx-title{
  text-decoration:line-through;text-decoration-color:rgba(0,0,0,.3);
}
.fx-num{
  font-family:ui-monospace,Menlo,monospace;font-size:11.5px;font-weight:600;
  background:var(--c-surface-2);border-radius:6px;padding:2px 6px;flex:none;
}
.fx-title{font-size:13px;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fx-pct{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--c-text-dim);flex:none}
.fx-dupbtn{
  font:inherit;font-size:11.5px;font-weight:600;
  color:#fff;background:#18181b;border:0;
  border-radius:8px;padding:4px 9px;flex:none;
  min-width:94px;text-align:center;
  cursor:pointer;white-space:nowrap;
  transition:background 160ms ease;
}
.fx-dupbtn:hover,.fx-dupbtn[data-hot="true"]{background:#3f3f46}
.fx-simrow[data-filed="true"] .fx-dupbtn{background:#16a34a}

/* 3 — playful board (TimelineGridPlayful) */
/* The real board needs a sized frame to live in. It sits inside the same
   .fx-surface window as the other two demos, so the card's border and shadow
   belong to the window and this is just the clipping viewport. */
.fx-boardwrap{
  position:relative;height:400px;overflow:hidden;overscroll-behavior:contain;
  border:1px solid var(--c-border);border-radius:10px;
}

.fx-hint{
  margin:10px 0 0;text-align:center;font-size:10.5px;font-weight:600;
  letter-spacing:.02em;color:var(--c-text-dim);
}

/* the scripted drag's pretend cursor — positioned inside the board frame (so
   it's clipped by it, and immune to any transformed ancestor on the landing),
   and never a hit-test target, so the board underneath behaves exactly as it
   would. Only opacity is transitioned: the transform carries the position and
   is rewritten every frame, so animating it would fight the script. */
.fx-cursor{
  position:absolute;left:0;top:0;z-index:60;pointer-events:none;
  will-change:transform;filter:drop-shadow(0 3px 6px rgba(0,0,0,.35));
  opacity:0;transition:opacity 200ms ease;
}
.fx-cursor[data-shown="true"]{opacity:1}
.fx-cursor-ring{
  position:absolute;left:3px;top:3px;width:28px;height:28px;margin:-14px 0 0 -14px;
  border-radius:999px;background:var(--c-primary);
  opacity:0;transform:scale(.4);
  transition:opacity 160ms ease,transform 160ms cubic-bezier(.22,1,.36,1);
}
.fx-cursor[data-down="true"] .fx-cursor-ring{opacity:.3;transform:scale(1)}

/* one-shot entrance — the demos are driven by the scripted cursor now, so
   nothing here loops. */
@keyframes fx-rise{
  from{opacity:0;transform:translateY(6px)}
  to{opacity:1;transform:none}
}

@media (prefers-reduced-motion: reduce){
  .fx-find,.fx-simrow{animation:none;opacity:1;transform:none}
  .fx-fslot,.fx-fbody,.fx-fhead,.fx-dupbtn{transition:none}
  /* the scripted cursor doesn't start at all under reduced motion (see
     useScriptedCursor), so each demo simply sits in its opening state. */
}

/* ─── narrow screens ─────────────────────────────────────────────────────────
   These windows are miniatures of real app surfaces, so they inherit the app's
   desktop proportions — a fixed side rail, a row of flex:none controls. The
   landing gives them the viewport minus SECTION_X (px-8) and the card's own
   16px padding, which on a 390pt phone is ~294px of usable width. At that size
   the fixed parts eat nearly all of it and the flexible column collapses to a
   sliver, so the content spills past the window edge and gets clipped.

   Below 640px the fixed parts give way instead: the rail stacks under the body
   it annotates, and the duplicate row's controls drop their reserved widths. */
@media (max-width: 640px){
  /* Side rail under the body rather than beside it — 172px of a ~294px window
     left the issue text ~108px wide. */
  .fx-detail{flex-direction:column;gap:10px}
  .fx-iside{width:auto}
  .fx-srow{gap:5px}

  /* The button reserves 94px so its label doesn't jump between states; on a
     phone that reservation costs more than the jump does. The match percentage
     is the least load-bearing thing in the row, so it goes first. */
  .fx-simrow{gap:7px}
  .fx-dupbtn{min-width:0;padding:4px 8px}
  .fx-pct{display:none}

  /* The symbol is flex:none and the path is the flexible one, so on a narrow
     row the path — the whole point of "issues that point at the code" — was
     the thing that got ellipsed, down to "t…". The symbol is repeated in the
     row's open body, so the header can drop it and let the path read. */
  .fx-sym{display:none}

  /* The list height is locked so an opening row can't resize the card (see
     .fx-finds). That budget is measured at desktop width; down here the open
     row's reason wraps further and its file path fell off the bottom edge, so
     the lock is re-cut to the taller narrow layout rather than lifted. */
  .fx-finds{height:280px}
}
`
