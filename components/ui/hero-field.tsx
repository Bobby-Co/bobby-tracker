"use client"

import { useEffect, useState } from "react"
import PixelGradient, { type Stop } from "@/components/ui/pixel-gradient"

// The hero's pixel field: the light ember ramp, with the dark ember ramp fading
// in over it as the scroll dissolve progresses.
//
// Both layers only run their ambient ripple sweep while the hero is at rest. The
// moment the reader scrolls, the sweep is switched off and the field holds still
// so the scroll-driven dissolve is the only thing moving — two competing motions
// read as noise, and the sweep is an idle flourish, not part of the transition.
// Toggling `animate` repaints PixelGradient's static base frame, which is the
// same frame shown between ripples, so nothing jumps when it stops.

export default function HeroField({
    lightStops,
    darkStops,
    /** CSS expression driving the dark layer's opacity (reads `--hero-p`). */
    darkOpacity,
}: {
    lightStops: Stop[]
    darkStops: Stop[]
    darkOpacity: string
}) {
    const [atRest, setAtRest] = useState(true)

    useEffect(() => {
        // A couple of pixels of slack so a resting page that isn't pinned to
        // exactly 0 (restored scroll, elastic overscroll) still counts as idle.
        const idle = () => window.scrollY <= 2
        const onScroll = () => setAtRest((was) => (was === idle() ? was : idle()))
        onScroll()
        window.addEventListener("scroll", onScroll, { passive: true })
        return () => window.removeEventListener("scroll", onScroll)
    }, [])

    const common = {
        variant: "linear" as const,
        tilePx: 48,
        tileAspect: 1,
        tiltDeg: -45,
        mirror: true,
        mirrorBias: 0.22,
    }

    return (
        <>
            <PixelGradient stops={lightStops} {...common} animate={atRest} />
            <div className="pointer-events-none absolute inset-0" style={{ opacity: darkOpacity }}>
                <PixelGradient stops={darkStops} {...common} animate={atRest} />
            </div>
        </>
    )
}
