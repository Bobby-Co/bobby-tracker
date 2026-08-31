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
    /** Radius of the ball being thrown off the left. */
    ballRadius: number
}

/** The outline at progress `t`: 0 is one undivided capsule, 1 is a ball pinched
 *  off the left end.
 *
 *  Pure, and exported, so its shape can be asserted rather than eyeballed. */
export function splitPath(geo: SplitGeometry, t: number): string {
    const { width: W, height: H, capWidth, ballRadius: r } = geo
    const R = H / 2
    const cy = R

    // Where the ball's centre travels: from tucked inside the capsule's left
    // cap out to the far edge of the span.
    const from = W - capWidth + R
    const to = r
    const cx = from + (to - from) * t

    // The waist. Full height at rest — which is what makes the whole thing read
    // as ONE capsule rather than two shapes that happen to touch — and gone at
    // the end. The exponent makes it hold its width and then let go, which is
    // how a liquid neck actually behaves; a linear taper looks like a wipe.
    const k = R * Math.pow(1 - t, 1.6)

    // The capsule's left cap is replaced by the junction, so the neck attaches
    // at the cap's tangent points rather than at the bounding box.
    const capLeft = W - capWidth + R
    const ballRight = cx + r
    const gap = capLeft - ballRight
    const midX = ballRight + gap / 2
    const c1X = ballRight + gap * 0.3
    const c2X = capLeft - gap * 0.3

    const n = (v: number) => Math.round(v * 100) / 100

    return [
        `M ${n(cx - r)} ${n(cy)}`,
        // ball: left side, up over the top
        `C ${n(cx - r)} ${n(cy - r * K)} ${n(cx - r * K)} ${n(cy - r)} ${n(cx)} ${n(cy - r)}`,
        // ball top into the waist
        `C ${n(cx + r * K)} ${n(cy - r)} ${n(c1X)} ${n(cy - k)} ${n(midX)} ${n(cy - k)}`,
        // waist into the capsule's top tangent
        `C ${n(c2X)} ${n(cy - k)} ${n(capLeft - R * K)} 0 ${n(capLeft)} 0`,
        // along the top
        `L ${n(W - R)} 0`,
        // right cap
        `C ${n(W - R + R * K)} 0 ${n(W)} ${n(R - R * K)} ${n(W)} ${n(R)}`,
        `C ${n(W)} ${n(R + R * K)} ${n(W - R + R * K)} ${n(H)} ${n(W - R)} ${n(H)}`,
        // back along the bottom
        `L ${n(capLeft)} ${n(H)}`,
        // capsule bottom tangent into the waist
        `C ${n(capLeft - R * K)} ${n(H)} ${n(c2X)} ${n(cy + k)} ${n(midX)} ${n(cy + k)}`,
        // waist into the ball's underside
        `C ${n(c1X)} ${n(cy + k)} ${n(cx + r * K)} ${n(cy + r)} ${n(cx)} ${n(cy + r)}`,
        // ball: round the bottom back to the start
        `C ${n(cx - r * K)} ${n(cy + r)} ${n(cx - r)} ${n(cy + r * K)} ${n(cx - r)} ${n(cy)}`,
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
