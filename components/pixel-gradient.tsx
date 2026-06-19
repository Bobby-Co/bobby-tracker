"use client"

import { useEffect, useRef } from "react"

type RGB = [number, number, number]
export type Stop = { pos: number; c: RGB } // pos 0 = centre, 1 = corner

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function smoothstep(e0: number, e1: number, x: number) {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)
}

function sampleStops(stops: Stop[], t: number): RGB {
    if (t <= stops[0].pos) return stops[0].c
    const last = stops[stops.length - 1]
    if (t >= last.pos) return last.c
    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i],
            b = stops[i + 1]
        if (t >= a.pos && t <= b.pos) {
            const k = (t - a.pos) / (b.pos - a.pos)
            return [lerp(a.c[0], b.c[0], k), lerp(a.c[1], b.c[1], k), lerp(a.c[2], b.c[2], k)]
        }
    }
    return last.c
}

// Bright cornflower centre → near-black corners. The last stop matches a dark
// page background (#080810) so the diamond blends out at the edges.
export const BLUE_STOPS: Stop[] = [
    { pos: 0.0, c: [182, 202, 252] },
    { pos: 0.26, c: [122, 148, 250] },
    { pos: 0.5, c: [70, 92, 240] },
    { pos: 0.72, c: [40, 50, 178] },
    { pos: 0.9, c: [18, 22, 82] },
    { pos: 1.0, c: [8, 8, 16] }, // last stop = page background
]

// Light theme: soft cornflower bloom → the app's page background (#fafafa).
// Centre stays light enough that dark text reads over it, but the centre→corner
// lightness ramp is wide enough that adjacent tiles stay visibly distinct.
export const LIGHT_STOPS: Stop[] = [
    { pos: 0.0, c: [150, 176, 250] },
    { pos: 0.26, c: [183, 201, 250] },
    { pos: 0.5, c: [208, 219, 251] },
    { pos: 0.72, c: [228, 234, 252] },
    { pos: 0.9, c: [243, 245, 251] },
    { pos: 1.0, c: [250, 250, 250] }, // last stop = --c-page (#fafafa)
]

// Aurora: orchid-magenta core → periwinkle → aqua → icy near-white corners.
// A multi-hue sweep (reads softer than the single-hue ramps above). The aqua
// band is wide so it fills the mid-field; the last stop is the icy corner used
// as the section background so the pattern blends out at the edges.
export const AURORA_STOPS: Stop[] = [
    { pos: 0.0, c: [202, 100, 200] }, // orchid-magenta core (kept tight)
    { pos: 0.04, c: [188, 120, 222] }, // purple
    { pos: 0.1, c: [168, 150, 230] }, // periwinkle
    { pos: 0.19, c: [148, 188, 224] }, // soft cornflower blue
    { pos: 0.32, c: [140, 212, 216] }, // aqua / teal
    { pos: 0.5, c: [156, 220, 222] }, // aqua (broad mid-field)
    { pos: 0.68, c: [190, 233, 235] }, // pale aqua
    { pos: 0.84, c: [217, 241, 243] }, // very pale cyan
    { pos: 1.0, c: [236, 246, 248] }, // icy corner = section background
]

// Honey glow (brand gold): a luminous gold core ramps out through the brand's
// rich amber body, then lifts back up to a warm cream corner. Built straight
// from the --primary scale (300/400/600/700), which is a single-hue lightness
// ramp — exactly what keeps the pixel tiles crisp and distinct.
export const HONEY_STOPS: Stop[] = [
    { pos: 0.0, c: [253, 224, 71] }, // bright glowing core   (primary-300 #fde047)
    { pos: 0.22, c: [250, 204, 21] }, // gold                 (primary-400 #facc15)
    { pos: 0.44, c: [204, 140, 10] }, // rich honey gold      (~primary-600 #ca8a04)
    { pos: 0.58, c: [183, 118, 24] }, // deepest honey-amber (golden, not brown)
    { pos: 0.72, c: [223, 188, 120] }, // warm tan (lifting back to light)
    { pos: 0.85, c: [241, 226, 182] }, // warm sand
    { pos: 0.94, c: [249, 242, 224] }, // pale cream
    { pos: 1.0, c: [251, 245, 230] }, // warm cream corner = section background
]

// Soft periwinkle, for the `linear` variant: a gentle corner-to-corner wash
// from a muted periwinkle (pos 0) up to pale lavender (pos 1). Low contrast on
// purpose — the tiles read as a subtle texture, not a bold bloom.
export const PERIWINKLE_STOPS: Stop[] = [
    { pos: 0.0, c: [115, 128, 238] }, // deepest end (kept light — a soft periwinkle)
    { pos: 0.33, c: [146, 158, 243] },
    { pos: 0.66, c: [178, 186, 248] },
    { pos: 1.0, c: [210, 216, 252] }, // pale lavender end
]

// Light gold wash (brand `--primary`): the same subtle `linear` treatment, but
// airy — a soft gold (pos 0, a pale tint of primary-300/400) lifting to warm
// near-white (pos 1). Stays light enough for dark text anywhere on the page.
export const GOLD_WASH_STOPS: Stop[] = [
    { pos: 0.0, c: [252, 226, 124] }, // soft gold (light tint of the brand gold)
    { pos: 0.35, c: [253, 235, 165] },
    { pos: 0.68, c: [254, 244, 208] },
    { pos: 1.0, c: [255, 251, 238] }, // warm near-white end
]

// Gold corner glow (brand `--primary`): for the `linear` variant. The deepest
// point is the true primary (#facc15) anchored at the start corner, then it
// decays FAST so most of the canvas reads as warm white — a small glow, not a
// full wash. Front-loaded stops = quick falloff.
export const GOLD_CORNER_STOPS: Stop[] = [
    { pos: 0.0, c: [250, 204, 21] }, // PRIMARY #facc15 — darkest, at the corner
    { pos: 0.1, c: [251, 218, 80] },
    { pos: 0.22, c: [253, 234, 150] },
    { pos: 0.36, c: [254, 245, 210] },
    { pos: 0.52, c: [255, 252, 242] }, // basically white by here…
    { pos: 1.0, c: [255, 253, 248] }, // …and warm white the rest of the way
]

// Tiny canvas (cols × rows) stretched to fill its parent with
// `image-rendering: pixelated` → the browser nearest-neighbour-upscales each
// source pixel into a crisp block. No per-frame work: we only redraw on resize.
export default function PixelGradient({
    stops = BLUE_STOPS,
    variant = "diamond", // "diamond" = radial bloom; "linear" = corner-to-corner wash
    tiltDeg = 18, // diamond: rotation (0 axis-aligned, ~45 square). linear: gradient direction
    tilePx = 26, // approx tile width in CSS px (bigger = chunkier)
    tileAspect = 1.35, // tile height / width (>1 = taller than wide)
    mirror = false, // linear only: mirror the ramp so pos 0 lands at BOTH ends of the axis
    className = "",
}: {
    stops?: Stop[]
    variant?: "diamond" | "linear"
    tiltDeg?: number
    tilePx?: number
    tileAspect?: number
    mirror?: boolean
    className?: string
}) {
    const ref = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = ref.current
        const host = canvas?.parentElement
        if (!canvas || !host) return

        const draw = () => {
            const w = host.clientWidth,
                h = host.clientHeight
            if (!w || !h) return

            const cols = Math.max(8, Math.round(w / tilePx))
            const rows = Math.max(8, Math.round(h / (tilePx * tileAspect)))
            canvas.width = cols
            canvas.height = rows

            const ctx = canvas.getContext("2d")
            if (!ctx) return

            const ang = (tiltDeg * Math.PI) / 180
            const cosA = Math.cos(ang),
                sinA = Math.sin(ang)
            const asp = w / h // aspect-correct so the tilt stays true when wide

            // farthest corner, to normalise the ramp regardless of tilt/aspect
            const c1 = Math.abs(0.5 * asp * cosA + 0.5 * sinA) + Math.abs(-0.5 * asp * sinA + 0.5 * cosA)
            const c2 = Math.abs(0.5 * asp * cosA - 0.5 * sinA) + Math.abs(-0.5 * asp * sinA - 0.5 * cosA)
            const maxR = Math.max(c1, c2)
            // linear: max projection onto the gradient axis (at a corner), to map t→[0,1]
            const maxP = Math.abs(0.5 * asp * cosA) + Math.abs(0.5 * sinA)

            const img = ctx.createImageData(cols, rows)
            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    const fx = cols === 1 ? 0 : x / (cols - 1)
                    const fy = rows === 1 ? 0 : y / (rows - 1)
                    const ox = (fx - 0.5) * asp // centre offset, aspect-corrected
                    const oy = fy - 0.5
                    let t: number
                    if (variant === "linear") {
                        // project onto the (cosA, sinA) axis → a corner-to-corner ramp.
                        const proj = (ox * cosA + oy * sinA) / maxP // -1..1 along the axis
                        // mirror: pos 0 at BOTH ends (|proj|→1), pos 1 in the middle — so a
                        // corner glow appears at the start corner AND its diagonal opposite.
                        // normal: a single ramp, pos 0 at the start corner → pos 1 opposite.
                        t = mirror ? 1 - Math.abs(proj) : 0.5 + proj / 2
                    } else {
                        const rx = ox * cosA + oy * sinA // rotate → tilt
                        const ry = -ox * sinA + oy * cosA
                        const r = (Math.abs(rx) + Math.abs(ry)) / maxR // Manhattan = diamond
                        t = smoothstep(0.05, 1.0, r)
                    }
                    const c = sampleStops(stops, t)
                    const i = (y * cols + x) * 4
                    img.data[i] = c[0]
                    img.data[i + 1] = c[1]
                    img.data[i + 2] = c[2]
                    img.data[i + 3] = 255
                }
            }
            ctx.putImageData(img, 0, 0)
        }

        draw()
        const ro = new ResizeObserver(draw)
        ro.observe(host)
        return () => ro.disconnect()
    }, [stops, variant, tiltDeg, tilePx, tileAspect, mirror])

    return (
        <canvas
            ref={ref}
            aria-hidden
            className={className}
            style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                imageRendering: "pixelated",
            }}
        />
    )
}
