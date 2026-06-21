"use client"

import { useEffect, useRef } from "react"
import { EMBER_STOPS } from "@/components/pixel-gradient"

// Same palette as the landing's pixel gradient — its saturated ember stops
// (deep amber-orange → light gold). The pale cream/white stops are dropped:
// they'd vanish on the white page.
const COLORS: [number, number, number][] = EMBER_STOPS.slice(0, 5).map((s) => s.c)

// Deterministic pseudo-random in [0,1) from a seed — a stable scatter that
// survives re-renders/resizes without Math.random.
const rand = (s: number) => {
    const x = Math.sin(s) * 43758.5453
    return x - Math.floor(x)
}

// A full-bleed pixel field on a 48px lattice (same cell size as the landing's
// pixel gradient): a scattered subset of cells filled in yellow-amber tones —
// some gently twinkling — with every other cell left transparent (the page
// white shows through). No grid outline. Fills thin out toward the centre so
// centred copy stays readable. Static frame under prefers-reduced-motion.
export default function PixelScatter({
    cell = 48,
    fill = 0.13,
    className = "",
}: {
    cell?: number
    fill?: number
    className?: string
}) {
    const ref = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = ref.current
        const host = canvas?.parentElement
        if (!canvas || !host) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

        type Amber = {
            col: [number, number, number]
            op: number
            tw: boolean
            amp: number
            phase: number
            period: number
        }
        // Every cell carries a faint gray base (so the pixel lattice reads even
        // in the empty space); some cells also carry an amber fill on top.
        type Cell = { x: number; y: number; baseOp: number; amber: Amber | null }
        let cells: Cell[] = []
        let w = 0
        let h = 0

        const build = () => {
            w = host.clientWidth
            h = host.clientHeight
            if (!w || !h) return
            const dpr = Math.min(2, window.devicePixelRatio || 1)
            canvas.width = Math.round(w * dpr)
            canvas.height = Math.round(h * dpr)
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

            const cols = Math.ceil(w / cell) + 1
            const rows = Math.ceil(h / cell) + 1
            const cx = (cols - 1) / 2
            const cy = (rows - 1) / 2
            const maxd = Math.hypot(cx, cy) || 1

            cells = []
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const seed = r * 73.13 + c * 19.71 + 1
                    const d = Math.hypot(c - cx, r - cy) / maxd

                    // Faint warm-gray base for EVERY cell: a per-cell jitter
                    // makes the pixel lattice legible, and a gentle ramp toward
                    // the edges reads as a soft gray gradient. Kept lightest in
                    // the centre so the copy stays clean.
                    const baseOp = Math.min(0.12, 0.03 + d * 0.055 + rand(seed * 11.3) * 0.04)

                    // A scattered subset also gets a vivid ember tile on top.
                    // Tiles thin out toward the centre by COUNT (lower spawn
                    // chance), not by fading — so the ones that appear stay
                    // saturated like the landing rather than washing out.
                    let amber: Amber | null = null
                    const centre = Math.min(1, Math.max(0, (d - 0.14) / 0.3))
                    if (centre > 0 && rand(seed) <= fill * (0.2 + 0.8 * centre)) {
                        amber = {
                            col: COLORS[Math.floor(rand(seed * 1.7) * COLORS.length)],
                            op: 0.62 + rand(seed * 2.3) * 0.38,
                            // Only a few tiles flicker, and each just briefly
                            // dips once every `period` seconds (staggered by
                            // `phase`) — an occasional blink, not constant noise.
                            tw: rand(seed * 3.9) < 0.28,
                            amp: 0.45 + rand(seed * 5.1) * 0.4,
                            phase: rand(seed * 6.7),
                            period: 4 + rand(seed * 8.3) * 5,
                        }
                    }

                    cells.push({ x: c * cell, y: r * cell, baseOp, amber })
                }
            }
        }

        const render = (tSec: number) => {
            if (!w || !h) return
            ctx.clearRect(0, 0, w, h)

            for (const c of cells) {
                // base gray pixel — full cell, no gap, so the lattice reads as a
                // soft texture rather than an outlined grid.
                ctx.fillStyle = `rgba(150,140,122,${c.baseOp})`
                ctx.fillRect(c.x, c.y, cell, cell)

                // amber tile on top — fills the whole cell so adjacent tiles
                // touch with no gap/border between pixels.
                if (c.amber) {
                    let op = c.amber.op
                    if (c.amber.tw && !reduce) {
                        // Steady most of the time; a single short dip near the
                        // start of each `period`, then back to full. Staggered
                        // phases mean tiles blink one at a time.
                        const cyc = (((tSec / c.amber.period + c.amber.phase) % 1) + 1) % 1
                        const blinkFrac = 0.08
                        let level = 1
                        if (cyc < blinkFrac) {
                            level = 1 - c.amber.amp * Math.sin(Math.PI * (cyc / blinkFrac))
                        }
                        op = c.amber.op * level
                    }
                    ctx.fillStyle = `rgba(${c.amber.col[0]},${c.amber.col[1]},${c.amber.col[2]},${op})`
                    ctx.fillRect(c.x, c.y, cell, cell)
                }
            }
        }

        build()
        render(0)

        let raf = 0
        if (!reduce) {
            const loop = (t: number) => {
                render(t * 0.001)
                raf = requestAnimationFrame(loop)
            }
            raf = requestAnimationFrame(loop)
        }

        const ro = new ResizeObserver(() => {
            build()
            if (reduce) render(0)
        })
        ro.observe(host)

        return () => {
            ro.disconnect()
            if (raf) cancelAnimationFrame(raf)
        }
    }, [cell, fill])

    return (
        <canvas
            ref={ref}
            aria-hidden
            className={className}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
    )
}
