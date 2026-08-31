"use client"

import { useEffect, useMemo, useRef } from "react"
import {
    bakeFrames,
    spanFor,
    OPEN_MS,
    TRAVEL_MS,
    WIDEN_FROM_MS,
    type DockGeometry,
} from "@/components/issues/liquid-frames"

// The liquid, played back from baked frames.
//
// The shape is the isoline of a blurred union — two round things near each
// other join with a concave waist, and pulling them apart thins it until it
// lets go. Nothing here describes a neck; see liquid-frames, which computes it.
//
// ─── why it is baked and not filtered ─────────────────────────────────────
//
// The obvious implementation is an SVG goo filter over two animated divs, and
// it works beautifully in Chromium. Safari does not reliably re-rasterise a
// filter while the element beneath it animates: it renders the first frame and
// holds it, so the drop would freeze and then jump. Every fallback for that is
// worse than not using the filter — so the filter runs once, off-screen, at
// mount, and playback is a plain `<path>` whose `d` is swapped from a clock.
//
// That also buys a real stroke. Under the filter the border had to be recovered
// by thresholding the blur twice and subtracting, because a blur destroys any
// stroke it is given; a traced path simply takes one.

/** How far apart the two ends sit once the drop has landed. Small, because the
 *  blur has to still see them as neighbours for there to have been a neck at
 *  all; push them further and the join is gone before the motion is. */
export const GOO_GAP = 7

/** Room around the shape for the blur to spill into while it is being baked. */
const PAD = 12
/** Matches the filter this was measured from. */
const SIGMA = 3.5

/** When the label's parts show themselves: WITH the opening, so the words
 *  arrive as the drop becomes a button rather than after it already is one.
 *
 *  Riding out from the start was the bug this fixes — the drop is a CIRCLE for
 *  its whole journey, so a full-width label on top of it is a line of text
 *  crossing empty panel, which reads as text sliding rather than as a drop
 *  being thrown. */
export const ICON_DELAY_MS = WIDEN_FROM_MS + 40
export const TEXT_DELAY_MS = WIDEN_FROM_MS + 90

/** The label rides the drop, so it takes the drop's OWN travel time — not a
 *  number derived from the other beats, which is how the two drift apart. The
 *  curve mirrors the baked easing: accelerate out of rest, settle into place. */
export const LABEL_TRAVEL = `transform ${TRAVEL_MS}ms cubic-bezier(0.65, 0, 0.35, 1)`
export const LABEL_TRAVEL_BACK = "transform 260ms cubic-bezier(0.4, 0, 0.2, 1) 100ms"

export function LiquidBackdrop({
    open,
    buttonWidth,
    height,
    pillWidth,
}: {
    open: boolean
    buttonWidth: number
    height: number
    pillWidth: number
}) {
    const pathRef = useRef<SVGPathElement>(null)
    const raf = useRef<number | null>(null)
    const startedAt = useRef<number>(0)

    const geo: DockGeometry | null = useMemo(() => {
        if (buttonWidth === 0 || height === 0) return null
        return {
            width: spanFor(buttonWidth, pillWidth, GOO_GAP),
            height,
            buttonWidth,
            pillWidth,
            gap: GOO_GAP,
            // A capsule, matching the metadata chips this docks beside.
            radius: height / 2,
        }
    }, [buttonWidth, height, pillWidth])

    // Baked once per geometry — a few milliseconds of arithmetic on mount, and
    // never again. Deliberately not memoised across geometries: the only thing
    // that changes them is a font or a translation, and both mean new frames.
    const frames = useMemo(() => (geo ? bakeFrames(geo, SIGMA, PAD) : []), [geo])

    useEffect(() => {
        if (frames.length === 0) return
        const last = frames.length - 1
        // Opening runs forward, closing runs back through the same frames a
        // little quicker — a pointer that has left is already gone, and nobody
        // watches a retraction.
        const duration = open ? OPEN_MS : OPEN_MS * 0.62
        startedAt.current = performance.now()

        const tick = () => {
            const elapsed = performance.now() - startedAt.current
            const t = Math.min(1, elapsed / duration)
            const idx = Math.round((open ? t : 1 - t) * last)
            pathRef.current?.setAttribute("d", frames[Math.max(0, Math.min(last, idx))])
            if (t < 1) raf.current = requestAnimationFrame(tick)
        }
        raf.current = requestAnimationFrame(tick)
        return () => {
            if (raf.current !== null) cancelAnimationFrame(raf.current)
        }
    }, [open, frames])

    if (!geo || frames.length === 0) return null

    return (
        <svg
            aria-hidden
            focusable="false"
            width={geo.width}
            height={geo.height}
            viewBox={`0 0 ${geo.width} ${geo.height}`}
            className="pointer-events-none absolute bottom-0 right-0 overflow-visible"
        >
            <path
                ref={pathRef}
                d={frames[0]}
                fill="var(--c-surface-2)"
                stroke="var(--c-primary)"
                strokeWidth="1"
                // Separate loops, never nested, so the two rules agree — but
                // evenodd states the intent: these are distinct shapes.
                fillRule="evenodd"
            />
        </svg>
    )
}
