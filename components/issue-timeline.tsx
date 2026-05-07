"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { flushSync } from "react-dom"
import {
    animate,
    motion,
    useMotionValue,
    useMotionValueEvent,
    useTransform,
    type MotionValue,
    type PanInfo,
} from "framer-motion"
import { cn } from "@/components/cn"
import { IconlyIcon } from "@/components/iconly-icon"
import {
    DAY_MS,
    DEFAULT_TILE_HOURS,
    HOUR_MS,
    type Zoom,
    ZOOM_LABEL,
    ZOOM_PX_PER_HOUR,
    clampPxPerHour,
    nearestZoomPreset,
    pxPerDay,
    snapToHour,
    xToTime,
} from "@/lib/timeline/scale"
import { DEFAULT_STATUS_COLORS, isDarkColor } from "@/lib/timeline/colors"
import { ScheduleOutbox, type SchedulePatch } from "@/lib/timeline/outbox"
import type { Issue, IssuePriority, IssueStatus, ProjectLabelIcon, ProjectStatusColor } from "@/lib/supabase/types"

// IssueTimeline — Gantt-flavoured planning canvas. Tiles are
// draggable + resizable via framer-motion: gestures use CSS
// transforms during the drag (no React re-renders per pointermove)
// and snap to hour / lane boundaries on release. Tray pills can be
// dragged onto the canvas to schedule them; if released outside
// the canvas they spring back to their resting slot.
//
// Saves are local-first. Each gesture writes optimistically to
// React state and enqueues a patch in a localStorage-backed
// outbox; a background loop flushes the outbox to the
// PATCH /api/issues/[id]/schedule endpoint every ~2s and on tab
// hide. That keeps the gesture latency at zero (no fetch round
// trip) and survives reloads — pending patches are reapplied on
// top of the freshly-loaded server data when the page returns.

const PRIORITY_RINGS: Record<IssuePriority, number> = {
    low: 1,
    medium: 1,
    high: 2,
    urgent: 3,
}

const CANVAS_HEIGHT = 520
const ROW_SNAP = 0.04   // 25 lanes
const MIN_TILE_HOURS = 1
const TRAY_HEIGHT = 132
const ORIGIN_OFFSET_DAYS = 5  // 5 days of pre-canvas runway
const OUTBOX_FLUSH_MS = 2000  // 2s background sync

export function IssueTimeline({
    projectId,
    issues,
    labelIcons,
    statusColors,
    initialZoom = "week",
    onTileClick,
    fullHeight = false,
    focusIssueId = null,
}: {
    projectId: string
    issues: Issue[]
    labelIcons: ProjectLabelIcon[]
    statusColors: ProjectStatusColor[]
    initialZoom?: Zoom
    onTileClick?: (issue: Issue) => void
    fullHeight?: boolean
    /** When set, the canvas auto-scrolls to centre this issue
     *  instead of the "now" line on first paint. */
    focusIssueId?: string | null
}) {
    const router = useRouter()
    // Continuous zoom — pixels per hour. Wheel events adjust this
    // smoothly; the preset buttons just snap to canonical values.
    const [pxPerHour, setPxPerHour] = useState<number>(ZOOM_PX_PER_HOUR[initialZoom])
    const activePreset: Zoom = nearestZoomPreset(pxPerHour)
    // Mirror of pxPerHour kept up-to-date synchronously. Wheel
    // events fire faster than React can re-render, so reading the
    // state would race with itself; the ref always gives us the
    // freshest value to chain ratios off. We sync via effect so
    // it stays clean per the React purity rules; applyZoom also
    // writes the ref synchronously before flushSync to handle
    // back-to-back wheel events that fire inside one frame.
    const pxPerHourRef = useRef(pxPerHour)
    useEffect(() => { pxPerHourRef.current = pxPerHour }, [pxPerHour])

    // Local-first write buffer. Schedule changes are persisted to
    // localStorage immediately and flushed to the server on a
    // background timer; the component reads/writes through this
    // single instance. Lazy-init via useState so the constructor
    // runs once on the client without tripping the "no refs during
    // render" lint rule (and stays null on the server).
    const [outbox] = useState<ScheduleOutbox | null>(() =>
        typeof window === "undefined" ? null : new ScheduleOutbox(projectId),
    )

    // Local mirror of issues so we can apply optimistic updates
    // and overlay any not-yet-flushed outbox patches. Resync when
    // the parent passes a new issues prop, layering the outbox on
    // top so the user's pending edits stay visible.
    const [local, setLocal] = useState<Issue[]>(() => overlayOutbox(issues, outbox))
    const [seenIssues, setSeenIssues] = useState(issues)
    if (issues !== seenIssues) {
        setSeenIssues(issues)
        setLocal(overlayOutbox(issues, outbox))
    }

    // Wall-clock kept in state so origin/now line stay pure during
    // render. Initial value is 0 so server and client agree during
    // SSR; the real time is set in an effect after mount and the
    // tick keeps it fresh thereafter. The set-state-in-effect lint
    // is fine here — we're deliberately initialising from a side
    // effect (the wall clock) to avoid a hydration mismatch.
    const [nowMs, setNowMs] = useState(0)
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setNowMs(Date.now())
        const t = setInterval(() => setNowMs(Date.now()), 60_000)
        return () => clearInterval(t)
    }, [])

    // After the wall-clock is real, scroll the canvas so the Now
    // line lands in the visible viewport. Origin sits a few days
    // before "now", so without this the user lands at scrollLeft=0
    // and the marker is off to the right. We anchor it ~25% of the
    // viewport width from the left so there's still a strip of
    // past visible. Runs once.
    const scrolledToNowRef = useRef(false)

    const colorOverrides = useMemo(() => {
        const m: Partial<Record<IssueStatus, string>> = {}
        for (const c of statusColors) m[c.status] = c.color
        return m
    }, [statusColors])

    const labelIconMap = useMemo(() => {
        const m = new Map<string, ProjectLabelIcon>()
        for (const i of labelIcons) m.set(i.label, i)
        return m
    }, [labelIcons])

    // mounted is implied by nowMs > 0 — we only set Date.now()
    // inside the post-mount effect, so SSR / first hydration both
    // see nowMs === 0. Several pieces below (NowLine, DayLabels,
    // tile labels) gate on this so that anything timezone- or
    // locale-dependent only renders once we're on the client.
    const mounted = nowMs > 0

    const originMs = useMemo(() => {
        const earliest = local
            .map((i) => i.starts_at ? Date.parse(i.starts_at) : null)
            .filter((v): v is number => v !== null)
            .reduce((a, b) => Math.min(a, b), nowMs)
        const base = Math.min(earliest, nowMs) - ORIGIN_OFFSET_DAYS * DAY_MS
        if (!mounted) {
            // Pre-mount: UTC floor keeps SSR and the first client
            // render byte-identical.
            return Math.floor(base / DAY_MS) * DAY_MS
        }
        // Post-mount: snap to LOCAL midnight so the day grid lines
        // fall on the user's 00:00, not on UTC's 00:00 (which can
        // be e.g. 07:00 local).
        const d = new Date(base)
        d.setHours(0, 0, 0, 0)
        return d.getTime()
    }, [local, nowMs, mounted])

    const totalMs = useMemo(() => {
        const latest = local
            .map((i) => i.ends_at ? Date.parse(i.ends_at) : null)
            .filter((v): v is number => v !== null)
            .reduce((a, b) => Math.max(a, b), nowMs)
        const span = Math.max(latest - originMs, 60 * DAY_MS) + 14 * DAY_MS
        return span
    }, [local, originMs, nowMs])

    const canvasRef = useRef<HTMLDivElement>(null)
    const scrollerRef = useRef<HTMLDivElement>(null)

    // Track canvas height for fullHeight mode. We can't read
    // clientHeight during render (effects are required), so we
    // observe and store.
    const [measuredHeight, setMeasuredHeight] = useState(CANVAS_HEIGHT)
    useEffect(() => {
        if (!fullHeight) return
        const el = canvasRef.current
        if (!el) return
        const ro = new ResizeObserver((entries) => {
            const h = entries[0]?.contentRect.height
            if (h && h > 0) setMeasuredHeight(h)
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [fullHeight])
    const canvasHeightPx = fullHeight ? measuredHeight : CANVAS_HEIGHT

    // Auto-scroll on first mount. If a focusIssueId is set (e.g.
    // arrived from the issue detail peek card), centre that
    // issue's tile in the viewport. Otherwise fall back to the
    // Now line so the marker is actually visible — origin sits
    // ~5 days before "now", which is well past most viewport
    // widths at the default zoom.
    useEffect(() => {
        if (!mounted) return
        if (scrolledToNowRef.current) return
        const scroller = scrollerRef.current
        if (!scroller) return
        let targetX: number | null = null
        if (focusIssueId) {
            const focal = local.find((i) => i.id === focusIssueId)
            if (focal && focal.starts_at && focal.ends_at) {
                const focalStart = Date.parse(focal.starts_at)
                const focalEnd   = Date.parse(focal.ends_at)
                const focalMid   = (focalStart + focalEnd) / 2
                targetX = ((focalMid - originMs) / HOUR_MS) * pxPerHour
                // Anchor at viewport centre when focusing.
                scroller.scrollLeft = Math.max(0, targetX - scroller.clientWidth * 0.5)
                scrolledToNowRef.current = true
                return
            }
        }
        const nowX = ((nowMs - originMs) / HOUR_MS) * pxPerHour
        scroller.scrollLeft = Math.max(0, nowX - scroller.clientWidth * 0.25)
        scrolledToNowRef.current = true
    }, [mounted, nowMs, originMs, pxPerHour, focusIssueId, local])

    function commitSchedule(issueId: string, patch: SchedulePatch) {
        // Optimistic local update — flushSync so the DOM reflects
        // the new position by the time the caller resets motion
        // values.
        flushSync(() => {
            setLocal((prev) => prev.map((i) => (i.id === issueId ? { ...i, ...patch } : i)))
        })
        // Queue the patch — the background flusher (below) takes
        // care of the network round trip.
        outbox?.enqueue(issueId, patch)
    }

    // Background flush: drain the outbox to the server every
    // OUTBOX_FLUSH_MS, and again whenever the tab is about to be
    // hidden / unloaded. The hide flush uses fetch keepalive so
    // the request can outlive the page.
    useEffect(() => {
        if (!outbox) return
        let inFlight = false

        async function flush(opts: { keepalive?: boolean } = {}) {
            if (inFlight) return
            if (!outbox || outbox.size() === 0) return
            inFlight = true
            try {
                let synced = 0
                for (const entry of outbox.snapshot()) {
                    try {
                        const res = await fetch(`/api/issues/${entry.issueId}/schedule`, {
                            method: "PATCH",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify(entry.patch),
                            keepalive: opts.keepalive,
                        })
                        if (res.ok) {
                            outbox.remove(entry.issueId)
                            synced++
                        } else if (res.status >= 400 && res.status < 500) {
                            // 4xx is permanent — drop the entry so a
                            // bad patch doesn't wedge the queue.
                            outbox.remove(entry.issueId)
                        } else {
                            // 5xx — leave it for retry next cycle.
                            break
                        }
                    } catch {
                        // Network error — leave it for retry.
                        break
                    }
                }
                // Refresh the route once per flush cycle (not per
                // entry) so server-derived data picks up the
                // changes without thrashing.
                if (synced > 0) router.refresh()
            } finally {
                inFlight = false
            }
        }

        const intervalId = window.setInterval(flush, OUTBOX_FLUSH_MS)

        function onHide() {
            if (document.visibilityState === "hidden") void flush({ keepalive: true })
        }
        document.addEventListener("visibilitychange", onHide)
        window.addEventListener("pagehide", onHide)

        // Drain anything left over from a previous session.
        void flush()

        return () => {
            window.clearInterval(intervalId)
            document.removeEventListener("visibilitychange", onHide)
            window.removeEventListener("pagehide", onHide)
        }
    }, [outbox, router])

    function returnToTray(issue: Issue) {
        commitSchedule(issue.id, { starts_at: null, ends_at: null, lane_y: null })
    }

    const scheduled = local.filter((i) => i.starts_at && i.ends_at && i.lane_y != null)
    const unscheduled = local.filter((i) => !i.starts_at || !i.ends_at || i.lane_y == null)

    // Apply a zoom change anchored at a viewport x position.
    //
    // For smoothness we keep React entirely out of the wheel hot
    // path. The canvas's `--pxh` CSS variable drives every layout
    // dimension that scales with zoom (canvas width, tile left /
    // width, day-label left, the day-grid background) via calc(),
    // so updating one variable on the DOM reflows the whole
    // timeline without a single React render. The browser's
    // layout pass is the cost — and it's the cost we'd pay anyway.
    //
    // React state is kept in sync via a debounced commit so the
    // things that DO need React (label step density, the active
    // preset highlight) catch up once the user pauses.
    const commitTimerRef = useRef<number | null>(null)

    function applyZoom(target: number, anchorClientX: number) {
        const scroller = scrollerRef.current
        const canvas   = canvasRef.current
        if (!scroller || !canvas) return
        const oldVal = pxPerHourRef.current
        const newVal = clampPxPerHour(target)
        if (newVal === oldVal) return

        const rect = scroller.getBoundingClientRect()
        const anchorInScroller = anchorClientX - rect.left
        const canvasX = scroller.scrollLeft + anchorInScroller

        pxPerHourRef.current = newVal
        // Direct DOM write — no React reconciliation. The CSS
        // variable propagates to every child that uses calc(),
        // and the canvas width in our style block is itself
        // calc(var(--pxh) * var(--total-hr) * 1px).
        canvas.style.setProperty("--pxh", String(newVal))

        // CSS-var changes update layout synchronously, so
        // scrollWidth already reflects the new canvas width by the
        // time we set scrollLeft.
        const ratio = newVal / oldVal
        scroller.scrollLeft = canvasX * ratio - anchorInScroller

        // Debounce the React-state commit. 120ms is long enough to
        // ride out trackpad-momentum bursts but short enough that
        // label density adjusts by the time the user reaches for
        // a tile.
        if (commitTimerRef.current !== null) {
            window.clearTimeout(commitTimerRef.current)
        }
        commitTimerRef.current = window.setTimeout(() => {
            commitTimerRef.current = null
            setPxPerHour(pxPerHourRef.current)
        }, 120)
    }

    // Mouse-wheel / trackpad zoom anchored at the pointer. We use
    // a non-passive native listener so we can preventDefault and
    // keep the page from scrolling while the user zooms (React's
    // onWheel is passive in newer React). Wheel deltas across one
    // animation frame are coalesced and applied together — that
    // alone caps work to display-refresh rate; the CSS-var trick
    // above is what makes each frame actually cheap.
    useEffect(() => {
        const scroller = scrollerRef.current
        if (!scroller) return
        let pendingDeltaY = 0
        let pendingClientX = 0
        let rafId: number | null = null

        function flushPending() {
            rafId = null
            const dy = pendingDeltaY
            const cx = pendingClientX
            pendingDeltaY = 0
            if (dy === 0) return
            const factor = Math.exp(-dy * 0.0015)
            applyZoom(pxPerHourRef.current * factor, cx)
        }

        function onWheel(e: WheelEvent) {
            if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return
            if (e.shiftKey) return
            e.preventDefault()
            pendingDeltaY += e.deltaY
            pendingClientX = e.clientX
            if (rafId === null) rafId = requestAnimationFrame(flushPending)
        }

        scroller.addEventListener("wheel", onWheel, { passive: false })
        return () => {
            scroller.removeEventListener("wheel", onWheel)
            if (rafId !== null) cancelAnimationFrame(rafId)
        }
    }, [])

    function setZoomPreset(z: Zoom) {
        const scroller = scrollerRef.current
        if (!scroller) { setPxPerHour(ZOOM_PX_PER_HOUR[z]); return }
        // Anchor at the viewport centre so the user's focal point
        // doesn't jump when picking a preset.
        const rect = scroller.getBoundingClientRect()
        applyZoom(ZOOM_PX_PER_HOUR[z], rect.left + rect.width / 2)
    }

    return (
        <div className={cn("flex flex-col gap-4", fullHeight && "h-full min-h-0")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <ZoomToggle zoom={activePreset} onChange={setZoomPreset} />
                <StatusLegend
                    projectId={projectId}
                    overrides={colorOverrides}
                    onSavedRefresh={() => router.refresh()}
                />
            </div>

            <div className={cn(
                "rounded-[18px] border border-[color:var(--c-border)] bg-white",
                fullHeight && "flex min-h-0 flex-1 flex-col",
            )}>
                <div
                    ref={scrollerRef}
                    className={cn(
                        "relative overflow-x-auto overflow-y-hidden",
                        fullHeight && "min-h-0 flex-1",
                    )}
                >
                    <div
                        ref={canvasRef}
                        className="relative"
                        style={{
                            // --pxh is the live zoom level; wheel
                            // events update it directly via DOM,
                            // bypassing React. --total-hr fixes the
                            // canvas's temporal extent. Width and
                            // the day-grid background both compute
                            // from --pxh via calc(), so changing
                            // the variable reflows the canvas
                            // without re-rendering any tiles.
                            ["--pxh" as string]: pxPerHour,
                            ["--total-hr" as string]: totalMs / HOUR_MS,
                            width: "calc(var(--pxh) * var(--total-hr) * 1px)",
                            height: fullHeight ? "100%" : `${CANVAS_HEIGHT}px`,
                            minHeight: fullHeight ? "100%" : undefined,
                            backgroundImage: "repeating-linear-gradient(to right, transparent 0, transparent calc(var(--pxh) * 24px - 1px), rgba(0,0,0,0.08) calc(var(--pxh) * 24px - 1px), rgba(0,0,0,0.08) calc(var(--pxh) * 24px))",
                        } as React.CSSProperties}
                    >
                        {/* NowLine and DayLabels both depend on
                            timezone (the labels via Intl, the
                            line via Date.now). Only render them
                            after the client has mounted to avoid
                            hydration mismatches. */}
                        {mounted && <NowLine originMs={originMs} nowMs={nowMs} />}
                        {mounted && <DayLabels originMs={originMs} totalMs={totalMs} pxPerHour={pxPerHour} />}

                        {scheduled.map((issue) => (
                            <TimelineTile
                                key={issue.id}
                                issue={issue}
                                originMs={originMs}
                                pxPerHourRef={pxPerHourRef}
                                canvasHeight={canvasHeightPx}
                                colorOverrides={colorOverrides}
                                labelIconMap={labelIconMap}
                                onCommit={commitSchedule}
                                onUnschedule={() => returnToTray(issue)}
                                onClick={() => onTileClick?.(issue)}
                            />
                        ))}
                    </div>
                </div>

                <div
                    className="border-t border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-4 py-3"
                    style={{ minHeight: TRAY_HEIGHT }}
                >
                    <div className="mb-2 flex items-baseline justify-between">
                        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--c-text-muted)]">
                            Unscheduled
                        </h3>
                        <span className="text-[11px] text-[color:var(--c-text-dim)]">
                            Drag a tile up onto the timeline to schedule it
                        </span>
                    </div>
                    {unscheduled.length === 0 ? (
                        <p className="rounded-[10px] border border-dashed border-[color:var(--c-border)] bg-white px-4 py-4 text-center text-[12.5px] text-[color:var(--c-text-muted)]">
                            Everything&rsquo;s on the timeline.
                        </p>
                    ) : (
                        <ul className="flex flex-wrap gap-2">
                            {unscheduled.map((issue) => (
                                <TrayTile
                                    key={issue.id}
                                    issue={issue}
                                    canvasRef={canvasRef}
                                    scrollerRef={scrollerRef}
                                    originMs={originMs}
                                    pxPerHourRef={pxPerHourRef}
                                    colorOverrides={colorOverrides}
                                    labelIconMap={labelIconMap}
                                    onCommit={commitSchedule}
                                    onClick={() => onTileClick?.(issue)}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    )
}

// ─── tile renderers ───────────────────────────────────────────────────────

function TimelineTile({
    issue,
    originMs,
    pxPerHourRef,
    canvasHeight,
    colorOverrides,
    labelIconMap,
    onCommit,
    onUnschedule,
    onClick,
}: {
    issue: Issue
    originMs: number
    pxPerHourRef: RefObject<number>
    canvasHeight: number
    colorOverrides: Partial<Record<IssueStatus, string>>
    labelIconMap: Map<string, ProjectLabelIcon>
    onCommit: (id: string, patch: SchedulePatch) => void
    onUnschedule: () => void
    onClick: () => void
}) {
    const x = useMotionValue(0)
    const y = useMotionValue(0)
    // Tracks whether the current pointer gesture became a drag.
    // framer-motion's onTap can fire even after a drag in some
    // edge cases (very small drags, drags that end inside the same
    // bounding box), which would otherwise pop the drawer every
    // time the user drops a tile. We guard onTap with this flag.
    const dragged = useRef(false)

    if (!issue.starts_at || !issue.ends_at || issue.lane_y == null) return null
    const startMs = Date.parse(issue.starts_at)
    const endMs   = Date.parse(issue.ends_at)
    const startHr = (startMs - originMs) / HOUR_MS
    const durHr   = (endMs - startMs) / HOUR_MS
    const top  = issue.lane_y * (canvasHeight - 56)
    const fill = issue.color ?? colorOverrides[issue.status] ?? DEFAULT_STATUS_COLORS[issue.status]
    const fg = isDarkColor(fill) ? "#ffffff" : "#0a0a0a"
    const rings = PRIORITY_RINGS[issue.priority]
    const labelKey = issue.labels[0]
    const iconName = labelKey ? labelIconMap.get(labelKey)?.icon_name ?? null : null

    function handleDragEnd(_: unknown, info: PanInfo) {
        const live = pxPerHourRef.current
        const newStart = snapToHour(startMs + (info.offset.x / live) * HOUR_MS)
        const newEnd   = newStart + (endMs - startMs)
        const newLane  = clamp01(roundTo(issue.lane_y! + info.offset.y / Math.max(1, canvasHeight - 56), ROW_SNAP))
        onCommit(issue.id, {
            starts_at: new Date(newStart).toISOString(),
            ends_at:   new Date(newEnd).toISOString(),
            lane_y:    newLane,
        })
        // commitSchedule wraps the React update in flushSync so the
        // tile is now positioned at its new left/top — reset the
        // drag transform without an animation so there's no jump.
        x.set(0)
        y.set(0)
    }

    return (
        <motion.div
            drag
            dragMomentum={false}
            dragElastic={0}
            dragSnapToOrigin={false}
            whileDrag={{ scale: 1.02, zIndex: 30 }}
            onDragStart={() => { dragged.current = true }}
            onDragEnd={handleDragEnd}
            onTap={() => {
                if (dragged.current) {
                    dragged.current = false
                    return
                }
                onClick()
            }}
            onDoubleClick={onUnschedule}
            // The wrapper has no width — it shrink-to-fits around
            // its pill and bar children. The pill carries identity
            // (icon + title) and sizes to its text content; the
            // bar below represents duration and its width tracks
            // --pxh. So the tile's footprint is max(pill, bar).
            //
            // Cast through unknown because framer-motion's style
            // prop accepts MotionValue (for x/y) but TS can't unify
            // that with arbitrary CSS custom properties.
            style={{
                x, y, position: "absolute",
                top,
                ["--start-hr" as string]: startHr,
                ["--dur-hr" as string]: durHr,
                left: "calc(var(--pxh) * var(--start-hr) * 1px)",
            } as unknown as React.CSSProperties}
            title={`${issue.title} • #${issue.issue_number}`}
            className="touch-none w-max"
        >
            <div
                className={cn(
                    "relative inline-flex h-9 cursor-grab items-center gap-2 overflow-hidden whitespace-nowrap rounded-full px-3 text-[12px] font-semibold shadow-sm active:cursor-grabbing",
                )}
                // Pill width is capped two ways: a hard 220px so
                // long titles never produce monster pills, AND
                // 12px shorter than the bar so the duration line
                // always extends past the pill's right edge as a
                // visual cue. Long titles ellipsize via the inner
                // span's truncate; short durations clip the pill.
                style={{
                    background: fill,
                    color: fg,
                    boxShadow: ringShadow(rings, fill),
                    maxWidth: "min(220px, calc(var(--pxh) * var(--dur-hr) * 1px - 12px))",
                }}
            >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-white/20">
                    <IconlyIcon name={iconName} size={14} />
                </span>
                <span className="min-w-0 truncate">{issue.title}</span>
                <span className="shrink-0 font-mono text-[10.5px] opacity-80">#{issue.issue_number}</span>
            </div>
            <DurationBar
                issue={issue}
                fill={fill}
                pxPerHourRef={pxPerHourRef}
                tileX={x}
                onCommit={onCommit}
            />
        </motion.div>
    )
}

// DurationBar — the colored line under the pill, sized by
// duration (calc(var(--pxh) * var(--dur-hr))). Dragging the bar
// horizontally changes its visual width via a motion value; on
// pointer-up we snap to the hour grid and commit a new ends_at.
//
// We use native pointer events instead of framer-motion's `onPan`
// because the wrapper has `drag` engaged on the same DOM subtree —
// framer-motion's gesture arbitration between a parent drag and a
// child pan is fragile, and the safest fix is to take the gesture
// here ourselves and stopPropagation in pointerdown so the parent
// never sees the event.
function DurationBar({
    issue,
    fill,
    pxPerHourRef,
    tileX,
    onCommit,
}: {
    issue: Issue
    fill: string
    pxPerHourRef: RefObject<number>
    /** Tile's horizontal drag offset. We read it (along with the
     *  bar's own resize offset) to recompute the visible date /
     *  time labels in real time as the user drags. */
    tileX: MotionValue<number>
    onCommit: (id: string, patch: SchedulePatch) => void
}) {
    const ref = useRef<HTMLDivElement>(null)
    const startSpanRef = useRef<HTMLSpanElement>(null)
    const endSpanRef = useRef<HTMLSpanElement>(null)
    const extra = useMotionValue(0)
    // Live bar width = scheduled width + in-flight pan offset.
    // useTransform produces a MotionValue<string> that framer
    // writes straight to the DOM, so pan updates skip React.
    const widthMv = useTransform(extra, (e) => `max(8px, calc(var(--pxh) * var(--dur-hr) * 1px + ${e}px))`)

    // Stash the latest issue / commit callback so the gesture
    // listeners (registered once below) always see fresh data
    // without re-attaching listeners on every render. Sync via an
    // effect rather than during render to satisfy the lint rule
    // banning in-render ref mutation.
    const issueRef = useRef(issue)
    const onCommitRef = useRef(onCommit)
    useEffect(() => {
        issueRef.current = issue
        onCommitRef.current = onCommit
    })

    // Recompute the displayed start/end strings from the live
    // motion values. Writes via textContent rather than React
    // state so framer-motion's per-frame updates stay out of the
    // React render path.
    //
    // The displayed values are snapped to the hour grid — the
    // gesture commits to a snapped time on release, so showing
    // the snapped preview matches what the user will actually
    // get. This is what makes the label tick over from "14:00"
    // to "15:00" as the bar passes the next hour line, instead
    // of scrolling continuously.
    function refreshLabels() {
        const cur = issueRef.current
        if (!cur.starts_at || !cur.ends_at) return
        const startMs = Date.parse(cur.starts_at)
        const endMs   = Date.parse(cur.ends_at)
        const live = pxPerHourRef.current || 1
        const tx = tileX.get()
        const ex = extra.get()
        // Tile move shifts both edges by tx; bar resize adds ex
        // to the end only.
        const liveStart = snapToHour(startMs + (tx / live) * HOUR_MS)
        const liveEnd   = snapToHour(endMs   + ((tx + ex) / live) * HOUR_MS)
        if (startSpanRef.current) startSpanRef.current.textContent = DATETIME_FMT.format(new Date(liveStart))
        if (endSpanRef.current)   endSpanRef.current.textContent   = DATETIME_FMT.format(new Date(liveEnd))
    }
    useMotionValueEvent(tileX, "change", refreshLabels)
    useMotionValueEvent(extra, "change", refreshLabels)
    // Re-sync when the issue's committed times change (e.g. after
    // drag-end commits a new schedule).
    useEffect(() => {
        refreshLabels()
        // refreshLabels reads the latest issue via ref, so we only
        // need to retrigger on the values that change post-commit.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [issue.starts_at, issue.ends_at])

    useEffect(() => {
        const el = ref.current
        if (!el) return
        let startX: number | null = null
        let pid: number | null = null

        function onDown(e: PointerEvent) {
            if (e.pointerType === "mouse" && e.button !== 0) return
            // Stop the wrapper's drag from engaging — its
            // pointerdown listener is in bubble phase, so a single
            // bubble-stage stopPropagation here is enough.
            e.stopPropagation()
            e.preventDefault()
            startX = e.clientX
            pid = e.pointerId
            try { el!.setPointerCapture(e.pointerId) } catch { /* ignore */ }
        }
        function onMove(e: PointerEvent) {
            if (startX == null) return
            extra.set(e.clientX - startX)
        }
        function finish(e: PointerEvent) {
            if (startX == null) return
            const offsetX = e.clientX - startX
            try { if (pid != null) el!.releasePointerCapture(pid) } catch { /* ignore */ }
            startX = null
            pid = null
            const cur = issueRef.current
            if (cur.starts_at && cur.ends_at) {
                const live = pxPerHourRef.current
                const startMs = Date.parse(cur.starts_at)
                const endMs   = Date.parse(cur.ends_at)
                const min = startMs + MIN_TILE_HOURS * HOUR_MS
                const newEnd = Math.max(min, snapToHour(endMs + (offsetX / live) * HOUR_MS))
                onCommitRef.current(cur.id, { ends_at: new Date(newEnd).toISOString() })
            }
            extra.set(0)
        }

        el.addEventListener("pointerdown", onDown)
        el.addEventListener("pointermove", onMove)
        el.addEventListener("pointerup", finish)
        el.addEventListener("pointercancel", finish)
        return () => {
            el.removeEventListener("pointerdown", onDown)
            el.removeEventListener("pointermove", onMove)
            el.removeEventListener("pointerup", finish)
            el.removeEventListener("pointercancel", finish)
        }
    }, [extra, pxPerHourRef])

    return (
        <motion.div
            ref={ref}
            // Outer wrapper is 14px tall to give a comfortable hit
            // area; the visual bar inside is 6px tall and pinned
            // top:4 so it sits centred. marginTop adds visible
            // breathing room between the pill and the duration
            // line above it.
            style={{
                width: widthMv,
                height: 14,
                marginTop: 6,
                position: "relative",
                cursor: "ew-resize",
                touchAction: "none",
            }}
            aria-label="Drag to change duration"
        >
            {/* Start / end labels flanking the bar. Absolutely
                positioned at right-full / left-full so they sit
                just outside the bar's left and right edges and
                track the bar as the user pans to resize. The
                spans' textContent is updated imperatively from
                motion-value subscriptions so the times follow the
                gesture in real time without re-rendering. */}
            {/* Label spans are populated imperatively by
                refreshLabels() (initial mount + every motion-value
                change). They render empty during SSR / pre-mount
                so the timezone-dependent format string can't
                cause a hydration mismatch. */}
            <span
                ref={startSpanRef}
                className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] font-semibold text-[color:var(--c-text-muted)]"
                aria-hidden
            />
            <span
                ref={endSpanRef}
                className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] font-semibold text-[color:var(--c-text-muted)]"
                aria-hidden
            />
            <div
                style={{
                    position: "absolute",
                    top: 4,
                    left: 0,
                    right: 0,
                    height: 6,
                    background: fill,
                    opacity: 0.85,
                    borderRadius: 9999,
                }}
            />
        </motion.div>
    )
}

function TrayTile({
    issue,
    canvasRef,
    scrollerRef,
    originMs,
    pxPerHourRef,
    colorOverrides,
    labelIconMap,
    onCommit,
    onClick,
}: {
    issue: Issue
    canvasRef: RefObject<HTMLDivElement | null>
    scrollerRef: RefObject<HTMLDivElement | null>
    originMs: number
    pxPerHourRef: RefObject<number>
    colorOverrides: Partial<Record<IssueStatus, string>>
    labelIconMap: Map<string, ProjectLabelIcon>
    onCommit: (id: string, patch: SchedulePatch) => void
    onClick: () => void
}) {
    const x = useMotionValue(0)
    const y = useMotionValue(0)
    const dragged = useRef(false)

    const fill = issue.color ?? colorOverrides[issue.status] ?? DEFAULT_STATUS_COLORS[issue.status]
    const fg = isDarkColor(fill) ? "#ffffff" : "#0a0a0a"
    const rings = PRIORITY_RINGS[issue.priority]
    const labelKey = issue.labels[0]
    const iconName = labelKey ? labelIconMap.get(labelKey)?.icon_name ?? null : null

    function handleDragEnd(_: unknown, info: PanInfo) {
        const canvas = canvasRef.current
        const scroller = scrollerRef.current
        if (!canvas || !scroller) return
        const rect = canvas.getBoundingClientRect()
        const px = info.point.x
        const py = info.point.y
        const overCanvas =
            px >= rect.left && px <= rect.right &&
            py >= rect.top && py <= rect.bottom
        if (overCanvas) {
            const localX = px - rect.left
            const localY = py - rect.top
            const startMs = snapToHour(xToTime(localX, originMs, pxPerHourRef.current).getTime())
            const endMs   = startMs + DEFAULT_TILE_HOURS * HOUR_MS
            const lane    = clamp01(roundTo(localY / Math.max(1, rect.height), ROW_SNAP))
            onCommit(issue.id, {
                starts_at: new Date(startMs).toISOString(),
                ends_at:   new Date(endMs).toISOString(),
                lane_y:    lane,
            })
            // Element will unmount from tray as state updates; no
            // need to reset motion values explicitly.
            return
        }
        // Released outside canvas — spring back to the tray slot.
        animate(x, 0, { type: "spring", stiffness: 500, damping: 40 })
        animate(y, 0, { type: "spring", stiffness: 500, damping: 40 })
    }

    return (
        <motion.li
            // Hold the layout slot so other pills don't shift when
            // this one is being dragged.
            layout="position"
            className="list-none"
        >
            <motion.div
                drag
                dragMomentum={false}
                dragElastic={0.05}
                dragSnapToOrigin={false}
                whileDrag={{ scale: 1.04, zIndex: 50 }}
                onDragStart={() => { dragged.current = true }}
                onDragEnd={handleDragEnd}
                onTap={() => {
                    if (dragged.current) {
                        dragged.current = false
                        return
                    }
                    onClick()
                }}
                style={{ x, y }}
                className="touch-none"
            >
                <div
                    role="button"
                    tabIndex={0}
                    className="flex h-9 cursor-grab items-center gap-2 rounded-full px-3 text-[12px] font-semibold active:cursor-grabbing"
                    style={{ background: fill, color: fg, boxShadow: ringShadow(rings, fill) }}
                    title={issue.title}
                >
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-white/20">
                        <IconlyIcon name={iconName} size={14} />
                    </span>
                    <span className="line-clamp-1 max-w-[180px]">{issue.title}</span>
                    <span className="font-mono text-[10.5px] opacity-80">#{issue.issue_number}</span>
                </div>
            </motion.div>
        </motion.li>
    )
}

// ─── chrome ───────────────────────────────────────────────────────────────

function ZoomToggle({ zoom, onChange }: { zoom: Zoom; onChange: (z: Zoom) => void }) {
    const opts: Zoom[] = ["day", "week", "month", "quarter"]
    return (
        <div className="inline-flex items-center rounded-[10px] border border-[color:var(--c-border)] bg-white p-0.5">
            {opts.map((z) => (
                <button
                    key={z}
                    type="button"
                    onClick={() => onChange(z)}
                    className={cn(
                        "rounded-[8px] px-2.5 py-1 text-[12px] font-semibold",
                        zoom === z
                            ? "bg-zinc-900 text-white"
                            : "text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-overlay)]",
                    )}
                >
                    {ZOOM_LABEL[z]}
                </button>
            ))}
        </div>
    )
}

function StatusLegend({
    projectId,
    overrides,
    onSavedRefresh,
}: {
    projectId: string
    overrides: Partial<Record<IssueStatus, string>>
    onSavedRefresh: () => void
}) {
    const statuses: { key: IssueStatus; label: string }[] = [
        { key: "open",        label: "Open" },
        { key: "in_progress", label: "In progress" },
        { key: "blocked",     label: "Blocked" },
        { key: "done",        label: "Done" },
        { key: "archived",    label: "Archived" },
    ]
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {statuses.map(({ key, label }) => (
                <StatusSwatch
                    key={key}
                    projectId={projectId}
                    status={key}
                    label={label}
                    color={overrides[key] ?? DEFAULT_STATUS_COLORS[key]}
                    onSaved={onSavedRefresh}
                />
            ))}
        </div>
    )
}

function StatusSwatch({
    projectId,
    status,
    label,
    color,
    onSaved,
}: {
    projectId: string
    status: IssueStatus
    label: string
    color: string
    onSaved: () => void
}) {
    const [draft, setDraft] = useState(color)
    const [seenColor, setSeenColor] = useState(color)
    if (color !== seenColor) {
        setSeenColor(color)
        setDraft(color)
    }

    async function save(next: string) {
        if (!/^#[0-9a-fA-F]{6}$/.test(next)) return
        setDraft(next)
        const res = await fetch(`/api/projects/${projectId}/status-colors`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status, color: next }),
        })
        if (res.ok) onSaved()
    }

    return (
        <label className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--c-border)] bg-white px-2 py-1 text-[11px] font-semibold cursor-pointer">
            <span className="relative inline-block h-3.5 w-3.5 rounded-sm" style={{ background: draft }}>
                <input
                    type="color"
                    value={draft}
                    onChange={(e) => save(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    aria-label={`Colour for ${label}`}
                />
            </span>
            {label}
        </label>
    )
}

function NowLine({ originMs, nowMs }: { originMs: number; nowMs: number }) {
    // Position is calc()'d from the canvas's --pxh CSS variable so
    // the line tracks live wheel zoom without re-rendering. Dashed
    // pattern via a vertical repeating background gradient — gives
    // the line a clearer "this is a marker, not a tile" read than a
    // solid 1px stripe.
    const nowHr = (nowMs - originMs) / HOUR_MS
    return (
        <div
            className="pointer-events-none absolute top-0 bottom-0 z-20"
            style={{
                ["--now-hr" as string]: nowHr,
                left: "calc(var(--pxh) * var(--now-hr) * 1px)",
                width: 2,
                marginLeft: -1,
                backgroundImage: "linear-gradient(to bottom, #ef4444 0 6px, transparent 6px 10px)",
                backgroundSize: "100% 10px",
                backgroundRepeat: "repeat-y",
            } as React.CSSProperties}
        >
            <span className="absolute left-1.5 top-1 whitespace-nowrap rounded bg-rose-500 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white shadow-sm">
                Now
            </span>
        </div>
    )
}

// Static formatters declared at module scope so server and client
// render identical text. Without an explicit locale the runtime
// default is used, which differs between Node (often en-US) and
// the browser (whatever the user's system reports), and that
// caused hydration mismatches like "Sep 1" vs "1 Sep".
const MONTH_DAY_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })
const DAY_FMT = new Intl.DateTimeFormat("en-US", { day: "numeric" })
// Tile start/end labels include time of day. Pinned to en-US +
// 24h for hydration determinism and compact width.
const DATETIME_FMT = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
})

function DayLabels({ originMs, totalMs, pxPerHour }: { originMs: number; totalMs: number; pxPerHour: number }) {
    // Label step density needs to know the *committed* zoom — we
    // can't compute it in pure CSS without breaking when labels
    // would otherwise overlap. The committed value catches up to
    // live zoom on a 120ms debounce, so density updates promptly
    // once the user pauses. Each label's left position uses calc()
    // against --pxh so positions track live zoom in the meantime.
    const dayWidthPx = pxPerDay(pxPerHour)
    const stepDays = Math.max(1, Math.ceil(50 / dayWidthPx))
    const days = Math.ceil(totalMs / DAY_MS)
    const labels = []
    for (let d = 0; d < days; d += stepDays) {
        const t = originMs + d * DAY_MS
        const date = new Date(t)
        const isMonthStart = date.getUTCDate() <= stepDays
        labels.push(
            <div
                key={d}
                className="absolute top-0 select-none text-[10px] font-medium text-[color:var(--c-text-dim)]"
                style={{
                    ["--day-idx" as string]: d,
                    left: "calc(var(--pxh) * 24 * var(--day-idx) * 1px + 4px)",
                } as React.CSSProperties}
            >
                {isMonthStart ? MONTH_DAY_FMT.format(date) : DAY_FMT.format(date)}
            </div>,
        )
    }
    return <>{labels}</>
}

// ─── helpers ──────────────────────────────────────────────────────────────

function ringShadow(rings: number, fill: string): string {
    const layers: string[] = []
    let pad = 0
    for (let r = 0; r < rings; r++) {
        layers.push(`0 0 0 ${pad + 1.5}px #ffffff`)
        layers.push(`0 0 0 ${pad + 3}px ${fill}`)
        pad += 3
    }
    layers.push("0 1px 2px rgba(0,0,0,0.08)")
    return layers.join(", ")
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)) }
function roundTo(n: number, step: number): number { return Math.round(n / step) * step }

// Overlay any pending outbox patches on top of a freshly-loaded
// issues array, so the user's local edits stay visible across
// refreshes and route changes until the patches are flushed to
// the server.
function overlayOutbox(issues: Issue[], outbox: ScheduleOutbox | null): Issue[] {
    if (!outbox || outbox.size() === 0) return issues
    return issues.map((i) => {
        const entry = outbox.peek(i.id)
        return entry ? { ...i, ...entry.patch } : i
    })
}
