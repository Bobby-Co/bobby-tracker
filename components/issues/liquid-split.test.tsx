import { test, expect, describe } from "bun:test"
import { splitPath, splitKeyframes, type SplitGeometry } from "./liquid-split"

const GEO: SplitGeometry = { width: 149, height: 30, capWidth: 113 }

/** Every command letter in a path, in order — its "shape" for interpolation. */
function structure(d: string): string {
    return (d.match(/[A-Za-z]/g) ?? []).join("")
}

/** Every number in a path, in order. */
function numbers(d: string): number[] {
    return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
}

/** The point each segment ENDS on, control points discarded.
 *
 *  Assertions are written against these rather than raw numbers because a
 *  cubic's handles routinely sit outside the curve they describe — an arc's
 *  control points bulge past its own bounding box by design — so a test that
 *  reads every number in the path is asserting on scaffolding. */
function endpoints(d: string): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = []
    const re = /([MLC])([^MLCZ]*)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(d))) {
        const ns = (m[2].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
        out.push({ x: ns[ns.length - 2], y: ns[ns.length - 1] })
    }
    return out
}

// Named positions in the outline, so the tests read as claims about the shape
// rather than as arithmetic on an array. See splitPath for the segment order.
const UPPER_JOIN = 0 // where the bridge meets the round end, above
const LOWER_JOIN = 8 // and below
const BALL_LEFTMOST = 10 // the round end's far side, halfway round its arc

const joinSpan = (t: number) => {
    const ep = endpoints(splitPath(GEO, t))
    return Math.abs(ep[LOWER_JOIN].y - ep[UPPER_JOIN].y)
}

describe("splitPath", () => {
    // THE load-bearing property. SMIL can only tween `d` between paths built
    // from the same commands in the same order; the moment one frame has a
    // segment another lacks, the animation degrades to a swap and the liquid
    // becomes a jump cut. Nothing about a single rendered frame would look
    // wrong, which is exactly why it is asserted here.
    test("every frame has an identical segment structure", () => {
        const shapes = new Set(splitKeyframes(GEO, 12).map(structure))
        expect(shapes.size).toBe(1)
    })

    test("every frame has the same number of coordinates", () => {
        const counts = new Set(splitKeyframes(GEO, 12).map((d) => numbers(d).length))
        expect(counts.size).toBe(1)
    })

    // At rest the bridge spans the shape's full height — it IS the capsule's
    // flat side — and by the end it has retracted to nothing. That retraction
    // is what leaves a whole circle behind instead of the permanently pinched
    // semicircle two earlier versions produced.
    test("the bridge spans the full height, then retracts to nothing", () => {
        expect(joinSpan(0)).toBeCloseTo(GEO.height, 1)
        expect(joinSpan(1)).toBeCloseTo(0, 1)
    })

    // Monotonic, because a join that widened again part-way would read as the
    // blob breathing rather than tearing.
    test("the bridge only ever narrows", () => {
        const ws = Array.from({ length: 17 }, (_, i) => joinSpan(i / 16))
        for (let i = 1; i < ws.length; i++) expect(ws[i]).toBeLessThanOrEqual(ws[i - 1] + 0.01)
    })

    // The point of the rebuild: what is left behind is a CIRCLE. With the
    // bridge retracted the round end's own outline spans the full height of the
    // shape; a semicircle would reach only half of it.
    test("the round end finishes as a whole circle", () => {
        const ep = endpoints(splitPath(GEO, 1))
        const ys = ep.slice(BALL_LEFTMOST - 1).map((p) => p.y)
        expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(GEO.height, 0)
        // And its far side reaches the edge of the span, where the real pill is
        // about to appear.
        expect(ep[BALL_LEFTMOST].x).toBeCloseTo(0, 1)
    })

    // The capsule must finish extending before it starts tearing, or the two
    // motions fight and the shape lurches.
    test("the round end travels out, then holds still while the bridge goes", () => {
        const at = (t: number) => endpoints(splitPath(GEO, t))[BALL_LEFTMOST].x
        // Starts as the button's own left cap.
        expect(at(0)).toBeCloseTo(GEO.width - GEO.capWidth, 1)
        expect(at(0.45)).toBeCloseTo(0, 1)
        for (const t of [0.5, 0.7, 0.9, 1]) expect(at(t)).toBeCloseTo(at(0.5), 2)
    })

    test("never draws outside its own box", () => {
        for (const d of splitKeyframes(GEO, 12)) {
            for (const p of endpoints(d)) {
                expect(p.x).toBeGreaterThanOrEqual(-0.01)
                expect(p.x).toBeLessThanOrEqual(GEO.width + 0.01)
                expect(p.y).toBeGreaterThanOrEqual(-0.01)
                expect(p.y).toBeLessThanOrEqual(GEO.height + 0.01)
            }
        }
    })
})
