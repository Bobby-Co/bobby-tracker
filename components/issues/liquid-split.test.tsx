import { test, expect, describe } from "bun:test"
import { splitPath, splitKeyframes, type SplitGeometry } from "./liquid-split"

const GEO: SplitGeometry = { width: 149, height: 30, capWidth: 113 }

/** Every command letter in a path, in order — its "shape" for interpolation. */
function structure(d: string): string {
    return (d.match(/[A-Za-z]/g) ?? []).join("")
}

/** How far the upper flank dips toward the centre line at its deepest — the
 *  waist. Read off the flank cubic's control points, which is where the sag is
 *  expressed; a symmetric cubic's own midpoint reaches three quarters of it. */
function waistDip(d: string): number {
    const ns = numbers(d)
    // M(1 pt) C(3 pts) then the flank C: its first control point is the 6th.
    const controlY = ns[5 * 2 + 1]
    return (controlY - 0) * 0.75
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
        expect(waistDip(splitPath(GEO, 0))).toBeCloseTo(0, 2)
        expect(waistDip(splitPath(GEO, 1))).toBeCloseTo(GEO.height / 2, 2)
    })

    // Monotonic, because a waist that widened again part-way through would
    // read as the blob breathing rather than tearing.
    test("the waist only ever narrows", () => {
        const ys = splitKeyframes(GEO, 16).map((d) => waistDip(d))
        for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1])
    })

    // The capsule has to reach the far edge before it starts tearing, and the
    // round end has to stop exactly where the real pill will appear — the whole
    // handoff depends on it.
    test("the left end grows out to the far edge, then stops", () => {
        const leftmost = (t: number) => numbers(splitPath(GEO, t))[0]
        expect(leftmost(0)).toBeCloseTo(GEO.width - GEO.capWidth, 1)
        expect(leftmost(1)).toBeCloseTo(0, 1)
        // Growth is finished before the tear begins, so the two never fight.
        expect(leftmost(0.45)).toBeCloseTo(0, 1)
    })

    // Nothing may move once the tear starts; the round end is already home.
    test("the round end is still while the waist closes", () => {
        const late = [0.5, 0.7, 0.9, 1].map((t) => numbers(splitPath(GEO, t))[0])
        for (const x of late) expect(x).toBeCloseTo(late[0], 2)
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
