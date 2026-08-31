"use client"

import { useEffect, useRef } from "react"

// The split, as an actual shape.
//
// The first attempt at this was the usual CSS trick: blur two divs, then push
// the alpha through a contrast curve so the blurred edges re-harden into one
// outline. It is cheap and it is what every "gooey button" demo does, and at
// the size of a 28px chip beside a 113px button it reads as a smudge rather
// than as liquid — the bridge is only ever a few pixels of soft grey, and how
// soft depends on the browser's filter implementation.
//
// So the outline is drawn instead of inferred. One path, one fill, and the
// waist between the two ends is a pair of cubic curves whose height we animate
// to zero. Nothing is blurred, nothing is thresholded, and it rasterises the
// same everywhere because it is just a path.
//
// ─── the segment structure is fixed ────────────────────────────────────────
//
// Every keyframe emits the SAME ten segments in the same order, because that is
// the condition for interpolating `d` at all: a path that is one subpath in one
// frame and two subpaths in the next cannot be tweened, it can only be swapped.
// So the two halves never actually detach here. The waist thins to nothing and
// the frame after that is the real controls taking over — by which point a
// pinch and a separation look identical.

export interface SplitGeometry {
    /** Total span the blob occupies: the button plus everything it throws. */
    width: number
    height: number
    /** The right-hand end — the button — which keeps its size throughout. */
    capWidth: number
}

/** Where the animation stops growing and starts tearing. */
const GROW_UNTIL = 0.45

/** A point on a circle. Screen coordinates, so y runs downward and the angle
 *  is the ordinary mathematical one. */
function pt(cx: number, cy: number, r: number, a: number): [number, number] {
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)]
}

/** One cubic approximating the arc from `a0` to `a1`. Exact to within a
 *  fraction of a pixel for sweeps up to a quarter turn, which is why the
 *  callers below split anything larger. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
    const h = (4 / 3) * Math.tan((a1 - a0) / 4) * r
    const [x0, y0] = pt(cx, cy, r, a0)
    const [x1, y1] = pt(cx, cy, r, a1)
    const c1: [number, number] = [x0 + h * -Math.sin(a0), y0 + h * -Math.cos(a0)]
    const c2: [number, number] = [x1 - h * -Math.sin(a1), y1 - h * -Math.cos(a1)]
    return `C ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(x1)} ${f(y1)}`
}

const f = (v: number) => Math.round(v * 100) / 100

/** The outline at progress `t`.
 *
 *  0     the button's capsule exactly.
 *  →0.45 the capsule EXTENDS leftward. Still one shape; there is just more of
 *        it. Doing this inside the path is what stops it being the choppy
 *        layout jump an earlier version used.
 *  →1    it detaches, and the shape it leaves behind is a WHOLE circle.
 *
 *  ─── how a gooey detach actually behaves ────────────────────────────────
 *
 *  Everything wrong with the previous two attempts came from where the bridge
 *  was attached. It ran between the TOPS of the two ends, so it was a long
 *  shallow sag across the whole gap — which thinned into a stretched thread
 *  rather than retracting, and left the round end as a permanent semicircle
 *  that could never finish as a circle.
 *
 *  Liquid does the opposite. The bridge attaches at the FACING sides, and as
 *  the two halves part the attachment point slides down toward the line of
 *  centres while the bridge shortens and gives up. That single parameter — how
 *  far around each circle the bridge has climbed — is `wrap` below:
 *
 *    wrap = 1  the bridge attaches at both tops and runs straight between
 *              them, which IS the flat side of a capsule. One shape.
 *    wrap → 0  the attachment slides to the line of centres, the bridge
 *              shortens to nothing, and each end is drawn as a FULL circle.
 *
 *  So the last frame is not a pinch that we hurry away from; it is two
 *  separate shapes joined by a zero-area seam, which is what lets the real
 *  controls take over without anything appearing to change.
 *
 *  Pure, and exported, so its shape can be asserted rather than eyeballed. */
export function splitPath(geo: SplitGeometry, t: number): string {
    const { width: W, height: H, capWidth } = geo
    const R = H / 2
    const cy = R
    const HALF = Math.PI / 2

    // The button, which never changes: its two cap centres.
    const capLeft = W - capWidth + R
    const rx = W - R

    // The round end starts AS the button's left cap — same centre, same radius
    // — and travels out. At t=0 the two coincide and the outline is the button
    // exactly, which is what lets the SVG take over with nothing moving.
    const lx = capLeft + (R - capLeft) * Math.min(t / GROW_UNTIL, 1)

    const tear = t <= GROW_UNTIL ? 0 : (t - GROW_UNTIL) / (1 - GROW_UNTIL)
    // Eased so the bridge holds and then lets go, rather than retracting at a
    // constant rate — linear reads as a wipe, not a tear.
    const wrap = 1 - Math.pow(tear, 1.25)

    // How far the two ends still overlap. Zero once they are clear of each
    // other, which keeps the bridge from being dragged back down mid-tear.
    const d = capLeft - lx
    const u = d < 2 * R ? Math.acos(Math.min(1, d / (2 * R))) : 0

    // Where the bridge meets each end.
    const aBall = u + (HALF - u) * wrap
    const aCap = Math.PI - aBall

    const [b1x, b1y] = pt(lx, cy, R, aBall)      // ball, upper
    const [b2x, b2y] = pt(lx, cy, R, -aBall)     // ball, lower
    const [c1x, c1y] = pt(capLeft, cy, R, aCap)  // cap, upper
    const [c2x, c2y] = pt(capLeft, cy, R, -aCap) // cap, lower

    // Handles along each end's tangent, so the bridge leaves and arrives
    // flush — that tangency is the whole difference between a liquid fillet
    // and two shapes with a stick between them.
    const hb = Math.hypot(c1x - b1x, c1y - b1y) * 0.5
    const sB = Math.sin(aBall)
    const cB = Math.cos(aBall)
    const sC = Math.sin(aCap)
    const cC = Math.cos(aCap)

    // The ball is drawn the LONG way round, which is what makes it a full
    // circle once the bridge has retracted. Four cubics: the sweep runs from a
    // half turn up to a whole one, and a cubic is only faithful to a quarter.
    const sweep = 2 * aBall - 2 * Math.PI
    const step = sweep / 4
    const a0 = -aBall

    return [
        `M ${f(b1x)} ${f(b1y)}`,
        // the bridge, upper side
        `C ${f(b1x + hb * sB)} ${f(b1y + hb * cB)} ${f(c1x - hb * sC)} ${f(c1y - hb * cC)} ${f(c1x)} ${f(c1y)}`,
        // up over the button's left cap to its top
        arc(capLeft, cy, R, aCap, HALF),
        // the button's own flat top, which the tear never touches
        `L ${f(rx)} ${f(cy - R)}`,
        arc(rx, cy, R, HALF, 0),
        arc(rx, cy, R, 0, -HALF),
        `L ${f(capLeft)} ${f(cy + R)}`,
        // down the left cap to the bridge's lower attachment
        arc(capLeft, cy, R, -HALF, -aCap),
        // the bridge, lower side
        `C ${f(c2x - hb * sC)} ${f(c2y + hb * cC)} ${f(b2x + hb * sB)} ${f(b2y - hb * cB)} ${f(b2x)} ${f(b2y)}`,
        // and the long way round the ball, back to where we began
        arc(lx, cy, R, a0, a0 + step),
        arc(lx, cy, R, a0 + step, a0 + 2 * step),
        arc(lx, cy, R, a0 + 2 * step, a0 + 3 * step),
        arc(lx, cy, R, a0 + 3 * step, a0 + 4 * step),
        "Z",
    ].join(" ")
}

/** Ease baked into the SAMPLING rather than into the playback.
 *
 *  SMIL applies keySplines per INTERVAL, so easing a spline-mode animation eases
 *  each hop between samples separately — it slows to a near-stop at every keyframe
 *  and the split visibly stutters its way across. Sampling the geometry on the
 *  eased curve and then playing the frames back linearly gives one continuous
 *  motion, and costs nothing but a few more sample points. */
function ease(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** The keyframes SMIL tweens between. Sampled rather than handed two endpoints
 *  because the ball's travel and the waist's collapse are on different curves —
 *  interpolating straight from t=0 to t=1 would average them into one. */
export function splitKeyframes(geo: SplitGeometry, steps = 12): string[] {
    return Array.from({ length: steps + 1 }, (_, i) => splitPath(geo, ease(i / steps)))
}

/** The blob itself. Plays once per `playToken` change.
 *
 *  SMIL rather than CSS or the Web Animations API for the reason the whole file
 *  exists: `d` is animatable in CSS only in Chromium and Safari, so a CSS
 *  version silently does nothing in Firefox. SMIL animates `d` in every engine
 *  that ships SVG, and `beginElement()` replays it on demand. */
export function LiquidSplit({
    geo,
    playToken,
    durationMs,
    className,
}: {
    geo: SplitGeometry
    /** Changes to replay the split. */
    playToken: number
    durationMs: number
    className?: string
}) {
    const animRef = useRef<SVGAnimateElement>(null)

    useEffect(() => {
        if (playToken === 0) return
        // beginElement is the whole reason this is SMIL and not a static path.
        try {
            animRef.current?.beginElement()
        } catch {
            // Older engines throw rather than no-op when the element is not yet
            // in a document timeline. A split that does not play is a cosmetic
            // loss, never a broken control.
        }
    }, [playToken])

    const frames = splitKeyframes(geo)

    return (
        <svg
            aria-hidden
            focusable="false"
            width={geo.width}
            height={geo.height}
            viewBox={`0 0 ${geo.width} ${geo.height}`}
            className={className}
        >
            <path
                d={frames[0]}
                fill="var(--c-primary-tint)"
                stroke="var(--c-primary)"
                strokeWidth="1"
            >
                <animate
                    ref={animRef}
                    attributeName="d"
                    values={frames.join(";")}
                    dur={`${durationMs}ms`}
                    // Hold the last frame: the real controls take over on the
                    // next beat, and snapping back to one capsule in between
                    // would be a visible flash.
                    fill="freeze"
                    begin="indefinite"
                    // Linear BETWEEN frames — the curve is already in where the
                    // frames were sampled. See `ease`.
                    calcMode="linear"
                />
            </path>
        </svg>
    )
}
