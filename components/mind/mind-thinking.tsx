"use client"

import { AnimatePresence, motion } from "framer-motion"

// Progress is the single "current state" of a thinking turn, streamed from the
// analyser: a stage key + a human-readable detail line.
export interface Progress {
    stage: string // planning | exploring | grounding | pinpointing | synthesizing
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

// ThinkingCard is the state shown while Bobby works: a soft dark orb that
// breathes (with a faint sheen drifting across it) beside the current-state line,
// which shimmers as it streams. No box — just the mark and the text.
export function ThinkingCard({ progress }: { progress: Progress }) {
    const text = progress.detail || stageLabel(progress.stage)
    return (
        <div className="flex items-center gap-3">
            <Orb />
            <div className="min-w-0 flex-1">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={text}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="min-w-0"
                    >
                        <ShimmerText>{text}</ShimmerText>
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    )
}

// Orb — the pre-rendered liquid-orb animation (an animated WebP in /public).
// Served as a plain <img> so the browser plays the animation frames; Next's
// <Image> would re-encode and drop the animation.
function Orb() {
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src="/brand_loader.webp"
            alt=""
            aria-hidden
            draggable={false}
            className="h-10 w-10 shrink-0 select-none object-contain"
        />
    )
}

// ShimmerText — a soft highlight band sweeps across the line (a moving clipped
// gradient, via CSS keyframes) so the current-state text feels live while
// streaming.
function ShimmerText({ children }: { children: React.ReactNode }) {
    return (
        <span
            className="block truncate bg-clip-text text-[13px] font-medium text-transparent"
            style={{
                backgroundImage:
                    "linear-gradient(90deg, var(--c-text-dim) 0%, var(--c-text-dim) 35%, var(--c-text) 50%, var(--c-text-dim) 65%, var(--c-text-dim) 100%)",
                backgroundSize: "220% 100%",
                WebkitBackgroundClip: "text",
                animation: "mind-shimmer 1.9s linear infinite",
            }}
        >
            {children}
        </span>
    )
}
