"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { motion, type PanInfo, useDragControls, useMotionValue } from "framer-motion"
import { cn } from "@/components/ui/cn"
import { IconlyIcon } from "@/components/icons/iconly-icon"
import { useScheduleSync } from "@/lib/timeline/use-schedule-sync"
import { pastelFor as pastelById } from "@/lib/timeline/palette"
import {
    CELL,
    MIN_DURATION_DAYS,
    addDays,
    boardCols,
    boardOrigin,
    cellToSchedule,
    issueToCell,
} from "@/lib/timeline/grid"
import type {
    Issue,
    IssueStatus,
    ProjectLabelIcon,
    ProjectStatusColor,
} from "@/lib/supabase/types"

// The playful board stores lanes as ABSOLUTE integer rows straight in
// `lane_y`, so it's infinite vertically (a tile can go above row 0 or far
// below) — mirroring the unbounded, absolute time columns. This differs from
// the shared normalized [0,1] model in grid.ts, so these wrappers reuse
// grid.ts only for the column/date math and swap in absolute-lane handling.
// (Safe: this component + its mock preview are self-contained.)
function cellOf(issue: Issue, originMs: number): { col: number; row: number; days: number } | null {
    const c = issueToCell(issue, originMs, 2) // rows arg only affects lane, which we override
    if (!c) return null
    return { col: c.col, days: c.days, row: Math.round(issue.lane_y ?? 0) }
}
function scheduleOf(col: number, row: number, days: number, originMs: number) {
    const s = cellToSchedule(col, row, days, originMs, 2)
    return { starts_at: s.starts_at, ends_at: s.ends_at, lane_y: row }
}

// TimelineGridPlayful — a softer, "sticker board" reimagining of the
// planning canvas. Same snap-to-cell mechanics (drag / resize / push
// collision / tray) but restyled to the design system's warm, rounded
// language: pastel colour-chip cards on dotted paper, Nunito, soft pop
// shadows. Duplicated from timeline-grid.tsx so the original is untouched.
export function TimelineGridPlayful({
    projectId,
    issues,
    labelIcons,
    statusColors,
    onTileClick,
    focusIssueId = null,
    onPersisted,
    initialTileRows,
    persist = true,
    edgeAutoPan = true,
    lockCamera = false,
    demoRef,
}: {
    projectId: string
    issues: Issue[]
    labelIcons: ProjectLabelIcon[]
    statusColors: ProjectStatusColor[]
    onTileClick?: (issue: Issue) => void
    focusIssueId?: string | null
    /** Called after schedule edits flush to the server so the owner
     *  can revalidate its fetched data (useApi refetch). */
    onPersisted?: () => void
    /** Seed tile heights (issue id → lane count, 1..MAX_TILE_ROWS).
     *  Height is view-local (there's no schedule field for it yet), so
     *  this lets a caller open the board with some tiles pre-expanded. */
    initialTileRows?: Record<string, number>
    /** Set false to run the board with no backend — drags stay local. */
    persist?: boolean
    /** Auto-pan the camera when a drag nears a viewport edge. Sized for a
     *  full-screen board (56px bands); in a short embedded frame those bands
     *  cover most of the surface, so nearly any grab pans forever — pass false
     *  there. */
    edgeAutoPan?: boolean
    /** Pin the camera where it starts: no wheel pan, no pinch/⌘ zoom, no
     *  grab-drag on the canvas, no zoom controls. Dragging a TILE to an edge
     *  still auto-pans (that's `edgeAutoPan`) — the lock is about the reader
     *  moving the view, not the plan. Embedded in a scrolling page the wheel
     *  is also left alone, so the page scrolls over the board as it should. */
    lockCamera?: boolean
    /** Cell-space control for the landing's scripted demo. Populated on mount,
     *  inert if omitted — the board's own gestures never touch it. */
    demoRef?: React.RefObject<BoardDemoHandle | null>
}) {
    const { local, commitSchedule } = useScheduleSync(projectId, issues, onPersisted, persist)

    // Wall clock, mounted post-hydration so SSR and first client
    // paint agree (see issue-timeline for the same pattern).
    const [nowMs, setNowMs] = useState(0)
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setNowMs(Date.now())
        const t = setInterval(() => setNowMs(Date.now()), 60_000)
        return () => clearInterval(t)
    }, [])
    const mounted = nowMs > 0

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

    // Pre-mount nowMs is 0 (SSR-stable); the board body only renders
    // once mounted, so these stay pure and never see the epoch value.
    const originMs = useMemo(() => boardOrigin(local, nowMs), [local, nowMs])
    const cols = useMemo(() => boardCols(local, originMs, nowMs), [local, originMs, nowMs])

    const scheduled = local.filter((i) => i.starts_at && i.ends_at && i.lane_y != null)
    const unscheduled = local.filter((i) => !i.starts_at || !i.ends_at || i.lane_y == null)

    // Which of "today" is on the board (for column highlight).
    const todayCol = mounted ? Math.round((localMidnightOf(nowMs) - originMs) / DAY) : -1

    const viewportRef = useRef<HTMLDivElement>(null)  // fixed frame
    const worldRef = useRef<HTMLDivElement>(null)     // panned world (grid + tiles)
    const bgRef = useRef<HTMLDivElement>(null)         // static viewport wash
    const headerBoxRef = useRef<HTMLDivElement>(null) // pinned header strip
    const headerRef = useRef<HTMLDivElement>(null)    // header inner (h-scrolls)

    // Figma-style camera. Zoom scales the effective cell size rather
    // than CSS-scaling the world, so framer's drag stays 1:1 in screen
    // px. Pan is a translate pushed straight to the DOM (applyCam) so
    // panning doesn't thrash React; the pieces that physically resize
    // (tile cell, grid lines, header columns) read `zoom` and re-render.
    const [zoom, setZoom] = useState(1)
    const zoomRef = useRef(1)
    useEffect(() => { zoomRef.current = zoom }, [zoom])
    const cell = cellFor(zoom)
    // The wheel listener is bound once, so it reads the lock through a ref.
    const lockRef = useRef(lockCamera)
    useEffect(() => { lockRef.current = lockCamera }, [lockCamera])

    const panRef = useRef({ x: 0, y: 0 })
    const vpSizeRef = useRef({ w: 0, h: 0 })

    // Which cell range the grid lines currently cover. Virtualized so
    // the grid always fills the viewport (in every direction) without
    // rendering an unbounded number of lines — recomputed only when the
    // camera scrolls past the rendered margin, so panning stays cheap.
    const [gridWin, setGridWin] = useState({ c0: 0, c1: 0, r0: 0, r1: 0 })

    // Upper bound for a *resize* (duration/pad) drag: the board ends just
    // past the last tile (`cols`), but the grid scrolls infinitely, so let a
    // resize reach out to the scrolled window too. Moves/drops aren't clamped
    // at all (see endInteract) — origin/cols re-derive and the camera anchors.
    const maxCol = Math.max(cols, gridWin.c1 + 1)

    // Header tiers, virtualized to the visible column window so the date
    // header is infinite like the grid. Each group spans its consecutive
    // columns; the week / day containing today is highlighted.
    const monthGroups = useMemo(
        () => groupColumns(gridWin.c0, gridWin.c1, originMs, (ms) => {
            const d = new Date(ms)
            return d.getFullYear() * 12 + d.getMonth()
        }),
        [gridWin.c0, gridWin.c1, originMs],
    )
    const weekGroups = useMemo(
        () => groupColumns(gridWin.c0, gridWin.c1, originMs, (ms) => weekStartMs(ms)),
        [gridWin.c0, gridWin.c1, originMs],
    )

    // Expand the rendered grid window if the visible area has moved
    // outside it. setState bails out (returns prev) when still covered,
    // so this is a no-op on the vast majority of frames.
    function syncGrid() {
        const { w, h } = vpSizeRef.current
        if (w === 0) return
        const cz = cellFor(zoomRef.current)
        const { x, y } = panRef.current
        const visC0 = Math.floor(-x / cz), visC1 = Math.ceil((w - x) / cz)
        const visR0 = Math.floor(-y / cz), visR1 = Math.ceil((h - y) / cz)
        setGridWin((prev) => {
            if (prev.c0 <= visC0 && prev.c1 >= visC1 && prev.r0 <= visR0 && prev.r1 >= visR1) return prev
            return { c0: visC0 - GRID_MARGIN, c1: visC1 + GRID_MARGIN, r0: visR0 - GRID_MARGIN, r1: visR1 + GRID_MARGIN }
        })
    }

    // Push the camera to the DOM: the world (grid + today band + tiles)
    // translates as one, and the pinned header follows horizontally.
    // Everything inside the world is positioned at col*cell / row*cell,
    // so a single translate keeps all of it aligned in every browser.
    function applyCam() {
        const { x, y } = panRef.current
        if (worldRef.current) worldRef.current.style.transform = `translate(${x}px, ${y}px)`
        if (headerRef.current) headerRef.current.style.transform = `translateX(${x}px)`
        syncGrid()
    }
    // Re-assert after every render (e.g. a zoom step changes cell).
    useLayoutEffect(() => { applyCam() })

    // Anchor the view when the board's origin shifts. `originMs` is derived
    // from the earliest task, so dropping a tile earlier than the current
    // earliest recomputes it — which would reflow every column and make the
    // whole timeline jump horizontally. Pan the camera by the same day-delta
    // so nothing visually moves.
    const prevOriginRef = useRef(originMs)
    useLayoutEffect(() => {
        const prev = prevOriginRef.current
        if (prev !== originMs) {
            const dDays = Math.round((originMs - prev) / DAY)
            if (dDays !== 0) {
                const cz = cellFor(zoomRef.current)
                panRef.current = { x: panRef.current.x + dDays * cz, y: panRef.current.y }
                applyCam()
            }
            prevOriginRef.current = originMs
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [originMs])

    // --- Smooth, cursor-anchored zoom -------------------------------
    // A rAF loop eases the live zoom toward a target. The pivot is
    // captured once as the *grid point* (lx, ly, in cell units) under
    // the cursor; every frame re-anchors that point to the same screen
    // spot, so it zooms straight into the cursor with no drift.
    const zoomTargetRef = useRef(1)
    const pivotRef = useRef({ lx: 0, ly: 0, cx: 0, cy: 0 })
    const rafRef = useRef<number | null>(null)
    function stepZoom() {
        const cur = zoomRef.current
        const tgt = zoomTargetRef.current
        const next = Math.abs(tgt - cur) < 0.001 ? tgt : cur + (tgt - cur) * 0.22
        const cz = cellFor(next)
        const p = pivotRef.current
        panRef.current = { x: p.cx - p.lx * cz, y: p.cy - p.ly * cz }
        zoomRef.current = next
        // Re-layout every frame for continuous motion. We do NOT touch
        // the DOM here — the post-commit useLayoutEffect(applyCam)
        // updates the backdrop, pan and header in the SAME frame as the
        // resized tiles, so no layer tears ahead of another.
        setZoom(next)
        rafRef.current = next === tgt ? null : requestAnimationFrame(stepZoom)
    }
    function zoomTo(nextRaw: number, cx: number, cy: number) {
        zoomTargetRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nextRaw))
        const cz = cellFor(zoomRef.current)
        pivotRef.current = {
            lx: (cx - panRef.current.x) / cz,
            ly: (cy - panRef.current.y) / cz,
            cx,
            cy,
        }
        if (rafRef.current == null) rafRef.current = requestAnimationFrame(stepZoom)
    }
    useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }, [])
    function zoomByButton(factor: number) {
        const vp = viewportRef.current
        if (!vp) return
        zoomTo(zoomTargetRef.current * factor, vp.clientWidth / 2, vp.clientHeight / 2)
    }

    // Screen point -> grid cell, accounting for pan + zoom.
    function screenToCell(clientX: number, clientY: number): { col: number; row: number } | null {
        const vp = viewportRef.current
        if (!vp) return null
        const r = vp.getBoundingClientRect()
        const cz = cellFor(zoomRef.current)
        return {
            col: Math.floor((clientX - r.left - panRef.current.x) / cz),
            row: Math.floor((clientY - r.top - panRef.current.y) / cz),
        }
    }
    // Pan the camera by a raw pixel delta (used by drag edge-auto-scroll).
    function panBy(dx: number, dy: number) {
        panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy }
        applyCam()
    }
    // How fast to auto-pan given the cursor's nearness to a viewport edge —
    // zero unless within EDGE px of a side, ramping up to MAX at the very
    // edge. Sign moves the camera so the cursor's edge reveals more board.
    function edgeDelta(clientX: number, clientY: number): { dx: number; dy: number } {
        const vp = viewportRef.current?.getBoundingClientRect()
        if (!vp || !edgeAutoPan) return { dx: 0, dy: 0 }
        const EDGE = 56, MAX = 18
        const ramp = (over: number) => MAX * Math.min(1, over / EDGE)
        let dx = 0, dy = 0
        if (clientX < vp.left + EDGE) dx = ramp(vp.left + EDGE - clientX)
        else if (clientX > vp.right - EDGE) dx = -ramp(clientX - (vp.right - EDGE))
        if (clientY < vp.top + EDGE) dy = ramp(vp.top + EDGE - clientY)
        else if (clientY > vp.bottom - EDGE) dy = -ramp(clientY - (vp.bottom - EDGE))
        return { dx, dy }
    }

    // Keep the cached viewport size fresh and re-fill the grid window when the
    // frame resizes. Lanes are absolute integers, so there's no viewport-based
    // lane count to track.
    useEffect(() => {
        const el = viewportRef.current
        if (!el) return
        const ro = new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect
            if (!rect) return
            vpSizeRef.current = { w: rect.width, h: rect.height }
            syncGrid()
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [mounted])

    // "Armed" tray brick — click-to-place flow (see onViewportPointerUp).
    const [armed, setArmed] = useState<string | null>(null)
    // The drag / resize gesture in flight. Neighbours are pushed clear of
    // it live (see `displace`) so tiles can never end up overlapping.
    const [active, setActive] = useState<Active | null>(null)
    // True only while the demo handle is driving the gesture in cell space —
    // then the parent owns the tile's cell, because there is no drag transform
    // moving it. Always false for a real drag. See `demoRef`.
    const [demoDriven, setDemoDriven] = useState(false)
    // Per-tile lane height (1..MAX_TILE_ROWS), keyed by issue id. Kept in
    // view state rather than the schedule because there's no persisted
    // field for it — a taller tile just reveals more of its issue.
    const [tileRows, setTileRows] = useState<Record<string, number>>(() => ({ ...initialTileRows }))
    function setTileRowSpan(id: string, r: number) {
        setTileRows((prev) => (prev[id] === r ? prev : { ...prev, [id]: r }))
    }
    const tileSpan = (id: string) => Math.max(1, Math.min(MAX_TILE_ROWS, tileRows[id] ?? 1))

    // Per-tile reserved WIDTH override (total visual columns). Unset = the
    // readable minimum; the user can grab a tile's right end and pull to
    // reserve more room for its label. View-local, like the height.
    const [tilePad, setTilePad] = useState<Record<string, number>>({})
    // Visual columns a tile occupies: its duration or the readable minimum,
    // widened to the user's reserved width when set.
    const tileVCols = (id: string, days: number) => Math.max(tileCols(days), tilePad[id] ?? 0)

    // Footprint (column span × lane span) of every scheduled tile — the
    // input to collision resolution, shared by placement, drag and resize.
    const cells = new Map<string, Footprint>()
    for (const i of scheduled) {
        const c = cellOf(i, originMs)
        if (c) cells.set(i.id, { col: c.col, row: c.row, days: c.days, span: tileSpan(i.id), vcols: tileVCols(i.id, c.days) })
    }
    // Live push: while a tile is dragged / resized, where its displaced
    // neighbours should sit. Empty when nothing is in flight.
    const displace = active ? pushNeighbours(cells, active) : EMPTY_DISPLACE

    const [grabbing, setGrabbing] = useState(false)
    // Snapped target cell shown while dragging a tray brick onto the board.
    const [dropPreview, setDropPreview] = useState<{ col: number; row: number } | null>(null)
    // The tray brick currently being dragged + the cursor position, so a
    // cursor-following ghost can be drawn at the viewport level.
    const [trayDrag, setTrayDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number } | null>(null)
    // Placement animation: a plain overlay tile that morphs from the drop
    // rect to the slot rect (position + width). Kept OUT of the brick /
    // framer (which overrides width) so a plain CSS transition works. Only
    // set on a USER placement, so it never replays on load / refresh.
    const [placeAnim, setPlaceAnim] = useState<null | {
        fromL: number; fromT: number; fromW: number; fromH: number
        toL: number; toT: number; toW: number; toH: number
        bg: string; fg: string; iconName: string | null; title: string; go: boolean
    }>(null)
    function disarm() { setArmed(null); setDropPreview(null) }

    function trayHoverPreview(x: number, y: number) {
        const over = document.elementFromPoint(x, y)
        if (over && over.closest("[data-ui]")) setDropPreview(null)
        else setDropPreview(screenToCell(x, y))
    }
    function onTrayDragStart(id: string, x: number, y: number, dx: number, dy: number) {
        setTrayDrag({ id, x, y, dx, dy })
        trayHoverPreview(x, y)
    }
    function onTrayDragMove(x: number, y: number) {
        setTrayDrag((d) => (d ? { ...d, x, y } : d))
        trayHoverPreview(x, y)
    }
    function onTrayDragEnd(id: string, x: number, y: number) {
        // Grab the ghost's on-screen rect before it's removed, so the
        // placement overlay can animate from exactly where it was dropped.
        const ghostEl = document.querySelector("[data-drag-ghost]")
        const ghostRect = ghostEl ? ghostEl.getBoundingClientRect() : null
        setTrayDrag(null)
        setDropPreview(null)
        const over = document.elementFromPoint(x, y)
        if (over && over.closest("[data-ui]")) return // dropped back on the tray
        placeByUser(id, x, y, ghostRect)
    }

    function placeAt(issueId: string, col: number, row: number, days = 1) {
        const span = tileSpan(issueId)
        const vcols = tileVCols(issueId, days)
        // No clamps — the cell is under the cursor (in view); origin/cols
        // re-derive and the camera compensates. (See endInteract.)
        const c = col
        const r = row
        // Shove any tiles this placement lands on out of the way, so a tray
        // drop / click-to-place can never overlap an existing brick.
        const map = new Map(cells)
        map.set(issueId, { col: c, row: r, days, span, vcols })
        const pushed = pushNeighbours(map, { id: issueId, kind: "move", col: c, row: r, days, span, vcols })
        commitSchedule(issueId, scheduleOf(c, r, days, originMs))
        for (const [bid, nextRow] of pushed) commitSchedule(bid, { lane_y: nextRow })
        return { c, r }
    }

    // Place from a user gesture (tray drop / armed click) and kick off the
    // overlay animation from the drop rect into the slot rect.
    function placeByUser(issueId: string, clientX: number, clientY: number, ghostRect: DOMRect | null = null) {
        const cp = screenToCell(clientX, clientY)
        if (!cp) return
        const c = cp.col
        const r = cp.row
        const vp = viewportRef.current?.getBoundingClientRect()
        const issue = local.find((i) => i.id === issueId)
        if (vp && issue) {
            const cz = cellFor(zoomRef.current)
            const p = pastelById(issue.id)
            const iconName = issue.labels[0] ? labelIconMap.get(issue.labels[0])?.icon_name ?? null : null
            const from = ghostRect ?? { left: clientX - Math.min(80, cz), top: clientY - cz / 2, width: Math.max(130, cz + 96), height: cz }
            setPlaceAnim({
                fromL: from.left, fromT: from.top, fromW: from.width, fromH: from.height,
                toL: vp.left + panRef.current.x + c * cz,
                toT: vp.top + panRef.current.y + r * cz,
                toW: cz, toH: cz, bg: p.bg, fg: p.fg, iconName, title: issue.title, go: false,
            })
        }
        placeAt(issueId, cp.col, cp.row, 1)
    }
    // Drive the placement overlay: flip to the slot rect a frame after it
    // mounts (so CSS animates), then clear it. In an effect so the toggle
    // is reliable (handler-scheduled timers get throttled here).
    useEffect(() => {
        if (!placeAnim) return
        if (!placeAnim.go) {
            const t = setTimeout(() => setPlaceAnim((p) => (p ? { ...p, go: true } : p)), 20)
            return () => clearTimeout(t)
        }
        const t = setTimeout(() => setPlaceAnim(null), 420)
        return () => clearTimeout(t)
    }, [placeAnim])

    // Initial camera: "today" (or focused issue) ~30% from the left,
    // just below the pinned header. Once, after mount.
    const inittedRef = useRef(false)
    useLayoutEffect(() => {
        if (!mounted || inittedRef.current) return
        const vp = viewportRef.current
        if (!vp) return
        // Seed the viewport size here (a layout effect runs after layout,
        // so the rect is real) rather than relying on the ResizeObserver's
        // first fire, which can race and report 0 — leaving the grid empty.
        const rect = vp.getBoundingClientRect()
        vpSizeRef.current = { w: rect.width, h: rect.height }
        let targetCol = todayCol >= 0 ? todayCol : 0
        if (focusIssueId) {
            const f = scheduled.find((i) => i.id === focusIssueId)
            const c = f ? cellOf(f, originMs) : null
            if (c) targetCol = c.col
        }
        const headerH = headerBoxRef.current?.offsetHeight ?? 34
        panRef.current = { x: Math.min(0, vp.clientWidth * 0.3 - targetCol * CELL), y: headerH }
        applyCam() // applyCam -> syncGrid now sees the real size and fills
        inittedRef.current = true
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mounted, todayCol, focusIssueId, scheduled, originMs])

    // --- Grab-drag panning on the empty canvas ---
    const panning = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null)
    function onViewportPointerDown(e: React.PointerEvent<HTMLDivElement>) {
        if (e.button !== 0 || lockCamera) return
        const t = e.target as HTMLElement
        // Bricks and floating UI handle their own gestures.
        if (t.closest("[data-brick]") || t.closest("[data-ui]")) return
        panning.current = { sx: e.clientX, sy: e.clientY, px: panRef.current.x, py: panRef.current.y, moved: false }
        viewportRef.current?.setPointerCapture(e.pointerId)
        setGrabbing(true)
    }
    function onViewportPointerMove(e: React.PointerEvent<HTMLDivElement>) {
        const p = panning.current
        if (p) {
            const dx = e.clientX - p.sx, dy = e.clientY - p.sy
            if (!p.moved && Math.hypot(dx, dy) > 3) p.moved = true
            panRef.current = { x: p.px + dx, y: p.py + dy }
            applyCam()
            return
        }
        // While armed, highlight the slot under the cursor so it's clear
        // where a click will place the tile.
        if (armed) {
            const t = e.target as HTMLElement
            if (t.closest("[data-brick]") || t.closest("[data-ui]")) setDropPreview(null)
            else setDropPreview(screenToCell(e.clientX, e.clientY))
        }
    }
    function onViewportPointerUp(e: React.PointerEvent<HTMLDivElement>) {
        panning.current = null
        viewportRef.current?.releasePointerCapture?.(e.pointerId)
        setGrabbing(false)
    }
    // Armed click-to-place. A real onClick only fires when the pointer
    // didn't drag (a pan suppresses it), so this is a reliable "clicked a
    // slot" signal — more robust than inferring it from pointer events.
    function onViewportClick(e: React.MouseEvent<HTMLDivElement>) {
        if (!armed) return
        const t = e.target as HTMLElement
        if (t.closest("[data-brick]") || t.closest("[data-ui]")) return
        placeByUser(armed, e.clientX, e.clientY)
        disarm()
    }

    // --- Wheel: pan by default; ⌘/Ctrl/pinch zooms toward cursor ---
    useEffect(() => {
        const vp = viewportRef.current
        if (!vp) return
        function onWheel(e: WheelEvent) {
            // Locked: don't swallow the wheel either, or the reader gets
            // stuck on the board halfway down a page.
            if (lockRef.current) return
            e.preventDefault()
            if (e.ctrlKey || e.metaKey) {
                const rect = vp!.getBoundingClientRect()
                zoomTo(zoomTargetRef.current * Math.exp(-e.deltaY * 0.0025), e.clientX - rect.left, e.clientY - rect.top)
            } else {
                panRef.current = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY }
                applyCam()
            }
        }
        vp.addEventListener("wheel", onWheel, { passive: false })
        return () => vp.removeEventListener("wheel", onWheel)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mounted])

    // --- Interaction plumbing: a tile reports its live footprint as it is
    // dragged or resized; we mirror it in `active` (driving the neighbour
    // push) and, on release, commit the tile plus every shifted neighbour.
    // Declared above the mount gate so the demo handle can close over them.
    function beginInteract(id: string, kind: Active["kind"], fp: Footprint) {
        setActive({ id, kind, ...fp })
    }
    function updateInteract(id: string, kind: Active["kind"], fp: Footprint) {
        setActive({ id, kind, ...fp })
    }
    function endInteract(id: string, kind: Active["kind"], fp: Footprint) {
        const finalDisplace = pushNeighbours(cells, { id, kind, ...fp })
        // Schedule changes on move / duration; height ("y") and reserved
        // width ("pad") are view-local only.
        if (kind !== "y" && kind !== "pad") {
            // No clamps: the dropped cell comes from the cursor, so it's
            // always within the rendered view. A drop past the current extent
            // (future) grows `boardCols`; a drop before the origin (into the
            // past) shifts `boardOrigin` — and the origin-compensation keeps
            // the view anchored either way. Clamping here is what made far
            // drops snap back to the old edge.
            commitSchedule(id, scheduleOf(fp.col, fp.row, fp.days, originMs))
        }
        setTileRowSpan(id, fp.span)
        // Reserved width: store when wider than the default, else clear it.
        if (fp.vcols != null) {
            const def = tileCols(fp.days)
            setTilePad((prev) => {
                if (fp.vcols! > def) return prev[id] === fp.vcols ? prev : { ...prev, [id]: fp.vcols! }
                if (prev[id] == null) return prev
                const next = { ...prev }; delete next[id]; return next
            })
        }
        for (const [bid, nextRow] of finalDisplace) {
            commitSchedule(bid, { lane_y: nextRow })
        }
        setActive(null)
    }

    // --- Cell-space control, for the landing's scripted demo only ----------
    // Inert unless a caller passes `demoRef`; the board's own gestures are
    // untouched and never go through here.
    //
    // A scripted gesture has no cursor to speak of — it knows the tile and the
    // cell it wants. Expressing that as pointer events means converting cells
    // to client coordinates and having the board convert them back, and that
    // round trip trips over viewport coordinates: while a page is scrolling,
    // the main thread's idea of where the board sits is stale (the compositor
    // owns the scroll), so no rect read is trustworthy and the tile snaps to
    // cells that don't match. Handing the demo the cell directly removes the
    // coordinate system from the path entirely — nothing to be stale about.
    //
    // Everything below the entry point is the shipped mechanism: the same
    // `active` state, so pushNeighbours() runs for real, and the same commit
    // on release.
    useEffect(() => {
        if (!demoRef) return
        demoRef.current = {
            cell,
            footprintOf: (id) => cells.get(id) ?? null,
            localOf: (col, row) => ({
                x: panRef.current.x + col * cell,
                y: panRef.current.y + row * cell,
            }),
            begin(id, kind, fp) {
                setDemoDriven(true)
                beginInteract(id, kind, fp)
            },
            to: (id, kind, fp) => updateInteract(id, kind, fp),
            end(id, kind, fp) {
                endInteract(id, kind, fp)
                setDemoDriven(false)
            },
            reset() {
                setActive(null)
                setDemoDriven(false)
                setPlaceAnim(null)
                setTileRows({ ...initialTileRows })
                setTilePad({})
                // A tray brick the reader armed but never placed, and its
                // hover preview, would otherwise sit there through the replay.
                setArmed(null)
                setDropPreview(null)
                setGrabbing(false)
            },
        }
        return () => {
            if (demoRef) demoRef.current = null
        }
    })

    // Hold render until the wall clock is real so the day columns and
    // "today" highlight are correct on first paint. All hooks above run
    // unconditionally.
    if (!mounted) {
        return <div className="skeleton min-h-0 flex-1 rounded-[16px]" />
    }

    return (
        <div
            ref={viewportRef}
            onPointerDown={onViewportPointerDown}
            onPointerMove={onViewportPointerMove}
            onPointerUp={onViewportPointerUp}
            onClick={onViewportClick}
            // Panning is done purely via the world's transform, so the frame
            // must never natively scroll. `overflow: clip` (not `hidden`)
            // clips the overflowing world WITHOUT establishing a scroll
            // container, so the browser / framer can't scroll it on a
            // drag-release to re-centre the dropped tile. `onScroll` is a
            // belt-and-braces reset for engines that still expose scroll.
            onScroll={(e) => {
                const el = e.currentTarget
                if (el.scrollLeft !== 0 || el.scrollTop !== 0) { el.scrollLeft = 0; el.scrollTop = 0 }
            }}
            style={{ overscrollBehavior: "none" }}
            className={cn(
                "absolute inset-0 select-none overflow-clip",
                // A locked board has nothing to pan, so the canvas shouldn't
                // advertise a grab — and the wheel/touch must reach the page.
                lockCamera ? "cursor-default" : "touch-none",
                armed ? "cursor-copy" : lockCamera ? "" : grabbing ? "cursor-grabbing" : "cursor-grab",
            )}
        >
            {/* Dotted paper — the system's ambient canvas texture. Static so
                it never drifts; the faint panning grid below carries the cell
                structure. */}
            <div
                ref={bgRef}
                className="pointer-events-none absolute inset-0"
                style={{ backgroundColor: "var(--c-shell)", backgroundImage: GRID_BG_IMAGE, backgroundSize: "22px 22px" }}
            />

            {/* World — pans + zooms. Grid lines, the today band and the
                tiles all live here, each positioned at col*cell / row*cell,
                so they share one lattice in every browser (no CSS-tiling
                rounding — the source of the Safari drift). */}
            <div ref={worldRef} className="absolute left-0 top-0" style={{ willChange: "transform" }}>
                {/* Today column band — spans the visible grid height. */}
                {todayCol >= 0 && (
                    <div
                        className="pointer-events-none absolute rounded-[14px] bg-[color:var(--c-primary)]/[0.09]"
                        style={{ left: fin(todayCol * cell), top: fin(gridWin.r0 * cell), width: fin(cell), height: fin((gridWin.r1 - gridWin.r0) * cell) }}
                    />
                )}

                {/* Grid lines (virtualized to the visible window) */}
                <GridLines c0={gridWin.c0} c1={gridWin.c1} r0={gridWin.r0} r1={gridWin.r1} cell={cell} />

                {/* Snapped drop preview while dragging from the tray */}
                {dropPreview && (
                    <div
                        className="pointer-events-none absolute rounded-[13px] border-[2.5px] border-dashed border-[color:var(--c-primary)] bg-[color:var(--c-primary)]/12"
                        style={{ left: fin(dropPreview.col * cell), top: fin(dropPreview.row * cell), width: fin(cell), height: fin(cell) }}
                    />
                )}

                {scheduled.map((issue) => {
                    const isActive = active?.id === issue.id
                    return (
                        <Brick
                            key={issue.id}
                            issue={issue}
                            originMs={originMs}
                            cols={maxCol}
                            cell={cell}
                            colorOverrides={colorOverrides}
                            labelIconMap={labelIconMap}
                            rowSpan={isActive ? active!.span : tileSpan(issue.id)}
                            daysOverride={isActive && active!.kind !== "y" && active!.kind !== "pad" ? active!.days : null}
                            padCols={tilePad[issue.id] ?? 0}
                            visualOverride={isActive && active!.kind === "pad" ? active!.vcols ?? null : null}
                            // A demo-driven gesture has no drag transform
                            // moving the tile, so the parent places it at the
                            // cell the script asked for. Null for every real
                            // drag, which positions itself as it always has.
                            colOverride={isActive && demoDriven ? active!.col : null}
                            rowOverride={
                                isActive && demoDriven
                                    ? active!.row
                                    : displace.get(issue.id) ?? null
                            }
                            lifted={isActive && demoDriven}
                            isActive={isActive}
                            onInteractStart={(kind, fp) => beginInteract(issue.id, kind, fp)}
                            onInteractMove={(kind, fp) => updateInteract(issue.id, kind, fp)}
                            onInteractEnd={(kind, fp) => endInteract(issue.id, kind, fp)}
                            pointToCell={screenToCell}
                            panBy={panBy}
                            edgeDelta={edgeDelta}
                            onClick={() => onTileClick?.(issue)}
                            onUnschedule={() =>
                                commitSchedule(issue.id, { starts_at: null, ends_at: null, lane_y: null })
                            }
                        />
                    )
                })}

                {/* Board-local twin of the floating date pill below. Lives in
                    the world, so it rides with the board and needs no viewport
                    reading at all. Used when the camera is locked — i.e. the
                    board is embedded in a page that can scroll, where the
                    floating one strands itself: it is positioned `fixed` from
                    a viewport rect read at render, and a scroll moves the
                    board without changing `active`. A full-screen board can't
                    scroll, so it keeps the floating pill, which is free to
                    overflow the frame near a bottom edge. */}
                {lockCamera && active && active.kind === "x" && (
                    <div
                        className={cn(DATE_PILL_CLS, "absolute")}
                        style={{
                            left: fin((active.col + active.days) * cell),
                            top: fin((active.row + active.span) * cell + 7),
                            transform: "translateX(-50%)",
                        }}
                    >
                        <DateRange originMs={originMs} col={active.col} days={active.days} />
                    </div>
                )}
            </div>

            {/* Pinned date header — stays at the top; columns scale with
                the cell size and follow the horizontal pan. */}
            <div
                ref={headerBoxRef}
                className="pointer-events-none absolute inset-x-0 top-0 z-20 overflow-hidden border-b border-[color:var(--c-border)] bg-[color:var(--c-surface)]/85 backdrop-blur-sm"
            >
                {/* Columns are absolutely positioned at col*cell (never
                    flex) so they share the exact lattice of the tiles /
                    backdrop — no accumulated rounding drift at any zoom. */}
                <div
                    ref={headerRef}
                    className="relative"
                    style={{ height: HEADER_H, willChange: "transform" }}
                >
                    {/* Month tier */}
                    {monthGroups.map((g) => (
                        <div
                            key={`m${g.firstCol}`}
                            className="absolute top-0 flex items-center border-r border-[color:var(--c-border)] px-2"
                            style={{ left: fin(g.firstCol * cell), width: fin(g.span * cell), height: MONTH_ROW_H }}
                        >
                            <span className="truncate text-[12px] font-bold tracking-[-0.01em] text-[color:var(--c-text)]">
                                {new Date(g.ms).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                            </span>
                        </div>
                    ))}
                    {/* Week tier */}
                    {weekGroups.map((g) => {
                        const current = weekStartMs(g.ms) === weekStartMs(nowMs)
                        return (
                            <div
                                key={`w${g.firstCol}`}
                                className="absolute flex items-center border-r border-[color:var(--c-border)] px-1.5"
                                style={{ left: fin(g.firstCol * cell), width: fin(g.span * cell), top: MONTH_ROW_H, height: WEEK_ROW_H }}
                            >
                                <span
                                    className={cn(
                                        "truncate rounded-full px-2 py-0.5 text-[10px] font-extrabold",
                                        current ? "bg-[color:var(--c-primary)] text-white shadow-[var(--shadow-card)]" : "text-[color:var(--c-text-muted)]",
                                    )}
                                >
                                    Week {isoWeekNumber(g.ms)}
                                </span>
                            </div>
                        )
                    })}
                    {/* Day tier */}
                    {Array.from({ length: Math.max(0, gridWin.c1 - gridWin.c0 + 1) }, (_, i) => {
                        const c = gridWin.c0 + i
                        return (
                            <ColHeader
                                key={c}
                                dateMs={addDays(originMs, c)}
                                isToday={c === todayCol}
                                weekStart={new Date(addDays(originMs, c)).getDay() === 1}
                                left={c * cell}
                                top={MONTH_ROW_H + WEEK_ROW_H}
                                cell={cell}
                            />
                        )
                    })}
                </div>
            </div>

            {/* Zoom controls — nothing to offer on a locked camera. */}
            {!lockCamera && (
                <div
                    data-ui
                    className="pointer-events-auto absolute bottom-5 right-5 z-30 flex items-center gap-0.5 rounded-full bg-[color:var(--c-surface)]/95 p-1 shadow-[var(--shadow-pop)] ring-1 ring-[color:var(--c-border)] backdrop-blur"
                >
                    <ZoomBtn label="−" onClick={() => zoomByButton(1 / 1.2)} />
                    <button
                        type="button"
                        onClick={() => zoomTo(1, (viewportRef.current?.clientWidth ?? 0) / 2, (viewportRef.current?.clientHeight ?? 0) / 2)}
                        className="min-w-[46px] px-1 text-[11px] font-bold tabular-nums text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]"
                        title="Reset zoom"
                    >
                        {Math.round(zoom * 100)}%
                    </button>
                    <ZoomBtn label="+" onClick={() => zoomByButton(1.2)} />
                </div>
            )}

            {/* Armed-to-place hint */}
            {armed && (
                <div
                    data-ui
                    className="pointer-events-auto absolute left-1/2 top-12 z-30 -translate-x-1/2 rounded-full bg-[color:var(--c-primary)] px-3.5 py-1.5 text-[11.5px] font-extrabold text-white shadow-[var(--shadow-pop)]"
                >
                    ✨ Tap a slot to drop it · <button type="button" className="underline underline-offset-2 opacity-90 hover:opacity-100" onClick={disarm}>cancel</button>
                </div>
            )}

            {/* Floating unscheduled tray — overlays the canvas, hidden when empty. */}
            {unscheduled.length > 0 && (
                <FloatingTray
                    items={unscheduled}
                    armed={armed}
                    draggingId={trayDrag?.id ?? null}
                    colorOverrides={colorOverrides}
                    labelIconMap={labelIconMap}
                    onArmToggle={(id) => setArmed((cur) => (cur === id ? null : id))}
                    onTrayDragStart={onTrayDragStart}
                    onTrayDragMove={onTrayDragMove}
                    onTrayDragEnd={onTrayDragEnd}
                />
            )}

            {/* Cursor-following ghost for the tray drag. Fixed to the
                viewport, high z-index, pointer-events-none — so it tracks
                the cursor everywhere and is never clipped by the tray. */}
            {trayDrag && (() => {
                const issue = local.find((i) => i.id === trayDrag.id)
                if (!issue) return null
                const pastel = pastelById(issue.id)
                const iconName = issue.labels[0] ? labelIconMap.get(issue.labels[0])?.icon_name ?? null : null
                return (
                    <div
                        data-drag-ghost
                        className="pointer-events-none fixed z-[60] flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-[11px] font-extrabold shadow-[var(--shadow-pop)]"
                        style={{
                            // Position from the grab point so the ghost follows
                            // from where it was picked up, not its centre.
                            left: trayDrag.x - trayDrag.dx,
                            top: trayDrag.y - trayDrag.dy,
                            transform: "scale(1.08) rotate(-3deg)",
                            transformOrigin: `${trayDrag.dx}px ${trayDrag.dy}px`,
                            background: pastel.bg,
                            color: pastel.fg,
                            boxShadow: `0 0 0 1.5px color-mix(in srgb, ${pastel.fg} 26%, transparent), var(--shadow-pop)`,
                        }}
                    >
                        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full" style={{ background: pastel.fg }}>
                            <IconlyIcon name={iconName} size={11} color="#ffffff" secondColor="#ffffff" />
                        </span>
                        <span className="max-w-[150px] truncate">{issue.title}</span>
                    </div>
                )
            })()}

            {/* Placement animation — a plain overlay tile that shrinks its
                width and glides from the drop point into the slot. Plain div
                (no framer) so the CSS transition is reliable. */}
            {placeAnim && (
                <div
                    className="pointer-events-none fixed z-[55] flex items-center gap-1.5 overflow-hidden rounded-[13px] px-2 text-[11px] font-extrabold shadow-[var(--shadow-pop)]"
                    style={{
                        left: placeAnim.go ? placeAnim.toL : placeAnim.fromL,
                        top: placeAnim.go ? placeAnim.toT : placeAnim.fromT,
                        width: placeAnim.go ? placeAnim.toW : placeAnim.fromW,
                        height: placeAnim.go ? placeAnim.toH : placeAnim.fromH,
                        background: placeAnim.bg,
                        color: placeAnim.fg,
                        boxShadow: `0 0 0 1.5px color-mix(in srgb, ${placeAnim.fg} 24%, transparent), var(--shadow-pop)`,
                        transition:
                            "width 220ms cubic-bezier(0.22,1,0.36,1), height 220ms cubic-bezier(0.22,1,0.36,1), left 300ms 120ms cubic-bezier(0.22,1,0.36,1), top 300ms 120ms cubic-bezier(0.22,1,0.36,1)",
                    }}
                >
                    <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full" style={{ background: placeAnim.fg }}>
                        <IconlyIcon name={placeAnim.iconName} size={11} color="#ffffff" secondColor="#ffffff" />
                    </span>
                    <span className="truncate">{placeAnim.title}</span>
                </div>
            )}

            {/* Live date readout while lengthening a tile — a pill pinned just
                under the tile's right end (the duration grip), high z so it
                floats above everything, updating start → end in realtime.
                Reads the camera refs during render, but re-renders on every
                `active` change (and the camera doesn't move during a resize),
                so the values are current. Superseded by the board-local twin
                above when the camera is locked; see the note there. */}
            {/* eslint-disable-next-line react-hooks/refs */}
            {!lockCamera && active && active.kind === "x" && (() => {
                const cz = cellFor(zoomRef.current)
                const vp = viewportRef.current?.getBoundingClientRect()
                if (!vp) return null
                const gripX = vp.left + panRef.current.x + (active.col + active.days) * cz
                const botY = vp.top + panRef.current.y + (active.row + active.span) * cz
                return (
                    <div
                        className={cn(DATE_PILL_CLS, "fixed")}
                        style={{ left: gripX, top: botY + 7, transform: "translateX(-50%)" }}
                    >
                        <DateRange originMs={originMs} col={active.col} days={active.days} />
                    </div>
                )
            })()}
        </div>
    )
}

// The live start → end readout shown while a tile's duration is being dragged.
// Rendered in one of two places (see both call sites), so the styling and the
// contents live here rather than being written twice.
const DATE_PILL_CLS =
    "pointer-events-none z-[60] flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[color:var(--c-primary)] px-2.5 py-1 text-[11px] font-extrabold text-white shadow-[var(--shadow-pop)]"

function DateRange({ originMs, col, days }: { originMs: number; col: number; days: number }) {
    const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    return (
        <>
            <span>{fmt(addDays(originMs, col))}</span>
            <span className="opacity-60">→</span>
            <span>{fmt(addDays(originMs, col + days - 1))}</span>
            <span className="ml-0.5 rounded-full bg-white/25 px-1.5 py-px text-[10px]">{days}d</span>
        </>
    )
}

function ZoomBtn({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="grid h-7 w-7 place-items-center rounded-full text-[16px] font-bold text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
        >
            {label}
        </button>
    )
}

// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000
const ZOOM_MIN = 0.4
const ZOOM_MAX = 2.5
// A tile can be dragged from 1 lane tall up to this many, revealing
// more of the issue as it grows: 1 = header only, 2 = + description,
// 3 = + image thumbnails.
const MAX_TILE_ROWS = 3

// A brick is never narrower than this. Anything shorter reserves the
// extra columns and overflows its label onto a detached piece. The
// persisted schedule always uses the true duration. Exported so the
// preview packer reserves the same footprint and nothing overlaps.
export const MIN_TILE_COLS = 4

// The columns a brick occupies on the board (collision + layout).
export function tileCols(days: number): number {
    return Math.max(days, MIN_TILE_COLS)
}

// The design system's app palette — soft -bg tints paired with a
// saturated tone. Hashed onto tiles (the same way project tiles are
// coloured) for a warm, colourful sticker-board look.



// Effective (continuous) cell size for a given zoom. Kept fractional so
// zooming animates smoothly — the integer version snapped in whole-pixel
// steps, which staircased near the end of a zoom. Alignment across
// layers is instead guaranteed by positioning tiles, header columns and
// the backdrop all from the same `col * cell` origin (no flexbox /
// accumulated rounding), so they land on the same lattice at any cell.
function cellFor(zoom: number): number {
    return CELL * zoom
}
// Guard a computed style number: before the viewport is measured some
// derived values (e.g. an empty grid window) can momentarily be NaN;
// never let that reach the DOM.
function fin(n: number): number {
    return Number.isFinite(n) ? n : 0
}

// A tile's occupied footprint on the board: a column range [col, col+days)
// crossed with a lane range [row, row+span). Two tiles overlap iff both
// ranges intersect.
// `vcols` is the reserved width (total columns) the tile blocks; when
// absent it falls back to the readable minimum.
interface Footprint { col: number; row: number; days: number; span: number; vcols?: number }
/** Cell-space control surface, used only by the landing's scripted demo. */
export type BoardDemoHandle = {
    /** Effective cell size in px at the current zoom. */
    cell: number
    /** A scheduled tile's footprint in cells, or null if it isn't on the board. */
    footprintOf: (id: string) => Footprint | null
    /**
     * Cell → pixels, in the board VIEWPORT's own coordinate space — which is
     * where the demo draws its cursor. Deliberately not client coordinates:
     * everything here rides with the board, so a page scroll moves the lot
     * together and there is nothing to recompute.
     */
    localOf: (col: number, row: number) => { x: number; y: number }
    begin: (id: string, kind: InteractKind, fp: Footprint) => void
    to: (id: string, kind: InteractKind, fp: Footprint) => void
    end: (id: string, kind: InteractKind, fp: Footprint) => void
    /**
     * Put the board's VIEW-local state back to how it opened: tile heights,
     * reserved widths, any gesture in flight. Schedules (dates and lanes) live
     * in the caller's issues array, so it resets those itself — this covers
     * what the board owns and the caller can't reach.
     */
    reset: () => void
}

// The live drag / resize gesture in flight, so neighbours can be pushed
// clear of the tile the user is moving or growing.
type InteractKind = "move" | "x" | "y" | "xy" | "pad"
interface Active extends Footprint { id: string; kind: InteractKind }

function fpCols(f: Footprint): number {
    return f.vcols ?? tileCols(f.days)
}
function timeOverlap(a: Footprint, b: Footprint): boolean {
    // Compare reserved widths, not raw durations, so two short tiles
    // whose readable minimums would overlap are kept apart.
    return a.col < b.col + fpCols(b) && b.col < a.col + fpCols(a)
}
function laneOverlap(a: Footprint, b: Footprint): boolean {
    return a.row < b.row + b.span && b.row < a.row + a.span
}

// Resolve collisions for the tile the user is manipulating: keep it where
// they put it, and shove every tile it now overlaps DOWN into the next
// free lane, cascading (a pushed tile can push the next). Columns are time
// and never move — only lanes shift. Returns the pushed rows keyed by id
// (the active tile is the anchor and is never in the result). Pure, so it
// drives both the live preview and the on-release commit.
function pushNeighbours(cells: Map<string, Footprint>, active: Active): Map<string, number> {
    const out = new Map<string, number>()
    const work = new Map<string, Footprint>()
    for (const [id, c] of cells) work.set(id, { ...c })
    const anchor = work.get(active.id)
    if (!anchor) return out
    anchor.col = active.col
    anchor.row = active.row
    anchor.days = active.days
    anchor.span = active.span
    // Reserved width drives horizontal overlap (see `timeOverlap`/`fpCols`), so
    // it must track the live footprint too — otherwise growing a tile's
    // duration or padding wouldn't push the neighbours it now covers.
    anchor.vcols = active.vcols
    const queue = [active.id]
    let guard = 0
    while (queue.length && guard++ < 4000) {
        const A = work.get(queue.shift()!)!
        for (const [bid, B] of work) {
            if (bid === active.id || B === A) continue
            if (timeOverlap(A, B) && laneOverlap(A, B)) {
                const nextRow = A.row + A.span
                if (nextRow > B.row) {
                    B.row = nextRow
                    out.set(bid, nextRow)
                    queue.push(bid)
                }
            }
        }
    }
    return out
}

const EMPTY_DISPLACE: Map<string, number> = new Map()
const MONTH_ROW_H = 28
const WEEK_ROW_H = 24
const DAY_ROW_H = 44
const HEADER_H = MONTH_ROW_H + WEEK_ROW_H + DAY_ROW_H
const GRID_MARGIN = 4 // extra cells rendered beyond the viewport each side

function localMidnightOf(ms: number): number {
    const d = new Date(ms)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
}

// Local Monday-00:00 of the week containing ms — the key we group
// day columns by for the week header row.
function weekStartMs(ms: number): number {
    const d = new Date(ms)
    d.setHours(0, 0, 0, 0)
    const dow = (d.getDay() + 6) % 7 // 0 = Monday
    d.setDate(d.getDate() - dow)
    return d.getTime()
}

// Group a run of day columns [c0..c1] by a key derived from each day's
// timestamp (e.g. its month, or its Monday week-start). Returns one
// entry per contiguous run, carrying the first column, its span and the
// first day's ms (for labelling). Used to build the infinite, panning
// month / week header tiers.
function groupColumns(
    c0: number,
    c1: number,
    originMs: number,
    keyFn: (ms: number) => number,
): { firstCol: number; span: number; ms: number }[] {
    const groups: { firstCol: number; span: number; ms: number }[] = []
    let curKey: number | null = null
    for (let c = c0; c <= c1; c++) {
        const ms = addDays(originMs, c)
        const k = keyFn(ms)
        if (k !== curKey) {
            curKey = k
            groups.push({ firstCol: c, span: 0, ms })
        }
        groups[groups.length - 1].span++
    }
    return groups
}

// ISO-8601 week number (weeks start Monday; week 1 holds the first
// Thursday of the year). Gives the "Week N" label.
function isoWeekNumber(ms: number): number {
    const d = new Date(ms)
    const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    const day = u.getUTCDay() || 7
    u.setUTCDate(u.getUTCDate() + 4 - day)
    const yearStart = new Date(Date.UTC(u.getUTCFullYear(), 0, 1))
    return Math.ceil(((u.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

// Static viewport wash — a single faint element-palette gradient (the
// CI vibe) that fills the frame. It never tiles, so it can't drift; the
// crisp grid is drawn separately as line elements (see GridLines).
const GRID_BG_IMAGE =
    "radial-gradient(circle at 1px 1px, rgba(17,24,39,0.05) 1.4px, transparent 0)"

const GRID_LINE = "rgba(17,24,39,0.035)"

// Grid lines as real positioned elements at exact col*cell / row*cell,
// living inside the panned world. Using the same integer-free lattice
// as the tiles and header means they stay aligned in every browser —
// CSS background-tiling rounds differently (notably in Safari) and
// drifts at fractional cell sizes. Only the visible [c0..c1]×[r0..r1]
// window is rendered (see syncGrid) so the grid fills the viewport in
// every direction without an unbounded number of lines.
function GridLines({ c0, c1, r0, r1, cell }: { c0: number; c1: number; r0: number; r1: number; cell: number }) {
    const left = c0 * cell
    const top = r0 * cell
    const width = (c1 - c0) * cell
    const height = (r1 - r0) * cell
    return (
        <div className="pointer-events-none absolute" style={{ left: fin(left), top: fin(top), width: fin(width), height: fin(height) }}>
            {Array.from({ length: Math.max(0, c1 - c0 + 1) }, (_, i) => (
                <div
                    key={`v${c0 + i}`}
                    className="absolute top-0"
                    style={{ left: fin(i * cell), width: 1, height: fin(height), background: GRID_LINE }}
                />
            ))}
            {Array.from({ length: Math.max(0, r1 - r0 + 1) }, (_, i) => (
                <div
                    key={`h${r0 + i}`}
                    className="absolute left-0"
                    style={{ top: fin(i * cell), height: 1, width: fin(width), background: GRID_LINE }}
                />
            ))}
        </div>
    )
}

function ColHeader({ dateMs, isToday, weekStart, left, top, cell }: { dateMs: number; isToday: boolean; weekStart: boolean; left: number; top: number; cell: number }) {
    const d = new Date(dateMs)
    const weekend = d.getDay() === 0 || d.getDay() === 6
    const dayFont = Math.max(9, Math.min(cell * 0.34, 17))
    const dowFont = Math.max(7, Math.min(cell * 0.22, 11))
    return (
        <div
            className={cn(
                "absolute flex flex-col items-center justify-center gap-1 text-center",
                weekStart && "border-l border-l-[color:var(--c-border)]",
                weekend && "bg-[color:var(--c-shell)]/50",
            )}
            style={{ left: fin(left), width: fin(cell), top: fin(top), height: DAY_ROW_H }}
        >
            <div
                className={cn(
                    "font-extrabold uppercase leading-none tracking-wide",
                    isToday ? "text-[color:var(--c-primary)]" : "text-[color:var(--c-text-dim)]",
                )}
                style={{ fontSize: dowFont }}
            >
                {d.toLocaleDateString(undefined, { weekday: "narrow" })}
            </div>
            <div
                className={cn(
                    "grid place-items-center font-extrabold leading-none tabular-nums",
                    isToday
                        ? "rounded-full bg-[color:var(--c-primary)] text-white shadow-[var(--shadow-card)]"
                        : "text-[color:var(--c-text)]",
                )}
                style={{ fontSize: dayFont, width: isToday ? dayFont * 1.7 : undefined, height: isToday ? dayFont * 1.7 : undefined }}
            >
                {d.getDate()}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------

// Hover-revealed resize handle — a small rounded chip in the card's own colour
// that masks the text beneath it (so a centred grip stays legible over the
// title) with a short accent bar inside. Shown on group-hover, or when
// something marks the brick `data-hot` — synthetic pointer events can't
// trigger :hover, so the landing's scripted drag says so explicitly.
function GripChip({
    axis,
    bg,
    ring,
    line,
    cell,
    style,
}: {
    axis: "v" | "h"
    bg: string
    ring: string
    line: string
    cell: number
    style: React.CSSProperties
}) {
    const longSide = Math.max(16, cell * 0.5)
    const shortSide = Math.max(8, cell * 0.18)
    const w = axis === "v" ? shortSide : longSide
    const h = axis === "v" ? longSide : shortSide
    const bar = axis === "v"
        ? { width: 2.5, height: h * 0.6 }
        : { height: 2.5, width: w * 0.6 }
    return (
        <span
            className="absolute flex items-center justify-center rounded-[5px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-data-[hot=true]:opacity-100"
            style={{ width: w, height: h, background: bg, boxShadow: `0 0 0 1px ${ring}`, ...style }}
        >
            <span className="rounded-full" style={{ ...bar, background: line }} />
        </span>
    )
}

function Brick({
    issue,
    originMs,
    cols,
    cell,
    colorOverrides,
    labelIconMap,
    rowSpan,
    daysOverride,
    padCols,
    visualOverride,
    colOverride = null,
    rowOverride,
    lifted = false,
    isActive,
    onInteractStart,
    onInteractMove,
    onInteractEnd,
    pointToCell,
    panBy,
    edgeDelta,
    onClick,
    onUnschedule,
}: {
    issue: Issue
    originMs: number
    cols: number
    cell: number
    colorOverrides: Partial<Record<IssueStatus, string>>
    labelIconMap: Map<string, ProjectLabelIcon>
    rowSpan: number
    /** Live duration while resizing width; null = use the stored span. */
    daysOverride: number | null
    /** Stored reserved-width override (total columns), 0 = the default. */
    padCols: number
    /** Live reserved width while dragging the tile's right end; null = derive. */
    visualOverride: number | null
    /** Lane this tile is pushed to while a neighbour is dragged; null =
     *  sit at its own stored lane. */
    rowOverride: number | null
    /** Column this tile is placed at by a DEMO-driven gesture; null = derive
     *  from the schedule, which is what every real drag does. */
    colOverride?: number | null
    /** Show the picked-up lift without a drag in flight (demo-driven only). */
    lifted?: boolean
    /** This tile is the one being dragged / resized right now. */
    isActive: boolean
    onInteractStart: (kind: InteractKind, fp: Footprint) => void
    onInteractMove: (kind: InteractKind, fp: Footprint) => void
    onInteractEnd: (kind: InteractKind, fp: Footprint) => void
    /** Absolute cursor → board cell (accounts for camera pan/zoom). */
    pointToCell: (clientX: number, clientY: number) => { col: number; row: number } | null
    /** Pan the camera by a raw pixel delta (edge auto-scroll). */
    panBy: (dx: number, dy: number) => void
    /** Auto-pan speed for the cursor's nearness to a viewport edge. */
    edgeDelta: (clientX: number, clientY: number) => { dx: number; dy: number }
    onClick: () => void
    onUnschedule: () => void
}) {
    const slot = cellOf(issue, originMs)
    const days = daysOverride ?? slot?.days ?? 1
    const images = useMemo(() => extractImages(issue.body), [issue.body])
    // Snapped cell last reported during a move drag, so we only push
    // parent state when the tile crosses into a new cell (not per pixel).
    const lastCell = useRef({ col: 0, row: 0 })

    const x = useMotionValue(0)
    const y = useMotionValue(0)
    const dragged = useRef(false)
    // Drag is started manually from the brick BODY only (see below), so
    // grabbing the resize grip resizes instead of moving the tile.
    const dragControls = useDragControls()
    // Move-drag state, positioned from the ABSOLUTE cursor cell (not framer's
    // relative offset) so the camera can auto-pan under the tile and it still
    // lands where the cursor is. `grab` is the cursor's cell minus the tile's
    // top-left at grab time; `dragPt` is the live cursor; `edgeRaf` drives the
    // auto-pan loop; `target` is the last snapped cell (used on drop).
    const grab = useRef({ dc: 0, dr: 0 })
    const dragPt = useRef<{ x: number; y: number } | null>(null)
    const edgeRaf = useRef<number | null>(null)
    const target = useRef({ col: 0, row: 0 })
    useEffect(() => () => { if (edgeRaf.current != null) cancelAnimationFrame(edgeRaf.current) }, [])

    if (!slot) return null

    const pastel = pastelById(issue.id)
    const bg = pastel.bg          // soft card tint
    const fg = pastel.fg          // saturated accent — icon fill + text
    const labelKey = issue.labels[0]
    const iconName = labelKey ? labelIconMap.get(labelKey)?.icon_name ?? null : null

    // Everything scales off the effective cell size so a brick reads
    // the same at any zoom (drag math stays in screen px = cell).
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))
    const inset = clamp(cell * 0.09, 2, 6)
    const radius = clamp(cell * 0.3, 8, 17)
    const studSize = clamp(cell * 0.12, 3, 8)
    const iconBox = clamp(cell * 0.4, 12, 22)
    const iconSize = clamp(cell * 0.24, 8, 13)
    const titleFont = clamp(cell * 0.3, 8, 15)
    const numFont = clamp(cell * 0.24, 7, 12)
    const descFont = clamp(cell * 0.26, 8, 12)
    const imgH = clamp(cell * 0.9, 18, 54)
    const gw = Math.max(8, cell * 0.28)
    // Height of the stud row. The label sits below it on a normal brick but
    // the overlay spans the full tile, so the overlay is offset by this much
    // to keep the title's vertical centre identical across the switch.
    const studBand = studSize + 4
    // Height of a single lane inside the card (the tile body is inset by
    // `inset` top and bottom). The title row is pinned to this height in every
    // tile type so the title always sits at the vertical centre of the first
    // row — identical whether the tile is one row or many, card or split.
    const rowH = cell - inset * 2
    // Content tiers: 2+ lanes reveal the description, 3 lanes also show
    // image thumbnails pulled from the body.
    const isTall = rowSpan >= 2
    const isXL = rowSpan >= 3
    const descText = isTall ? stripImages(issue.body) : ""

    // Width: the real duration, or the readable minimum for a narrow tile.
    // The span past the true duration is a faint, dashed "reserved" piece
    // — not scheduled time — and the label overflows onto it (dark text)
    // so a one/two-day tile stays legible. Wider tiles get no piece.
    // Reserved width: the readable minimum, widened by the user's stored
    // (or live) choice. `vcolsFor` is what a footprint blocks in collision.
    const vcolsFor = (d: number, p: number) => Math.max(tileCols(d), p)
    const visualCols = visualOverride ?? vcolsFor(days, padCols)
    const trueW = days * cell
    const visW = visualCols * cell
    const hasPad = visualCols > days
    const labelOnPad = hasPad
    // Both pieces are light, so no two-tone mask is needed — the accent
    // text reads on the card and on the faint dashed tail alike.
    const faintBg = `color-mix(in srgb, ${fg} 7%, transparent)`
    const dashColor = `color-mix(in srgb, ${fg} 34%, transparent)`
    const cardRing = `color-mix(in srgb, ${fg} 24%, transparent)`
    // Grip cue — a static, slightly stronger accent segment that reads as a
    // highlighted piece of the tile's own edge (no hover reveal).
    const gripColor = `color-mix(in srgb, ${fg} 55%, transparent)`
    // The icon's slot. `padL` is the icon's own left margin; a wider tile
    // then adds `iconGap` so the title sits a comfortable distance away,
    // while a one-cell tile fills the whole cell (title shifts onto the
    // tail). The icon is left-aligned in the slot so its margin is stable.
    const padL = Math.max(5, cell * 0.13)
    const iconGap = Math.max(8, cell * 0.2)
    const iconSlotW = trueW > cell ? padL + iconBox + iconGap : cell
    const titleLeft = iconSlotW
    // On a one-cell tile the title sits inside the reserved box, so inset
    // it (gap + the box's own right padding) to balance against the #num's
    // right margin. Wider tiles ride the brick and need none. Transitioned.
    const titlePad = trueW > cell ? 0 : Math.max(9, cell * 0.2)

    // How many whole description lines actually fit in a tall tile, so it
    // clamps at a line boundary (ellipsis on the brick, clean cut on the
    // overlay) instead of slicing a line in half at the bottom edge.
    const descLineH = descFont * 1.375 // leading-snug
    const descAbove = studBand + iconBox + 6
    const descBelow = (isXL && images.length > 0 ? imgH + 6 : 0) + Math.max(5, cell * 0.16)
    const descLines = Math.max(1, Math.floor((rowSpan * cell - descAbove - descBelow) / descLineH))

    // Snap the tile to the board cell under the cursor (minus the grab
    // offset) and report the move when it crosses into a new cell. Driven by
    // the ABSOLUTE cursor, so an auto-pan of the camera slides the tile along
    // with the board and it still drops under the cursor.
    function moveToCursor() {
        const pt = dragPt.current
        if (!pt) return
        const cur = pointToCell(pt.x, pt.y)
        if (!cur) return
        const col = cur.col - grab.current.dc
        const row = cur.row - grab.current.dr
        x.set((col - slot!.col) * cell)
        y.set((row - slot!.row) * cell)
        target.current = { col, row }
        if (col !== lastCell.current.col || row !== lastCell.current.row) {
            lastCell.current = { col, row }
            onInteractMove("move", { col, row, days: slot!.days, span: rowSpan, vcols: visualCols })
        }
    }
    // Auto-pan while the cursor holds near a viewport edge, re-snapping the
    // tile each frame so it tracks the cursor as the board scrolls under it.
    function edgeStep() {
        const pt = dragPt.current
        if (!pt) { edgeRaf.current = null; return }
        const { dx, dy } = edgeDelta(pt.x, pt.y)
        if (dx !== 0 || dy !== 0) { panBy(dx, dy); moveToCursor() }
        edgeRaf.current = requestAnimationFrame(edgeStep)
    }
    function handleDragStart(_: unknown, info: PanInfo) {
        dragged.current = true
        const cur = pointToCell(info.point.x, info.point.y)
        grab.current = cur ? { dc: cur.col - slot!.col, dr: cur.row - slot!.row } : { dc: 0, dr: 0 }
        dragPt.current = { x: info.point.x, y: info.point.y }
        lastCell.current = { col: slot!.col, row: slot!.row }
        target.current = { col: slot!.col, row: slot!.row }
        onInteractStart("move", { col: slot!.col, row: slot!.row, days: slot!.days, span: rowSpan, vcols: visualCols })
        if (edgeRaf.current == null) edgeRaf.current = requestAnimationFrame(edgeStep)
    }
    function handleDrag(_: unknown, info: PanInfo) {
        dragPt.current = { x: info.point.x, y: info.point.y }
        moveToCursor()
    }
    function handleDragEnd() {
        if (edgeRaf.current != null) { cancelAnimationFrame(edgeRaf.current); edgeRaf.current = null }
        dragPt.current = null
        onInteractEnd("move", { col: target.current.col, row: target.current.row, days: slot!.days, span: rowSpan, vcols: visualCols })
        // commit ran flushSync, so left/top already reflect the new cell —
        // drop the transform without animating.
        x.set(0)
        y.set(0)
    }

    // Resize grips — native pointer events, snap to whole cells. The
    // axis picks which dimensions move: "x" the duration (days, right
    // edge), "y" the height (lanes, bottom edge), "xy" both (corner).
    // stopPropagation keeps the body's move-drag from starting so the
    // tile grows in place; the gesture is tracked on window so it never
    // loses pointerup.
    function startResize(e: React.PointerEvent, axis: "x" | "y" | "xy" | "pad") {
        e.stopPropagation()
        e.preventDefault()
        const startX = e.clientX
        const startY = e.clientY
        const baseDays = slot!.days
        const baseRows = rowSpan
        const baseVis = visualCols
        const col = slot!.col
        const row = slot!.row
        const nextDays = (clientX: number) =>
            Math.max(MIN_DURATION_DAYS, Math.min(baseDays + Math.round((clientX - startX) / cell), cols - col))
        const nextRows = (clientY: number) =>
            Math.max(1, Math.min(MAX_TILE_ROWS, baseRows + Math.round((clientY - startY) / cell)))
        // Grow the reserved width by dragging the tile's right end; never
        // below the readable minimum, never past the board edge.
        const nextPad = (clientX: number) =>
            Math.max(tileCols(baseDays), Math.min(baseVis + Math.round((clientX - startX) / cell), cols - col))
        const fpAt = (ev: PointerEvent): Footprint => {
            const days = axis === "y" || axis === "pad" ? baseDays : nextDays(ev.clientX)
            const span = axis === "x" || axis === "pad" ? baseRows : nextRows(ev.clientY)
            const vcols = axis === "pad" ? nextPad(ev.clientX) : vcolsFor(days, padCols)
            return { col, row, days, span, vcols }
        }
        onInteractStart(axis, { col, row, days: baseDays, span: baseRows, vcols: baseVis })
        function move(ev: PointerEvent) { onInteractMove(axis, fpAt(ev)) }
        function end(ev: PointerEvent) {
            window.removeEventListener("pointermove", move)
            window.removeEventListener("pointerup", end)
            window.removeEventListener("pointercancel", end)
            onInteractEnd(axis, fpAt(ev))
        }
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", end)
        window.addEventListener("pointercancel", end)
    }

    return (
        <motion.div
            data-brick
            data-issue-id={issue.id}
            drag
            dragListener={false}
            dragControls={dragControls}
            dragMomentum={false}
            dragElastic={0}
            dragSnapToOrigin={false}
            whileDrag={{ scale: 1.04, zIndex: 40 }}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            onDoubleClick={(e) => { e.stopPropagation(); onUnschedule() }}
            style={{
                x, y,
                // The lift a real drag gets from whileDrag. A demo-driven
                // gesture never enters framer's drag, so it says so here.
                scale: lifted ? 1.04 : 1,
                position: "absolute",
                left: fin((colOverride ?? slot.col) * cell),
                top: fin((rowOverride ?? slot.row) * cell),
                width: fin(visW),
                height: fin(rowSpan * cell),
                padding: inset,
                // A pushed neighbour glides to its new lane. The active tile
                // is positioned by the framer transform (drag) or grows in
                // place (resize), so it must NOT also transition `top`.
                transition: isActive
                    ? undefined
                    : "top 220ms cubic-bezier(0.22, 1, 0.36, 1), left 220ms cubic-bezier(0.22, 1, 0.36, 1), width 220ms cubic-bezier(0.22, 1, 0.36, 1)",
                zIndex: isActive ? 40 : rowOverride != null ? 30 : undefined,
            }}
            className="touch-none"
            title={`${issue.title} • #${issue.issue_number}`}
        >
            {/* The brick body — stud row + label, with a bottom bevel
                so it reads as a physical LEGO piece. Pointer-down here
                starts the move drag; the resize grip stops propagation so
                grabbing it resizes instead. The mount animation makes a
                newly-placed tile shrink/settle into its slot. */}
            <motion.div
                onPointerDown={(e) => { dragged.current = false; dragControls.start(e) }}
                onClick={() => { if (dragged.current) { dragged.current = false; return } onClick() }}
                className="group relative flex h-full w-full cursor-grab items-stretch gap-[3px] active:cursor-grabbing"
            >
                {/* Card — the real task; a soft pastel sticker with a hairline
                    ring and a gentle drop shadow. Its width IS the duration. */}
                <div
                    className="relative flex shrink-0 flex-col overflow-hidden"
                    style={{
                        width: hasPad ? fin(trueW) : "100%",
                        background: bg,
                        color: fg,
                        borderRadius: radius,
                        boxShadow: `0 0 0 1.5px ${cardRing}, 0 3px 8px -3px ${cardRing}`,
                    }}
                >
                    {labelOnPad ? (
                        // Narrow tile: the icon, two-tone title AND description
                        // are one overlay spanning both pieces (see below), so
                        // the brick itself is just the coloured bar.
                        <div className="min-h-0 flex-1" />
                    ) : (
                        <div className={cn("flex min-h-0 flex-1 flex-col pr-1.5", isTall && "pb-1")}>
                            <div className="flex shrink-0 items-center" style={{ height: fin(rowH) }}>
                                {/* First cell — reserved for the icon, matching
                                    the narrow tiles so every tile lines up. */}
                                <div className={cn("flex shrink-0 items-center", trueW > cell ? "justify-start" : "justify-center")} style={{ width: fin(iconSlotW), paddingLeft: trueW > cell ? padL : 0 }}>
                                    <span className="grid place-items-center rounded-[7px]" style={{ width: iconBox, height: iconBox, background: fg, boxShadow: `0 1px 2px ${cardRing}` }}>
                                        <IconlyIcon name={iconName} size={Math.round(iconSize)} color="#ffffff" secondColor="#ffffff" />
                                    </span>
                                </div>
                                <span className="min-w-0 flex-1 truncate font-extrabold leading-none" style={{ fontSize: titleFont, paddingLeft: titlePad, transition: "padding-left 260ms cubic-bezier(0.22, 1, 0.36, 1)" }}>
                                    {issue.title}
                                </span>
                                <span className="shrink-0 pl-1 pr-2 font-mono font-bold opacity-45" style={{ fontSize: numFont }}>#{issue.issue_number}</span>
                            </div>
                            {isTall && (
                                <p
                                    className="min-w-0 overflow-hidden font-medium leading-snug opacity-80"
                                    style={{ fontSize: descFont, marginTop: 2, marginLeft: fin(titleLeft), paddingLeft: titlePad, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: descLines }}
                                >
                                    {descText || "No description yet."}
                                </p>
                            )}
                            {isXL && images.length > 0 && (
                                <div className="mt-auto flex items-center gap-1 overflow-hidden pt-0.5" style={{ marginLeft: fin(titleLeft), paddingLeft: titlePad }}>
                                    {images.slice(0, 4).map((src, i) => (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img key={i} src={src} alt="" draggable={false} className="shrink-0 rounded-[6px] object-cover" style={{ height: imgH, width: imgH * 1.4, boxShadow: `0 0 0 1.5px ${cardRing}` }} />
                                    ))}
                                    {images.length > 4 && (
                                        <span className="shrink-0 rounded-[5px] px-1 font-bold" style={{ fontSize: numFont, background: faintBg }}>+{images.length - 4}</span>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Reserved piece — a DETACHED, dashed, ghosted extension
                    (note the gap + translucent fill): the tile does NOT
                    really occupy this time, the room is only borrowed so a
                    short tile's label stays readable. On narrow tiles the
                    label renders here, in dark text. */}
                {hasPad && (
                    <div
                        className="relative flex min-w-0 flex-1 overflow-hidden"
                        style={{ borderRadius: radius, border: `1.5px dashed ${dashColor}`, background: faintBg }}
                    />
                )}

                {/* Two-tone label overlay (narrow tiles) — the icon plus ONE
                    real title text run spanning both pieces. A hard-stop
                    gradient painted through background-clip:text is the
                    inverse mask: foreground colour over the brick, dark where
                    it overflows onto the faint detached piece. Pointer-events
                    off so drags / clicks fall through to the body. */}
                {labelOnPad && (
                    <div
                        className="pointer-events-none absolute inset-0 flex flex-col overflow-hidden pr-1.5"
                        style={{
                            color: fg,
                            // A tall tile keeps a bottom pad so text never runs
                            // to the edge; the title row's fixed height (below)
                            // centres the title in the first row for every type.
                            paddingBottom: isTall ? Math.max(5, cell * 0.16) : 0,
                        }}
                    >
                        <div className="flex shrink-0 items-center" style={{ height: fin(rowH) }}>
                            {/* First cell — reserved for the icon only, so the
                                title starts at cell two and shifts fully onto
                                the reserved piece on a one-day tile. */}
                            <div className={cn("flex shrink-0 items-center", trueW > cell ? "justify-start" : "justify-center")} style={{ width: fin(iconSlotW), paddingLeft: trueW > cell ? padL : 0 }}>
                                <span className="grid place-items-center rounded-[7px]" style={{ width: iconBox, height: iconBox, background: fg, boxShadow: `0 1px 2px ${cardRing}` }}>
                                    <IconlyIcon name={iconName} size={Math.round(iconSize)} color="#ffffff" secondColor="#ffffff" />
                                </span>
                            </div>
                            <span
                                className="min-w-0 flex-1 truncate font-extrabold leading-none"
                                style={{ fontSize: titleFont, paddingLeft: titlePad, transition: "padding-left 260ms cubic-bezier(0.22, 1, 0.36, 1)" }}
                            >
                                {issue.title}
                            </span>
                            <span className="shrink-0 pl-1 pr-2 font-mono font-bold opacity-45" style={{ fontSize: numFont }}>#{issue.issue_number}</span>
                        </div>
                        {/* Description flows below the title across both pieces
                            in the same accent — no mask needed since both are
                            light. Clean line clamp with an ellipsis. */}
                        {isTall && (
                            <p
                                className="min-w-0 overflow-hidden font-semibold leading-snug opacity-75"
                                style={{
                                    fontSize: descFont,
                                    marginTop: 2,
                                    marginLeft: fin(titleLeft),
                                    paddingLeft: titlePad,
                                    display: "-webkit-box",
                                    WebkitBoxOrient: "vertical",
                                    WebkitLineClamp: descLines,
                                }}
                            >
                                {descText || "No description yet."}
                            </p>
                        )}
                        {isXL && images.length > 0 && (
                            <div className="mt-auto flex items-center gap-1 overflow-hidden pt-0.5" style={{ marginLeft: fin(titleLeft), paddingLeft: titlePad }}>
                                {images.slice(0, 4).map((src, i) => (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img key={i} src={src} alt="" draggable={false} className="shrink-0 rounded-[6px] object-cover" style={{ height: imgH, width: imgH * 1.4, boxShadow: `0 0 0 1.5px ${cardRing}` }} />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Resize grips — the card's right edge sets the duration, its
                    bottom the height. In pad mode this right edge is the seam
                    (the tile itself), separate from the reserved-width grip on
                    the tail's far end. Anchored to the bottom of the edge so it
                    clears the title that overflows across the seam. */}
                <div
                    onPointerDown={(e) => startResize(e, "x")}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-0 h-full cursor-ew-resize"
                    style={{ ...(hasPad ? { left: fin(trueW - gw) } : { right: 0 }), width: gw, touchAction: "none" }}
                >
                    <GripChip axis="v" bg={bg} ring={cardRing} line={gripColor} cell={cell} style={{ right: 0, top: "50%", transform: "translateY(-50%)" }} />
                </div>
                <div
                    onPointerDown={(e) => startResize(e, "y")}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-0 left-0 cursor-ns-resize"
                    style={{ height: gw, right: gw, touchAction: "none" }}
                >
                    <GripChip axis="h" bg={bg} ring={cardRing} line={gripColor} cell={cell} style={{ bottom: 0, left: "50%", transform: "translateX(-50%)" }} />
                </div>
                {/* Reserved-width grip — the tail's right end. */}
                {hasPad && (
                    <div
                        onPointerDown={(e) => startResize(e, "pad")}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute top-0 h-full cursor-ew-resize"
                        style={{ right: 0, width: gw, touchAction: "none" }}
                    >
                        <GripChip axis="v" bg={bg} ring={cardRing} line={gripColor} cell={cell} style={{ right: 0, top: "50%", transform: "translateY(-50%)" }} />
                    </div>
                )}
            </motion.div>
        </motion.div>
    )
}

// ---------------------------------------------------------------------------

function FloatingTray({
    items,
    armed,
    draggingId,
    colorOverrides,
    labelIconMap,
    onArmToggle,
    onTrayDragStart,
    onTrayDragMove,
    onTrayDragEnd,
}: {
    items: Issue[]
    armed: string | null
    draggingId: string | null
    colorOverrides: Partial<Record<IssueStatus, string>>
    labelIconMap: Map<string, ProjectLabelIcon>
    onArmToggle: (id: string) => void
    onTrayDragStart: (id: string, x: number, y: number, grabDX: number, grabDY: number) => void
    onTrayDragMove: (x: number, y: number) => void
    onTrayDragEnd: (id: string, x: number, y: number) => void
}) {
    // Floats above the board, bottom-centre, sized to its content so
    // the grid keeps the full page. Only the card catches pointer
    // events — clicks elsewhere fall through to the baseplate.
    return (
        <div data-ui className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
            <div className="pointer-events-auto flex max-w-full items-center gap-2.5 rounded-[24px] bg-[color:var(--c-surface)]/95 p-2.5 shadow-[var(--shadow-pop)] ring-1 ring-[color:var(--c-border)] backdrop-blur">
                <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-[color:var(--c-shell)] px-3 py-1.5">
                    <span className="text-[15px] leading-none">🎒</span>
                    <span className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">Backlog · {items.length}</span>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto py-0.5 pr-1">
                    {items.map((issue) => (
                        <TrayBrick
                            key={issue.id}
                            issue={issue}
                            armed={armed === issue.id}
                            dragging={draggingId === issue.id}
                            colorOverrides={colorOverrides}
                            labelIconMap={labelIconMap}
                            onTap={() => onArmToggle(issue.id)}
                            onDragStart={(x, y, dx, dy) => onTrayDragStart(issue.id, x, y, dx, dy)}
                            onDragMove={onTrayDragMove}
                            onDragEnd={(x, y) => onTrayDragEnd(issue.id, x, y)}
                        />
                    ))}
                </div>
            </div>
        </div>
    )
}

function TrayBrick({
    issue,
    armed,
    dragging,
    colorOverrides,
    labelIconMap,
    onTap,
    onDragStart,
    onDragMove,
    onDragEnd,
}: {
    issue: Issue
    armed: boolean
    dragging: boolean
    colorOverrides: Partial<Record<IssueStatus, string>>
    labelIconMap: Map<string, ProjectLabelIcon>
    onTap: () => void
    onDragStart: (x: number, y: number, grabDX: number, grabDY: number) => void
    onDragMove: (x: number, y: number) => void
    onDragEnd: (x: number, y: number) => void
}) {
    // Custom pointer drag (not framer): the visible dragged tile is a
    // separate fixed-position ghost rendered at the viewport level, so
    // it follows the cursor and is never clipped by the tray's overflow
    // — and because this pill never unmounts mid-gesture, dropping (which
    // schedules the issue) doesn't freeze an in-flight drag animation.
    const pastel = pastelById(issue.id)
    const bg = pastel.bg
    const fg = pastel.fg
    const cardRing = `color-mix(in srgb, ${fg} 24%, transparent)`
    const labelKey = issue.labels[0]
    const iconName = labelKey ? labelIconMap.get(labelKey)?.icon_name ?? null : null

    // Track the gesture on `window` for the drag's lifetime, so it works
    // even if pointer capture fails or this pill re-renders/unmounts —
    // pointerup always lands and cleans up (no stuck ghost / freeze).
    function down(e: React.PointerEvent) {
        if (e.button !== 0) return
        e.preventDefault() // don't start a text selection
        // Where inside the pill the user grabbed, so the ghost follows
        // from that point instead of snapping its centre to the cursor.
        const rect = (e.currentTarget as Element).getBoundingClientRect()
        const grabDX = e.clientX - rect.left
        const grabDY = e.clientY - rect.top
        const start = { sx: e.clientX, sy: e.clientY, moved: false }
        function move(ev: PointerEvent) {
            if (!start.moved && Math.hypot(ev.clientX - start.sx, ev.clientY - start.sy) > 4) {
                start.moved = true
                onDragStart(ev.clientX, ev.clientY, grabDX, grabDY)
            }
            if (start.moved) onDragMove(ev.clientX, ev.clientY)
        }
        function end(ev: PointerEvent) {
            window.removeEventListener("pointermove", move)
            window.removeEventListener("pointerup", end)
            window.removeEventListener("pointercancel", end)
            if (start.moved) onDragEnd(ev.clientX, ev.clientY)
            else onTap()
        }
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", end)
        window.addEventListener("pointercancel", end)
    }

    return (
        <div
            onPointerDown={down}
            className={cn(
                "flex shrink-0 cursor-grab touch-none select-none items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-[11px] font-extrabold transition-transform hover:-translate-y-0.5 active:cursor-grabbing",
                armed && "ring-2 ring-[color:var(--c-primary)] ring-offset-2",
                dragging && "opacity-40",
            )}
            style={{ background: bg, color: fg, boxShadow: `0 0 0 1.5px ${cardRing}, var(--shadow-card)` }}
            title={`${issue.title} • #${issue.issue_number}`}
        >
            <span className="grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full" style={{ background: fg }}>
                <IconlyIcon name={iconName} size={10} color="#ffffff" secondColor="#ffffff" />
            </span>
            <span className="max-w-[150px] truncate">{issue.title}</span>
        </div>
    )
}

// ---------------------------------------------------------------------------

// Pull image URLs out of a markdown issue body (`![alt](url)`), so a
// tall tile can surface them as thumbnails. Capped so a body full of
// images can't blow up the render.
function extractImages(md: string): string[] {
    if (!md) return []
    const out: string[] = []
    const re = /!\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(md)) !== null && out.length < 8) out.push(m[1])
    return out
}

// The body with image markdown stripped + whitespace collapsed, for the
// one-glance description snippet under the title.
function stripImages(md: string): string {
    if (!md) return ""
    return md.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\s+/g, " ").trim()
}

