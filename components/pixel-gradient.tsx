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

// Ember: the gold corner glow with more colour — the deepest point leans
// orange, then warms back up through gold to white. Same front-loaded falloff
// so it stays a corner glow, just a richer ramp than the single-hue gold.
export const EMBER_STOPS: Stop[] = [
    { pos: 0.0, c: [233, 116, 18] }, // deep amber-orange — darkest, at the corner
    { pos: 0.15, c: [245, 152, 30] }, // orange
    { pos: 0.32, c: [249, 184, 58] }, // golden-orange
    { pos: 0.5, c: [251, 210, 106] }, // gold
    { pos: 0.7, c: [253, 230, 162] }, // light gold (colour still spreads through here)
    { pos: 0.86, c: [254, 243, 206] }, // pale cream
    { pos: 1.0, c: [255, 250, 232] }, // lightest = soft warm white (wide range → tiles pop)
]

// Tiny canvas (cols × rows) stretched to fill its parent with
// `image-rendering: pixelated` → the browser nearest-neighbour-upscales each
// source pixel into a crisp block. Static by default (redraw on resize only);
// `animate` adds occasional ripples — a tile flashes to rippleColor and the
// flash spreads outward to adjacent tiles, then fades.
export default function PixelGradient({
    stops = BLUE_STOPS,
    variant = "diamond", // "diamond" = radial bloom; "linear" = corner-to-corner wash
    tiltDeg = 18, // diamond: rotation (0 axis-aligned, ~45 square). linear: gradient direction
    tilePx = 26, // approx tile width in CSS px (bigger = chunkier)
    tileAspect = 1.35, // tile height / width (>1 = taller than wide)
    mirror = false, // linear only: mirror the ramp so pos 0 lands at BOTH ends of the axis
    mirrorBias = 0, // mirror only: -0.5..0.5 — shifts glow reach between the two ends (asymmetry)
    animate = false, // occasional ripples: a wavefront arcs in from beyond the bottom-left
    // or top-right corner (origin off-frame), crosses the frame, then fades (off for reduced motion)
    rippleSpeed = 4, // how fast a ripple front expands, in tiles/second (lower = slower)
    rippleInterval = 3000, // average ms between ripple spawns
    rippleColor = [255, 255, 255], // the colour a tile flashes to
    rippleStrength = 0.55, // max blend toward rippleColor (caps the crest so it's a soft wash, not solid)
    className = "",
}: {
    stops?: Stop[]
    variant?: "diamond" | "linear"
    tiltDeg?: number
    tilePx?: number
    tileAspect?: number
    mirror?: boolean
    mirrorBias?: number
    animate?: boolean
    rippleSpeed?: number
    rippleInterval?: number
    rippleColor?: RGB
    rippleStrength?: number
    className?: string
}) {
    const ref = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = ref.current
        const host = canvas?.parentElement
        if (!canvas || !host) return

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const reduce =
            typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

        let cols = 0
        let rows = 0
        let base: Uint8ClampedArray | null = null // static RGB per tile (cols*rows*3)
        let img: ImageData | null = null

        // (re)build the static colours for the current size and paint them. This
        // is also the frame shown when nothing is rippling / reduced motion.
        const computeBase = () => {
            const w = host.clientWidth,
                h = host.clientHeight
            if (!w || !h) return

            cols = Math.max(8, Math.round(w / tilePx))
            rows = Math.max(8, Math.round(h / (tilePx * tileAspect)))
            canvas.width = cols
            canvas.height = rows

            const ang = (tiltDeg * Math.PI) / 180
            const cosA = Math.cos(ang),
                sinA = Math.sin(ang)
            const asp = w / h // aspect-correct so the tilt stays true when wide

            // farthest corner, to normalise the ramp regardless of tilt/aspect
            const c1 = Math.abs(0.5 * asp * cosA + 0.5 * sinA) + Math.abs(-0.5 * asp * sinA + 0.5 * cosA)
            const c2 = Math.abs(0.5 * asp * cosA - 0.5 * sinA) + Math.abs(-0.5 * asp * sinA - 0.5 * cosA)
            const maxR = Math.max(c1, c2)
            const maxP = Math.abs(0.5 * asp * cosA) + Math.abs(0.5 * sinA) // linear normaliser

            const n = cols * rows
            const baseArr = new Uint8ClampedArray(n * 3)
            const imgLocal = ctx.createImageData(cols, rows)

            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    const fx = cols === 1 ? 0 : x / (cols - 1)
                    const fy = rows === 1 ? 0 : y / (rows - 1)
                    const ox = (fx - 0.5) * asp // centre offset, aspect-corrected
                    const oy = fy - 0.5
                    let t: number
                    if (variant === "linear") {
                        const proj = (ox * cosA + oy * sinA) / maxP // -1..1 along the axis
                        if (mirror) {
                            const dStart = (proj + 1) / 2 // 0 at the start corner
                            const dOpp = (1 - proj) / 2 // 0 at the opposite corner
                            const gStart = Math.max(0, 1 - dStart / Math.max(0.05, 0.5 + mirrorBias))
                            const gOpp = Math.max(0, 1 - dOpp / Math.max(0.05, 0.5 - mirrorBias))
                            t = 1 - Math.max(gStart, gOpp)
                        } else {
                            t = 0.5 + proj / 2 // single ramp, pos 0 at the start corner
                        }
                    } else {
                        const rx = ox * cosA + oy * sinA // rotate → tilt
                        const ry = -ox * sinA + oy * cosA
                        const r = (Math.abs(rx) + Math.abs(ry)) / maxR // Manhattan = diamond
                        t = smoothstep(0.05, 1.0, r)
                    }
                    const c = sampleStops(stops, t)
                    const idx = y * cols + x
                    const b = idx * 3
                    baseArr[b] = c[0]
                    baseArr[b + 1] = c[1]
                    baseArr[b + 2] = c[2]
                    const di = idx * 4
                    imgLocal.data[di] = c[0]
                    imgLocal.data[di + 1] = c[1]
                    imgLocal.data[di + 2] = c[2]
                    imgLocal.data[di + 3] = 255
                }
            }

            base = baseArr
            img = imgLocal
            ctx.putImageData(imgLocal, 0, 0) // static frame
        }

        computeBase()
        const ro = new ResizeObserver(computeBase)
        ro.observe(host)

        let raf = 0
        if (animate && !reduce) {
            // Each ripple's origin sits OFF the frame, diagonally beyond the bottom-left
            // or top-right corner, so the wavefront arcs in from that corner and sweeps to
            // the opposite one. `near` is the off-frame offset; `maxDist` the far reach.
            const ripples: { ox: number; oy: number; t0: number; maxDist: number; near: number }[] = []
            const wr = rippleColor
            const ringWidth = 0.9
            let nextSpawn = 0
            let wasActive = false

            const spawn = (now: number) => {
                // origin sits OFF the frame, `off` tiles diagonally beyond either the
                // bottom-left or top-right corner, so the wave arcs in from that corner.
                const off = Math.max(cols, rows) * (0.4 + Math.random() * 0.4)
                const k = Math.SQRT1_2 // diagonal unit component (1/√2)
                let ox: number, oy: number
                if (Math.random() < 0.5) {
                    ox = -k * off // beyond bottom-left, arcing toward top-right
                    oy = rows - 1 + k * off
                } else {
                    ox = cols - 1 + k * off // beyond top-right, arcing toward bottom-left
                    oy = -k * off
                }
                // farthest corner → how far the front travels to clear the whole frame
                const cs = [
                    [0, 0],
                    [cols - 1, 0],
                    [0, rows - 1],
                    [cols - 1, rows - 1],
                ]
                let maxDist = 0
                for (let i = 0; i < 4; i++) {
                    const d = Math.hypot(cs[i][0] - ox, cs[i][1] - oy)
                    if (d > maxDist) maxDist = d
                }
                // back-date t0 so the front starts just shy of the near edge — skips the
                // invisible off-frame travel so the arc enters almost immediately.
                const t0 = now - ((off - ringWidth * 2) / rippleSpeed) * 1000
                ripples.push({ ox, oy, t0, maxDist, near: off })
            }

            const paint = (now: number) => {
                const baseArr = base,
                    imgLocal = img
                if (!baseArr || !imgLocal) return
                const data = imgLocal.data
                for (let y = 0; y < rows; y++) {
                    for (let x = 0; x < cols; x++) {
                        let w = 0 // strongest ripple flash on this tile
                        for (let k = 0; k < ripples.length; k++) {
                            const rp = ripples[k]
                            const front = (now - rp.t0) * 0.001 * rippleSpeed
                            const dx = x - rp.ox,
                                dy = y - rp.oy
                            const e = (Math.sqrt(dx * dx + dy * dy) - front) / ringWidth
                            // fade across the visible span (near edge → far corner): the
                            // arc enters bright and dissipates as it crosses.
                            const span = rp.maxDist - rp.near
                            // cap the blend at rippleStrength so even the entry crest is a
                            // soft wash, not solid white; the faint tail stays unchanged.
                            const fade = span > 0 ? Math.max(0, Math.min(rippleStrength, 1 - (front - rp.near) / span)) : 0
                            const v = Math.exp(-e * e) * fade
                            if (v > w) w = v
                        }
                        if (w > 1) w = 1
                        const idx = y * cols + x
                        const b = idx * 3,
                            di = idx * 4
                        data[di] = baseArr[b] + (wr[0] - baseArr[b]) * w
                        data[di + 1] = baseArr[b + 1] + (wr[1] - baseArr[b + 1]) * w
                        data[di + 2] = baseArr[b + 2] + (wr[2] - baseArr[b + 2]) * w
                    }
                }
                ctx.putImageData(imgLocal, 0, 0)
            }

            const frame = (now: number) => {
                if (cols && rows && base && img) {
                    // expire the ripple once its front has crossed the whole frame
                    for (let i = ripples.length - 1; i >= 0; i--) {
                        const rp = ripples[i]
                        const front = (now - rp.t0) * 0.001 * rippleSpeed
                        if (front > rp.maxDist + ringWidth * 2) ripples.splice(i, 1)
                    }
                    if (ripples.length > 0) {
                        paint(now) // a ripple is crossing — only ever one at a time
                        wasActive = true
                    } else if (wasActive) {
                        // it just finished → wait an interval before the next, clear the frame
                        nextSpawn = now + rippleInterval * (0.6 + Math.random() * 0.8)
                        paint(now)
                        wasActive = false
                    } else if (now >= nextSpawn) {
                        spawn(now) // gap elapsed, nothing active → start the next one
                        paint(now)
                        wasActive = true
                    }
                }
                raf = requestAnimationFrame(frame)
            }
            raf = requestAnimationFrame(frame)
        }

        return () => {
            ro.disconnect()
            if (raf) cancelAnimationFrame(raf)
        }
    }, [stops, variant, tiltDeg, tilePx, tileAspect, mirror, mirrorBias, animate, rippleSpeed, rippleInterval, rippleColor, rippleStrength])

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
