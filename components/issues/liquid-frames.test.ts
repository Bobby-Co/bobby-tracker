import { test, expect, describe } from "bun:test"
import { bakeFrames, traceFrame, shapesAt, OPEN_MS, type DockGeometry } from "./liquid-frames"

const GEO: DockGeometry = {
    // The opened pill, the gap, and the button — see DockGeometry.width.
    width: 102 + 7 + 111,
    height: 28,
    buttonWidth: 111,
    pillWidth: 102,
    gap: 7,
    radius: 14,
}

/** How many closed loops a frame is made of. One means the two ends are still
 *  joined; two means the drop has come away. */
function loops(d: string): number {
    return (d.match(/M /g) ?? []).length
}

function points(d: string): { x: number; y: number }[] {
    return (d.match(/-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?/g) ?? []).map((pair) => {
        const [x, y] = pair.split(/\s+/).map(Number)
        return { x, y }
    })
}

describe("shapesAt", () => {
    // At rest the drop sits exactly on the button's left end. If it did not,
    // the very first frame would show a bulge and the gesture would begin with
    // a flinch.
    test("starts as the button alone", () => {
        const { button, drop } = shapesAt(GEO, 0)
        expect(drop.w).toBeCloseTo(GEO.height, 2)
        expect(drop.x).toBeCloseTo(button.x, 1)
    })

    // And ends where the real pill is about to be drawn, or the handoff jumps.
    test("ends a gap clear of the button, opened to the pill's width", () => {
        const { button, drop } = shapesAt(GEO, OPEN_MS)
        expect(drop.w).toBeCloseTo(GEO.pillWidth, 1)
        expect(drop.x + drop.w).toBeCloseTo(button.x - GEO.gap, 1)
    })
})

describe("traceFrame", () => {
    // THE property the whole approach exists for. The live filter could only
    // ever return one image, so "pinched" and "separated" looked alike; a baked
    // frame is genuinely one loop or two, and the tear is a real event.
    test("one shape at rest, two once the drop has come away", () => {
        expect(loops(traceFrame(GEO, 0, 3.5, 12))).toBe(1)
        expect(loops(traceFrame(GEO, OPEN_MS, 3.5, 12))).toBe(2)
    })

    test("every frame is a closed path", () => {
        for (const d of bakeFrames(GEO)) {
            expect(d.startsWith("M ")).toBe(true)
            expect(d.trimEnd().endsWith("Z")).toBe(true)
        }
    })

    // The contour is traced in the dock's own coordinates, with the padding the
    // blur needed subtracted back out — otherwise the shape would sit offset
    // from the controls drawn on top of it.
    test("frames are in the dock's coordinates, not the padded grid's", () => {
        const p = points(traceFrame(GEO, 0, 3.5, 12))
        const xs = p.map((q) => q.x)
        const ys = p.map((q) => q.y)
        // The button occupies the right-hand end; nothing at rest reaches left
        // of it, and nothing escapes the control's height by more than the
        // blur's own softening.
        expect(Math.min(...xs)).toBeGreaterThan(GEO.width - GEO.buttonWidth - 3)
        expect(Math.max(...xs)).toBeLessThan(GEO.width + 3)
        expect(Math.min(...ys)).toBeGreaterThan(-3)
        expect(Math.max(...ys)).toBeLessThan(GEO.height + 3)
    })

    // Simplification has to leave enough points to still read as a curve.
    test("keeps enough points to look like a shape, not a polygon", () => {
        const n = points(traceFrame(GEO, 0, 3.5, 12)).length
        expect(n).toBeGreaterThan(20)
        expect(n).toBeLessThan(400)
    })
})

describe("bakeFrames", () => {
    test("covers the whole gesture", () => {
        const frames = bakeFrames(GEO)
        expect(frames.length).toBeGreaterThan(20)
        // First and last are the two states the controls hand over from and to.
        expect(loops(frames[0])).toBe(1)
        expect(loops(frames[frames.length - 1])).toBe(2)
    })

    // It runs once on mount, so it has to be quick enough not to be felt.
    test("bakes fast enough to do on mount", () => {
        const started = performance.now()
        bakeFrames(GEO)
        expect(performance.now() - started).toBeLessThan(400)
    })
})
