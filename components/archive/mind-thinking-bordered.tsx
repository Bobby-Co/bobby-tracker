"use client"

// ARCHIVED — the animated-border "thinking card" (soft ember/indigo segments
// rocking around a rounded-rect border, with a width-morphing card). Superseded
// by the dark orb + shimmer-text indicator in components/mind-thinking.tsx.
// Kept for reference / easy revival; not imported anywhere.

import { useLayoutEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useAnimationFrame } from "framer-motion"

export interface Progress {
    stage: string
    detail: string
}

const STAGES: { key: string; label: string }[] = [
    { key: "planning", label: "Planning" },
    { key: "exploring", label: "Exploring" },
    { key: "grounding", label: "Grounding" },
    { key: "pinpointing", label: "Reading code" },
    { key: "synthesizing", label: "Writing answer" },
]

function stageLabel(stage: string): string {
    return STAGES.find((s) => s.key === stage)?.label ?? "Thinking"
}

const CARD_RADIUS = 15
const EMBER = "233,115,15"
const INDIGO = "122,92,255"
const SWING_K = 0.9
const SWING_ASIN = Math.asin(SWING_K)
const PERIOD = 2.6
const L_CORE = 40
const ROCK = 46

const CARD_CLS =
    "flex items-center gap-2.5 rounded-[15px] border border-[color:var(--c-border)] bg-white p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.05)]"

function ringGeom(w: number, h: number) {
    const x0 = 1
    const y0 = 1
    const x1 = w - 1
    const y1 = h - 1
    const rr = Math.max(0, Math.min(CARD_RADIUS, (Math.min(w, h) - 2) / 2))
    const d = `M ${x0 + rr} ${y0} H ${x1 - rr} A ${rr} ${rr} 0 0 1 ${x1} ${y0 + rr} V ${y1 - rr} A ${rr} ${rr} 0 0 1 ${x1 - rr} ${y1} H ${x0 + rr} A ${rr} ${rr} 0 0 1 ${x0} ${y1 - rr} V ${y0 + rr} A ${rr} ${rr} 0 0 1 ${x0 + rr} ${y0} Z`
    const sx = x1 - x0 - 2 * rr
    const sy = y1 - y0 - 2 * rr
    const a = (Math.PI / 2) * rr
    const P = 2 * sx + 2 * sy + 4 * a
    const dcE = P - a / 2
    const dcI = sx + a + sy + a / 2
    return { d, P, dcE, dcI }
}

export function ThinkingCardBordered({ progress }: { progress: Progress }) {
    const text = progress.detail || stageLabel(progress.stage)

    const cardRef = useRef<HTMLDivElement>(null)
    const ghostRef = useRef<HTMLDivElement>(null)
    const svgRef = useRef<SVGSVGElement>(null)
    const emberCore = useRef<SVGPathElement>(null)
    const indigoCore = useRef<SVGPathElement>(null)
    const phase = useRef(0)

    const [cardW, setCardW] = useState<number | null>(null)
    useLayoutEffect(() => {
        if (ghostRef.current) setCardW(ghostRef.current.offsetWidth)
    }, [text])

    useAnimationFrame((_, delta) => {
        const card = cardRef.current
        if (!card) return
        const rect = card.getBoundingClientRect()
        const w = rect.width
        const h = rect.height
        if (!w || !h) return

        phase.current = (phase.current + delta / 1000 / PERIOD) % 1
        const n = Math.asin(SWING_K * Math.sin(phase.current * Math.PI * 2)) / SWING_ASIN

        const { d, P, dcE, dcI } = ringGeom(w, h)
        svgRef.current?.setAttribute("viewBox", `0 0 ${w} ${h}`)
        const set = (el: SVGPathElement | null, L: number, dc: number) => {
            if (!el) return
            el.setAttribute("d", d)
            el.setAttribute("stroke-dasharray", `${L} ${P}`)
            el.setAttribute("stroke-dashoffset", `${L / 2 - (dc + n * ROCK)}`)
        }
        set(emberCore.current, L_CORE, dcE)
        set(indigoCore.current, L_CORE, dcI)
    })

    return (
        <div className="relative inline-block max-w-full">
            <div ref={ghostRef} aria-hidden className={`${CARD_CLS} pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap`}>
                <span className="h-2 w-2 shrink-0" />
                <span className="text-[13px] font-medium">{text}</span>
            </div>

            <div
                ref={cardRef}
                className={`relative overflow-hidden ${CARD_CLS}`}
                style={{ width: cardW ?? "auto", transition: "width 380ms cubic-bezier(0.22,1,0.36,1)" }}
            >
                <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--c-primary)] opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--c-primary)]" />
                </span>
                <div className="min-w-0 flex-1">
                    <AnimatePresence mode="wait">
                        <motion.p
                            key={text}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                            className="truncate text-[13px] font-medium text-[color:var(--c-text)]"
                        >
                            {text}
                        </motion.p>
                    </AnimatePresence>
                </div>
            </div>

            <svg ref={svgRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" fill="none">
                <path ref={emberCore} stroke={`rgb(${EMBER})`} strokeWidth={2} strokeLinecap="round" />
                <path ref={indigoCore} stroke={`rgb(${INDIGO})`} strokeWidth={2} strokeLinecap="round" />
            </svg>
        </div>
    )
}
