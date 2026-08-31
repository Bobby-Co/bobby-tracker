import { test, expect, describe } from "bun:test"
import { splitPath, splitKeyframes, type SplitGeometry } from "./liquid-split"

const GEO: SplitGeometry = { width: 147, height: 30, capWidth: 113, ballRadius: 14 }

/** Every command letter in a path, in order — its "shape" for interpolation. */
function structure(d: string): string {
    return (d.match(/[A-Za-z]/g) ?? []).join("")
}

/** The y of the waist's upper point — the endpoint of the third segment, which
 *  is where the neck is at its narrowest. Rises from the shape's top edge to
 *  the centre line as the two halves part. */
function waistTopY(d: string): number {
    const ns = numbers(d)
    // M(1 point) C(3) C(3) => the third segment's endpoint is the 7th point.
    return ns[7 * 2 - 1]
}

/** Every number in a path, in order. */
function numbers(d: string): number[] {
    return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
}

describe("splitPath", () => {
    // THE load-bearing property. SMIL can only tween `d` between paths built
    // from the same commands in the same order; the moment one frame has a
    // segment another lacks, the animation degrades to a swap and the liquid
    // becomes a jump cut. Nothing about the rendered picture would look wrong
    // in a screenshot, which is exactly why it is asserted here.
    test("every frame has an identical segment structure", () => {
        const shapes = new Set(splitKeyframes(GEO, 12).map(structure))
        expect(shapes.size).toBe(1)
    })

    test("every frame has the same number of coordinates", () => {
        const counts = new Set(splitKeyframes(GEO, 12).map((d) => numbers(d).length))
        expect(counts.size).toBe(1)
    })

    // At rest the waist reaches the shape's own top edge — there is no dip
    // toward the centre line — which is what makes it read as ONE capsule
    // rather than two shapes already touching. By the end it has closed onto
    // the centre line, so the frame the real controls take over from already
    // looks separated.
    test("the waist opens at the full height and closes to a point", () => {
        expect(waistTopY(splitPath(GEO, 0))).toBeCloseTo(0, 2)
        expect(waistTopY(splitPath(GEO, 1))).toBeCloseTo(GEO.height / 2, 2)
    })

    // Monotonic, because a waist that widened again part-way through would
    // read as the blob breathing rather than tearing.
    test("the waist only ever narrows", () => {
        const ys = splitKeyframes(GEO, 16).map((d) => waistTopY(d))
        for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1])
    })

    // The ball has to end up where the real pill is about to appear, or the
    // handoff jumps. It travels from inside the capsule out to the left edge.
    test("the ball travels from inside the cap to the far edge", () => {
        const startX = numbers(splitPath(GEO, 0))[0]
        const endX = numbers(splitPath(GEO, 1))[0]
        expect(endX).toBeLessThan(startX)
        // First point is the ball's leftmost, so at t=1 it sits on x=0.
        expect(endX).toBeCloseTo(0, 1)
    })

    test("never draws outside its own box", () => {
        for (const d of splitKeyframes(GEO, 12)) {
            const ns = numbers(d)
            const xs = ns.filter((_, i) => i % 2 === 0)
            const ys = ns.filter((_, i) => i % 2 === 1)
            expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.01)
            expect(Math.max(...xs)).toBeLessThanOrEqual(GEO.width + 0.01)
            expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.01)
            expect(Math.max(...ys)).toBeLessThanOrEqual(GEO.height + 0.01)
        }
    })
})
