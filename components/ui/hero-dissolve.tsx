"use client"

import { useEffect, useRef } from "react"

// Scroll-driven pixel dissolve for the landing hero.
//
// The hero pins while the reader scrolls a runway beneath it; across that
// runway this canvas lays tiles of the NEXT section's colour over the ember
// pixel field in an expanding ripple, so the hero has already become that
// section by the time it unpins. The colour change happens on screen, as a
// moment, instead of being cut at a section edge.
//
// It publishes two vars on the runway: `--hero-s` (raw scroll) and `--hero-p`
// (dissolve travel). The field recolours to the dark palette during --hero-s
// BEFORE the ripple starts, so the dissolve never eats a still-changing field.
//
// The ripple deliberately stops short of full coverage (see `keep`): the
// wavefront runs out of energy before it reaches the edges, leaving a scattered
// ember fringe at the periphery. Erasing every last tile would read as the
// brand texture being wiped; leaving a residue keeps it present as the hero
// scrolls away.
//
// Same 48px lattice as PixelGradient/PixelScatter so the tiles land exactly on
// the ember blocks they're covering. Tiles are painted (not masked) because the
// gradient underneath keeps animating its own ripples — masking would fight it.

// Deterministic jitter — keeps the dissolve edge scattered (a pixel wavefront,
// not a clean circle) while surviving resizes without Math.random.
const rand = (s: number) => {
    const x = Math.sin(s) * 43758.5453
    return x - Math.floor(x)
}

export default function HeroDissolve({
    /** Page/hero background the tiles dissolve to. */
    color = "#fffae8",
    cell = 48,
    /** Point in the runway where the dissolve begins. The stretch before it is
        the palette shift — the field recolours from light ember to dark ember
        first, so the ripple eats a field that already matches its destination. */
    startAt = 0.42,
    /** Point in the runway where the dissolve finishes; the rest is a beat of
        calm before the hero unpins. */
    completeAt = 0.92,
    /** Fraction of tiles that never dissolve — the ember residue left behind.
        Derived as a quantile of the tile thresholds, so the amount holds no
        matter the viewport size. */
    keep = 0.06,
    className = "",
}: {
    color?: string
    cell?: number
    startAt?: number
    completeAt?: number
    keep?: number
    className?: string
}) {
    const ref = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = ref.current
        const host = canvas?.parentElement
        if (!canvas || !host) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        // The scroll runway is the tall wrapper the sticky hero sits inside.
        const runway = host.closest<HTMLElement>("[data-hero-runway]") ?? host

        let cols = 0
        let rows = 0
        let w = 0
        let h = 0
        let thresholds: Float32Array | null = null
        // Progress ceiling: the threshold below which `1 - keep` of the tiles
        // fall, so the wavefront stalls with exactly `keep` still ember.
        let cap = 1
        let raf = 0
        let last = -1

        // Per-tile dissolve threshold: mostly distance from the ripple origin
        // (so it reads as an expanding front) plus jitter (so the edge is
        // pixelated). A tile turns pale once progress passes its threshold.
        const build = () => {
            w = host.clientWidth
            h = host.clientHeight
            if (!w || !h) return
            canvas.width = w
            canvas.height = h
            cols = Math.ceil(w / cell)
            rows = Math.ceil(h / cell)
            thresholds = new Float32Array(cols * rows)

            const ox = 0.5
            const oy = 0.55 // just below centre — roughly where the eye rests
            let maxd = 0
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const fx = cols > 1 ? c / (cols - 1) : 0
                    const fy = rows > 1 ? r / (rows - 1) : 0
                    const d = Math.hypot(fx - ox, fy - oy)
                    if (d > maxd) maxd = d
                }
            }
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const fx = cols > 1 ? c / (cols - 1) : 0
                    const fy = rows > 1 ? r / (rows - 1) : 0
                    const d = Math.hypot(fx - ox, fy - oy) / (maxd || 1)
                    thresholds[r * cols + c] = Math.min(
                        1,
                        d * 0.62 + rand(r * 73.13 + c * 19.71 + 1) * 0.38,
                    )
                }
            }

            // Quantile of the thresholds — capping progress here leaves the
            // top `keep` fraction untouched. Taking it from the real values
            // (rather than a fixed number) keeps the residue constant across
            // aspect ratios, where the threshold spread shifts.
            const sorted = Float32Array.from(thresholds).sort()
            const idx = Math.floor((1 - keep) * (sorted.length - 1))
            cap = sorted[idx < 0 ? 0 : idx]
            last = -1
        }

        const draw = (p: number) => {
            if (!thresholds) return
            ctx.clearRect(0, 0, w, h)
            ctx.fillStyle = color
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const t = thresholds[r * cols + c]
                    // Soft leading edge: a tile eases in over a short band of
                    // progress rather than snapping to opaque.
                    const a = (p - t) / 0.09
                    if (a <= 0) continue
                    ctx.globalAlpha = a >= 1 ? 1 : a
                    ctx.fillRect(c * cell, r * cell, cell, cell)
                }
            }
            ctx.globalAlpha = 1
        }

        // Raw travel through the runway, 0..1.
        const scrollProgress = () => {
            const rect = runway.getBoundingClientRect()
            const span = rect.height - window.innerHeight
            if (span <= 0) return 0
            const raw = -rect.top / span
            return raw < 0 ? 0 : raw > 1 ? 1 : raw
        }

        // Dissolve travel, 0..1 — held at 0 through the palette-shift stretch so
        // the ripple only starts once the field has finished recolouring.
        const dissolveProgress = (s: number) => {
            const d = (s - startAt) / Math.max(0.0001, completeAt - startAt)
            return d < 0 ? 0 : d > 1 ? 1 : d
        }

        // Two signals, because the hero has two phases and they must not be
        // driven off the same number:
        //   --hero-s  raw scroll — recolouring the field, retiring the copy
        //   --hero-p  the dissolve itself — the hole, and the type rising in it
        const publish = (s: number, u: number) => {
            runway.style.setProperty("--hero-s", String(s))
            runway.style.setProperty("--hero-p", String(u))
        }

        const render = () => {
            const s = scrollProgress()
            publish(s, dissolveProgress(s))
            draw(dissolveProgress(s) * cap)
        }

        const onScroll = () => {
            if (raf) return
            raf = requestAnimationFrame(() => {
                raf = 0
                const s = scrollProgress()
                // Dedupe on raw scroll: the palette phase needs updates even
                // while the dissolve is still parked at 0.
                if (Math.abs(s - last) < 0.002 && s !== 0 && s !== 1) return
                last = s
                const u = dissolveProgress(s)
                publish(s, u)
                draw(u * cap)
            })
        }

        build()
        render()

        const ro = new ResizeObserver(() => {
            build()
            render()
        })
        ro.observe(host)
        window.addEventListener("scroll", onScroll, { passive: true })

        return () => {
            if (raf) cancelAnimationFrame(raf)
            ro.disconnect()
            window.removeEventListener("scroll", onScroll)
        }
    }, [color, cell, startAt, completeAt, keep])

    return (
        <canvas
            ref={ref}
            aria-hidden
            className={className}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
    )
}
