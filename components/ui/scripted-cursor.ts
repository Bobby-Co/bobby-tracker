"use client"

// A scripted pointer, played over the REAL surfaces.
//
// The landing demos used to fake their motion with CSS keyframe loops — a row
// that "opened" because an animation faded a panel in, a board that re-planned
// because `lane_y` swapped and the tile transitioned across. The motion was
// fine; it just never read as a *person* using the thing. No cursor, no press,
// no neighbours scattering out from under a held brick.
//
// So rather than imitate the outcome, this replays the INPUT — but in the
// coordinate system each surface actually thinks in:
//
//  * A CLICK is dispatched as real pointer + mouse events at the element. A
//    click resolves by target, not by position, so nothing here depends on
//    where the page happens to be.
//
//  * A BOARD gesture is driven in CELL space, through the grid's demo handle
//    (see BoardDemoHandle). Not pointer events. Everything downstream is the
//    shipped mechanism — the same `active` state, so pushNeighbours() runs for
//    real, and the same commit on release — but the entry point takes a cell
//    instead of a cursor.
//
// That last part is the whole reason this file works while the page scrolls.
// Driving the board with synthetic pointer events means turning cells into
// client coordinates and having the board turn them back, and that round trip
// cannot be made reliable: scrolling is compositor-driven, so mid-scroll the
// main thread's idea of where the board sits is stale by design and no rect
// read — however synchronous — is trustworthy. The tile lands on cells that
// don't match the cursor, and because the staleness varies frame to frame it
// stutters rather than simply offsetting. Cells have no such problem. There is
// no viewport in the path to be wrong about.
//
// The cursor is positioned in the board's own space too, and driven straight
// onto its DOM node rather than through state: a setState per frame would
// re-render the surface sixty times a second, which is precisely the jank the
// demos are trying to disprove.
//
// Everything runs off one rAF clock and hands over the moment a real pointer
// arrives — a mouse moving across the demo is enough. The script lets go
// mid-gesture if it has to, and the demo is genuinely the reader's.

import { useEffect, useRef } from "react"
import type { BoardDemoHandle } from "@/components/timeline/timeline-grid-playful"

/** Press a thing. `sel` is looked up inside the demo's frame. */
export type ClickStep = {
    act: "click"
    sel: string
    /** Where on the element to aim: its middle, or in from its leading edge. */
    aim?: "center" | "start"
}

/** Carry a board tile to another cell, or stretch it to a new duration. */
export type TileStep = {
    act: "move" | "resize"
    /** Which tile, by issue id. */
    id: string
    /** Where to end up, in whole cells from where the gesture starts. */
    dx: number
    dy?: number
}

export type Step = (ClickStep | TileStep) & {
    /** ms for the cursor to walk over to the target. */
    reach?: number
    /** ms spent carrying / stretching. */
    travel?: number
    /** ms of stillness after release, before the next step. */
    rest?: number
}

const POINTER_ID = 4207 // ours, so a stray real pointer can't be mistaken for it
// Grace before hand-over is live. Resuming is a CLICK, so the reader's pointer
// is already sitting on the surface when the loop starts — without this, the
// first twitch after pressing "replay" would stop it again immediately.
const ARM_MS = 700
/** The resume control: pressing or crossing it must never count as taking over. */
const RESUME_SEL = "[data-demo-resume]"

const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)

/**
 * Plays `steps` on a loop over whatever is inside `rootRef`.
 *
 * Returns the ref to hang on the pretend cursor's element; the hook positions
 * it and flips `data-shown` / `data-down` on it directly. For board steps the
 * cursor must live in the same box the grid's `localOf` measures from — that
 * is, filling the board's viewport.
 *
 * `onCycleEnd` puts the surface back the way it started. It is called at the
 * start of every pass and on teardown, so a pass cut short can never leave the
 * demo half-done. Make it idempotent. `onAbort` fires when a real pointer takes
 * over for good, and deliberately does NOT reset: the reader keeps the surface
 * exactly as they found it.
 */
export function useScriptedCursor({
    rootRef,
    boardRef,
    steps,
    enabled,
    onCycleEnd,
    onAbort,
}: {
    rootRef: React.RefObject<HTMLElement | null>
    /** Required for "move" / "resize" steps; omit for a click-only demo. */
    boardRef?: React.RefObject<BoardDemoHandle | null>
    steps: Step[]
    enabled: boolean
    onCycleEnd?: () => void
    onAbort?: () => void
}) {
    const cursorRef = useRef<HTMLDivElement>(null)
    // Read the callbacks through a ref so re-rendering the caller can't
    // restart the script half-way through a gesture.
    const cbs = useRef({ onCycleEnd, onAbort })
    useEffect(() => {
        cbs.current = { onCycleEnd, onAbort }
    })

    useEffect(() => {
        if (!enabled) return
        const root = rootRef.current
        if (!root) return
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

        let alive = true
        let raf = 0
        let hot: HTMLElement | null = null
        // The cursor's position, in the surface's own coordinate space. Never
        // client coordinates — see the note at the top of the file.
        const at = { x: 0, y: 0 }
        // The board gesture in flight, so an abort can release it.
        let held: { id: string; kind: "move" | "x"; fp: Footprint } | null = null
        // Every in-flight wait/tween, so unwinding resolves them instead of
        // leaving the script's async loop parked forever.
        const pending = new Set<() => void>()
        const timers = new Set<number>()
        // Bumped whenever a pass is invalidated; the pass in flight compares
        // against it after every await and unwinds.
        let gen = 0
        let paused = false
        const wakers = new Set<() => void>()

        function paint(shown?: boolean, down?: boolean) {
            const el = cursorRef.current
            if (!el) return
            el.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`
            if (shown !== undefined) el.dataset.shown = String(shown)
            if (down !== undefined) el.dataset.down = String(down)
        }

        function moveTo(x: number, y: number) {
            at.x = x
            at.y = y
            paint()
        }

        // Hover states are CSS `:hover`, which synthetic events can't trigger
        // — so mark the element the cursor is over and let the styles key off
        // that too.
        function setHot(el: HTMLElement | null) {
            if (hot && hot !== el) delete hot.dataset.hot
            hot = el
            if (el) el.dataset.hot = "true"
        }

        /** Drop everything and unwind the pass in flight. */
        function unwind() {
            gen++
            if (raf) cancelAnimationFrame(raf)
            timers.forEach(clearTimeout)
            timers.clear()
            if (held) {
                // Release rather than cancel: the tile lands on a real cell.
                boardRef?.current?.end(held.id, held.kind, held.fp)
                held = null
            }
            setHot(null)
            paint(false, false)
            pending.forEach((r) => r())
            pending.clear()
        }

        function pause() {
            if (paused || !alive) return
            paused = true
            unwind()
        }

        function resume() {
            if (!paused || !alive) return
            paused = false
            wakers.forEach((w) => w())
            wakers.clear()
        }

        /** Stop for good — the reader has taken over. */
        function handOver() {
            if (!alive) return
            alive = false
            unwind()
            wakers.forEach((w) => w())
            wakers.clear()
            cbs.current.onAbort?.()
        }

        // Hand over on the first sign of a real pointer: a press anywhere, or
        // a mouse actually MOVING across the demo — they're reaching for it.
        // Movement, not mere presence, so the page scrolling past a parked
        // cursor doesn't kill the loop.
        // A deliberate PRESS always takes over (bar the replay control). Mere
        // movement only counts once armed — otherwise, since resuming is a
        // click, the reader's retreat from the button would stop the loop they
        // just restarted. So if the pointer is already on the surface when a
        // pass begins, wait until it has left; if it isn't, a short grace is
        // enough.
        let armed = false
        const arm = () => { armed = true }
        const startedUnderPointer = root.matches(":hover")
        const armTimer = startedUnderPointer ? 0 : window.setTimeout(arm, ARM_MS)
        if (startedUnderPointer) root.addEventListener("pointerleave", arm, { once: true })

        const isResume = (e: Event) =>
            !!(e.target as HTMLElement | null)?.closest?.(RESUME_SEL)

        function onRealDown(e: PointerEvent) {
            if (!e.isTrusted || e.pointerId === POINTER_ID || isResume(e)) return
            handOver()
        }
        let seen: { x: number; y: number } | null = null
        function onRealMove(e: PointerEvent) {
            if (!e.isTrusted || isResume(e) || !armed) return
            if (!seen) {
                seen = { x: e.clientX, y: e.clientY }
                return
            }
            if (Math.hypot(e.clientX - seen.x, e.clientY - seen.y) > 6) handOver()
        }
        // A hidden tab freezes rAF but not setTimeout, which would leave the
        // choreography desynced on return — park the pass and start a clean one.
        function onVisibility() {
            if (document.visibilityState === "hidden") pause()
            else resume()
        }

        window.addEventListener("pointerdown", onRealDown, true)
        root.addEventListener("pointermove", onRealMove)
        document.addEventListener("visibilitychange", onVisibility)

        const wait = (ms: number) =>
            new Promise<void>((resolve) => {
                pending.add(resolve)
                const id = window.setTimeout(() => {
                    timers.delete(id)
                    pending.delete(resolve)
                    resolve()
                }, ms)
                timers.add(id)
            })

        const waitForResume = () =>
            new Promise<void>((resolve) => {
                wakers.add(resolve)
            })

        const tween = (ms: number, onFrame: (t: number) => void) =>
            new Promise<void>((resolve) => {
                pending.add(resolve)
                const done = () => {
                    pending.delete(resolve)
                    resolve()
                }
                const t0 = performance.now()
                const step = () => {
                    if (!alive) return done()
                    const t = Math.min(1, (performance.now() - t0) / ms)
                    onFrame(t)
                    if (t < 1) raf = requestAnimationFrame(step)
                    else done()
                }
                raf = requestAnimationFrame(step)
            })

        /** Walk the cursor over to a point, easing out as it lands. */
        async function walkTo(to: { x: number; y: number }, ms: number, first: boolean) {
            if (first) {
                // Nothing to walk from at the start of a pass, so the cursor
                // fades in short of the target and closes the gap.
                at.x = to.x - 84
                at.y = to.y + 70
                paint(true, false)
                await wait(240)
            }
            const start = { ...at }
            await tween(ms, (t) => {
                const e = easeOut(t)
                moveTo(start.x + (to.x - start.x) * e, start.y + (to.y - start.y) * e)
            })
        }

        /** True once this pass has been invalidated — check after every await. */
        const stale = (g: number) => !alive || g !== gen

        // ---- clicks: real events, resolved by target ----------------------
        async function playClick(s: Step & ClickStep, first: boolean, g: number) {
            const el = root!.querySelector<HTMLElement>(s.sel)
            if (!el) return
            const fr = root!.getBoundingClientRect()
            const r = el.getBoundingClientRect()
            if (r.width === 0) return
            const from = {
                x:
                    s.aim === "start"
                        ? r.left - fr.left + Math.min(r.width * 0.3, 120)
                        : r.left - fr.left + r.width / 2,
                y: r.top - fr.top + r.height / 2,
            }

            setHot(el)
            await walkTo(from, s.reach ?? 520, first)
            if (stale(g)) return
            await wait(170)
            if (stale(g)) return

            // Client coordinates only decorate these — a click lands on the
            // element it's dispatched at, wherever the page happens to be.
            const p = { x: fr.left + from.x, y: fr.top + from.y }
            const opts = { bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y }
            el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: POINTER_ID, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1 }))
            paint(undefined, true)
            await wait(110)
            if (stale(g)) return
            el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: POINTER_ID, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0 }))
            // The browser only synthesises `click` for real input, so say it.
            el.dispatchEvent(new MouseEvent("click", { ...opts, button: 0, detail: 1 }))
            paint(undefined, false)
            await wait(s.rest ?? 900)
            if (stale(g)) return
            setHot(null)
        }

        // ---- board: cell space, through the grid's demo handle -------------
        async function playTile(s: Step & TileStep, first: boolean, g: number) {
            const board = boardRef?.current
            const fp0 = board?.footprintOf(s.id)
            if (!board || !fp0) return
            const cell = board.cell
            const resize = s.act === "resize"
            const kind = resize ? "x" : "move"

            // Where the hand takes hold, in the board's own space: a little in
            // from the tile's leading edge for a carry, on its right end for a
            // stretch. `localOf` accounts for the camera; no viewport anywhere.
            const grab = resize
                ? { dc: fp0.days, dr: 0.5 }
                : { dc: Math.min(fp0.days / 2, 1.7), dr: 0.5 }
            const originPt = board.localOf(fp0.col, fp0.row)
            const from = { x: originPt.x + grab.dc * cell, y: originPt.y + grab.dr * cell }

            // Reveal any hover affordance as the cursor arrives, so a resize
            // reads as "found the edge, took hold of it".
            const brick = root!.querySelector<HTMLElement>(`[data-issue-id="${s.id}"]`)
            setHot((brick?.firstElementChild as HTMLElement | null) ?? null)
            await walkTo(from, s.reach ?? 520, first)
            if (stale(g)) return
            await wait(resize ? 260 : 170) // a beat before taking hold
            if (stale(g)) return

            held = { id: s.id, kind, fp: fp0 }
            board.begin(s.id, kind, fp0)
            paint(undefined, true)
            await wait(130) // the tile lifts, then it moves
            if (stale(g)) return

            const runX = s.dx * cell
            const runY = (s.dy ?? 0) * cell
            // A hand doesn't travel in a straight line, so the path bows out
            // perpendicular to the run — which also means the tile crosses a
            // lane or two on the way and the neighbours react live.
            const len = Math.hypot(runX, runY) || 1
            const bowAmp = resize ? 0 : Math.min(len * 0.14, cell * 0.85) * (runY >= 0 ? -1 : 1)
            const nx = -runY / len
            const ny = runX / len

            await tween(s.travel ?? (resize ? 900 : 840), (t) => {
                const e = easeInOut(t)
                // Overshoot a stretch slightly so the date pill counts past
                // the mark and settles, the way a hand does.
                const over = resize ? Math.sin(t * Math.PI) * cell * 0.45 : 0
                const bow = Math.sin(t * Math.PI) * bowAmp
                moveTo(from.x + runX * e + nx * bow + over, from.y + runY * e + ny * bow)

                // The cell under the hand, in whole cells from where it began.
                const dc = Math.round((runX * e + over) / cell)
                const dr = Math.round((runY * e + ny * bow) / cell)
                const fp = resize
                    ? { ...fp0, days: Math.max(1, fp0.days + dc) }
                    : { ...fp0, col: fp0.col + dc, row: Math.max(0, fp0.row + dr) }
                held = { id: s.id, kind, fp }
                board.to(s.id, kind, fp)
            })
            if (stale(g)) return
            await wait(resize ? 420 : 230) // read the pill / hover the cell
            if (stale(g)) return

            if (held) board.end(held.id, held.kind, held.fp)
            held = null
            paint(undefined, false)
            await wait(s.rest ?? 620)
            if (stale(g)) return
            setHot(null)
        }

        const playStep = (s: Step, first: boolean, g: number) =>
            s.act === "click" ? playClick(s, first, g) : playTile(s, first, g)

        void (async () => {
            while (alive) {
                while (paused && alive) await waitForResume()
                if (!alive) return
                // Every pass starts from the same picture, whether the last
                // one finished or was cut short.
                cbs.current.onCycleEnd?.()
                const g = gen
                await wait(360)
                if (stale(g)) continue

                for (let i = 0; i < steps.length; i++) {
                    if (stale(g)) break
                    await playStep(steps[i], i === 0, g)
                }
                if (!alive) return
                if (!stale(g)) {
                    // The cursor drifts off and fades before the reset.
                    const leave = { ...at }
                    await tween(420, (t) => {
                        const e = easeOut(t)
                        moveTo(leave.x + 40 * e, leave.y + 54 * e)
                    })
                    paint(false, false)
                    await wait(700)
                }
            }
        })()

        return () => {
            window.removeEventListener("pointerdown", onRealDown, true)
            root.removeEventListener("pointermove", onRealMove)
            document.removeEventListener("visibilitychange", onVisibility)
            root.removeEventListener("pointerleave", arm)
            clearTimeout(armTimer)
            const wasHandedOver = !alive
            alive = false
            unwind()
            wakers.forEach((w) => w())
            wakers.clear()
            // Scrolled out of view / unmounting mid-gesture: put the surface
            // back. On a hand-over we leave it as the reader found it.
            if (!wasHandedOver) cbs.current.onCycleEnd?.()
        }
        // `steps` is a module constant at every call site; re-running the
        // script because its identity changed would restart it mid-gesture.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, rootRef, boardRef])

    return cursorRef
}

type Footprint = NonNullable<ReturnType<BoardDemoHandle["footprintOf"]>>
