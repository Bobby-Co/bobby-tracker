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

/** Circle-quarter control-point ratio: the constant that makes four cubics a
 *  circle to within a fraction of a pixel. */
const K = 0.5523

export interface SplitGeometry {
    /** Total span the blob occupies: the button plus everything it throws. */
    width: number
    height: number
    /** The right-hand end — the button — which keeps its size throughout. */
    capWidth: number
}

/** Where the animation stops growing and starts tearing. */
const GROW_UNTIL = 0.45

/** The outline at progress `t`.
 *
 *  0     the button's own capsule, and nothing else.
 *  →0.45 the capsule EXTENDS: its left end travels out across the span while
 *        the shape stays whole. This is the "expand", and it happens inside the
 *        path — not as a layout change on the button, which is what made the
 *        earlier version choppy.
 *  →1    the extended capsule NECKS IN THE MIDDLE and pinches apart, leaving a
 *        round end that is the same size as the one it left.
 *
 *  ─── why both ends are the same radius ──────────────────────────────────
 *
 *  The first version threw a small ball out of a big capsule's left cap, and it
 *  looked like a raindrop being squeezed out because that is geometrically what
 *  it was: the neck ran from a 28px circle to the full 30px height of the
 *  capsule's flank, so the taper was spread down the whole length instead of
 *  being a pinch in one place. Two ends of equal radius — which here is just
 *  the control's own height — give the reference's shape: a peanut whose waist
 *  narrows in the middle and lets go.
 *
 *  Pure, and exported, so its shape can be asserted rather than eyeballed. */
export function splitPath(geo: SplitGeometry, t: number): string {
    const { width: W, height: H, capWidth } = geo
    const R = H / 2
    const cy = R

    // The button, which never changes: its two cap centres.
    const capLeft = W - capWidth + R
    const rx = W - R

    // The round end starts AS the button's left cap — same centre, same radius
    // — and travels out. At t=0 the two coincide and the outline is the button
    // exactly, which is what lets the SVG take over from it with nothing moving.
    const lx = capLeft + (R - capLeft) * Math.min(t / GROW_UNTIL, 1)

    // The waist, and the correction that took two attempts to get right: it
    // applies ONLY across the neck — between the round end and the button's own
    // left cap — never along the button's flank. Sagging the whole span pinched
    // the button itself into a thread with a bulb on the end, which is not a
    // split, it is a deflation.
    const tear = t <= GROW_UNTIL ? 0 : (t - GROW_UNTIL) / (1 - GROW_UNTIL)
    // Eased so the neck holds and then lets go, rather than closing at a
    // constant rate — a linear waist reads as a wipe, not a tear.
    const sag = R * Math.pow(tear, 1.35)

    // A cubic whose own midpoint dips by exactly `sag` needs its control points
    // pulled 4/3 of that, because a symmetric cubic reaches only three quarters
    // of the way to its handles.
    const pull = (sag * 4) / 3
    const reach = (capLeft - lx) * 0.3

    const n = (v: number) => Math.round(v * 100) / 100

    return [
        // the round end, leftmost point
        `M ${n(lx - R)} ${n(cy)}`,
        // round up to its top
        `C ${n(lx - R)} ${n(cy - R * K)} ${n(lx - R * K)} ${n(cy - R)} ${n(lx)} ${n(cy - R)}`,
        // the NECK's upper side, sagging toward the centre line
        `C ${n(lx + reach)} ${n(cy - R + pull)} ${n(capLeft - reach)} ${n(cy - R + pull)} ${n(capLeft)} ${n(cy - R)}`,
        // the button's own flat top — untouched by the sag
        `L ${n(rx)} ${n(cy - R)}`,
        // the button's right cap
        `C ${n(rx + R * K)} ${n(cy - R)} ${n(rx + R)} ${n(cy - R * K)} ${n(rx + R)} ${n(cy)}`,
        `C ${n(rx + R)} ${n(cy + R * K)} ${n(rx + R * K)} ${n(cy + R)} ${n(rx)} ${n(cy + R)}`,
        // back along the button's flat bottom
        `L ${n(capLeft)} ${n(cy + R)}`,
        // the NECK's lower side, sagging up to meet the other
        `C ${n(capLeft - reach)} ${n(cy + R - pull)} ${n(lx + reach)} ${n(cy + R - pull)} ${n(lx)} ${n(cy + R)}`,
        // round the end back to the start
        `C ${n(lx - R * K)} ${n(cy + R)} ${n(lx - R)} ${n(cy + R * K)} ${n(lx - R)} ${n(cy)}`,
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
