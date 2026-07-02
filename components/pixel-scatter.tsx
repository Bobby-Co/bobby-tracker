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

// A pixelated corner gradient on a 48px lattice (same cell size as the
// landing's pixel gradient): ember tiles glow from the top-left and
// bottom-right corners and fade to white toward the centre, so most of the
// page stays clean for the copy. Tiles are seamless (no grid outline) and a
// few flicker occasionally. Static frame under prefers-reduced-motion.
type Corner = "tl" | "tr" | "bl" | "br"

export default function PixelScatter({
    cell = 48,
    fill = 0.13,
    corners = ["tl", "br"],
    reach = 0.72,
    falloff = 1,
    animate = true,
    className = "",
    onReady,
}: {
    cell?: number
    fill?: number
    /** Which corner(s) the ember glows from (default: the landing's TL + BR). */
    corners?: Corner[]
    /** How far the glow reaches along the diagonal from each lit corner
        (0 = corner only, 1 = all the way across). Lower = tighter to corners. */
    reach?: number
    /** Exponent on the corner weight (1 = linear). Higher packs tiles into a
        dense core that fades fast, cutting the stray outliers at the fringe. */
    falloff?: number
    /** When false, paint one static frame (no rAF) — use in always-on chrome. */
    animate?: boolean
    className?: string
    /** Fires once after the first real draw (non-zero canvas size) — lets callers
        delay an entry animation until there are actually pixels to reveal. */
    onReady?: () => void
}) {
    const ref = useRef<HTMLCanvasElement>(null)
    // Keep the latest onReady in a ref so it isn't an effect dependency (an inline
    // callback would otherwise rebuild the whole scatter every render).
    const onReadyRef = useRef(onReady)
    onReadyRef.current = onReady
    const firedRef = useRef(false)

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

            cells = []
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const seed = r * 73.13 + c * 19.71 + 1
                    const fx = cols > 1 ? c / (cols - 1) : 0
                    const fy = rows > 1 ? r / (rows - 1) : 0

                    // Corner weight: a pixelated gradient glowing from each
                    // selected corner (1 at the corner, 0 once `reach` of the
                    // diagonal away), fading out toward the rest of the canvas.
                    let cwLin = 0
                    for (const k of corners) {
                        const cx = k[1] === "l" ? 0 : 1
                        const cy = k[0] === "t" ? 0 : 1
                        cwLin = Math.max(cwLin, 1 - Math.min(1, Math.hypot(fx - cx, fy - cy) / reach))
                    }
                    // Curve the linear weight: falloff>1 packs the ember into a
                    // dense corner core that thins out fast toward the middle.
                    const cw = falloff === 1 ? cwLin : Math.pow(cwLin, falloff)

                    // Faint gray base only where the glow reaches; pure white
                    // (baseOp 0) through the centre.
                    const baseOp = cw * (0.05 + rand(seed * 11.3) * 0.05)

                    // Vivid ember tiles, denser toward the lit corners.
                    let amber: Amber | null = null
                    if (cw > 0.04 && rand(seed) <= fill * cw) {
                        amber = {
                            col: COLORS[Math.floor(rand(seed * 1.7) * COLORS.length)],
                            op: (0.5 + rand(seed * 2.3) * 0.45) * Math.min(1, 0.45 + cw),
                            // Only a few tiles flicker, each briefly dipping once
                            // every `period`s (staggered) — an occasional blink.
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

        // Fires onReady once the canvas actually has a size + a drawn frame, so a
        // caller's entry animation reveals real pixels rather than an empty box.
        const fireReady = () => {
            if (!firedRef.current && w && h) {
                firedRef.current = true
                onReadyRef.current?.()
            }
        }

        build()
        render(0)
        fireReady()

        let raf = 0
        if (!reduce && animate) {
            const loop = (t: number) => {
                render(t * 0.001)
                raf = requestAnimationFrame(loop)
            }
            raf = requestAnimationFrame(loop)
        }

        const ro = new ResizeObserver(() => {
            build()
            // Repaint the static frame after a resize whenever the rAF loop
            // isn't running (reduced-motion OR animate=false).
            if (reduce || !animate) render(0)
            fireReady()
        })
        ro.observe(host)

        return () => {
            ro.disconnect()
            if (raf) cancelAnimationFrame(raf)
        }
    }, [cell, fill, reach, falloff, animate, corners.join(",")])

    return (
        <canvas
            ref={ref}
            aria-hidden
            className={className}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
    )
}
