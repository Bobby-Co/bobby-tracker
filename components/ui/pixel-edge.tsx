"use client"

import { useEffect, useRef } from "react"

// A pixel dither between two flat colours, on the same 48px lattice as the
// hero. Tiles of `color` are painted with a probability that falls from 1 to 0
// across the band, so the block breaks apart into scattered pixels instead of
// ramping like a gradient — the transition stays in the product's pixel
// language. Used to bring the dark manifesto section back out to the cream
// page, mirroring the ripple that took the hero into it.
//
// Static: it never animates, so it costs one paint and needs no scroll wiring.

const rand = (s: number) => {
    const x = Math.sin(s) * 43758.5453
    return x - Math.floor(x)
}

export default function PixelEdge({
    /** The colour breaking apart (i.e. the section being left behind). */
    color = "#0b090b",
    cell = 48,
    /** "down" = solid at the top, dissolving toward the bottom. */
    direction = "down",
    /** Shapes the falloff. >1 holds the solid edge longer before scattering. */
    bias = 1.35,
    className = "",
}: {
    color?: string
    cell?: number
    direction?: "down" | "up"
    bias?: number
    className?: string
}) {
    const ref = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = ref.current
        const host = canvas?.parentElement
        if (!canvas || !host) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const draw = () => {
            const w = host.clientWidth
            const h = host.clientHeight
            if (!w || !h) return
            canvas.width = w
            canvas.height = h
            const cols = Math.ceil(w / cell)
            const rows = Math.ceil(h / cell)

            ctx.clearRect(0, 0, w, h)
            ctx.fillStyle = color

            for (let r = 0; r < rows; r++) {
                // t: 0 at the solid edge → 1 at the open edge
                const raw = rows > 1 ? r / (rows - 1) : 0
                const t = direction === "down" ? raw : 1 - raw
                const coverage = Math.pow(1 - t, bias)
                for (let c = 0; c < cols; c++) {
                    if (rand(r * 73.13 + c * 19.71 + 1) < coverage) {
                        ctx.fillRect(c * cell, r * cell, cell, cell)
                    }
                }
            }
        }

        draw()
        const ro = new ResizeObserver(draw)
        ro.observe(host)
        return () => ro.disconnect()
    }, [color, cell, direction, bias])

    return (
        <canvas
            ref={ref}
            aria-hidden
            className={className}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
    )
}
