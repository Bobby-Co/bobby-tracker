"use client"

import { useEffect, useState } from "react"

// The "analysing" visual, shared by every surface that waits on an analyser run
// (the issue-detail suggestion card and the timeline drawer). Rendered for as
// long as a run is in flight — see lib/client/hooks/use-investigation.ts, which
// owns when that is.

// The phases the analyser walks through, surfaced as a ticker so the wait
// reads as visible progress rather than a dead spinner. The analyser POST is
// synchronous (no streamed progress events), so these are time-paced rather
// than wired to real telemetry — hence the last phase deliberately LINGERS
// until the row actually lands, so we never claim "done" ahead of the result.
const ANALYSING_PHASES = [
    "Reading the codebase graph",
    "Locating relevant files",
    "Tracing call paths & symbols",
    "Ranking the likeliest suspects",
    "Composing the fix prompt",
]

export function Analysing({ compact = false }: { compact?: boolean }) {
    const [phase, setPhase] = useState(0)

    useEffect(() => {
        // Stop on the final phase — it holds until the real suggestion arrives
        // and this whole component unmounts. Each step is a touch slower than
        // the last so early steps feel snappy and the tail doesn't outrun a
        // fast response.
        if (phase >= ANALYSING_PHASES.length - 1) return
        const id = setTimeout(() => setPhase((p) => p + 1), 3000 + phase * 700)
        return () => clearTimeout(id)
    }, [phase])

    return (
        <div className={`anim-fade flex flex-col items-center gap-4 ${compact ? "mt-3 py-3" : "mt-4 py-6"}`}>
            <GraphScan />
            <div className="flex items-center gap-2 text-[13px] font-medium text-[color:var(--c-text-muted)]">
                <SmallSpinner />
                {/* keyed so anim-fade replays on every phase change → soft crossfade */}
                <span key={phase} className="anim-fade">{ANALYSING_PHASES[phase]}…</span>
            </div>
        </div>
    )
}

// Static graph layout for the scan visual. A connected graph stands in for
// "the codebase graph being read"; ALL motion lives in CSS (see .graph-scan in
// globals.css): nodes pulse, sonar rings expand, glints run along edges, and a
// two-layer camera rig flies over the whole thing — zoom → pan → tilt → zoom
// out. Coordinates are tuned to the 400×200 viewBox; the camera keyframes are
// derived from these node positions, so retuning the layout means retuning the
// pan keyframes too (t = scale × (centre − focal point)).
const GRAPH_NODES = [
    { x: 45, y: 95 },
    { x: 95, y: 52 },
    { x: 90, y: 145 },
    { x: 135, y: 100 },
    { x: 175, y: 65 },
    { x: 205, y: 120 },
    { x: 235, y: 42 },
    { x: 225, y: 165 },
    { x: 270, y: 105 },
    { x: 305, y: 70 },
    { x: 350, y: 115 },
    { x: 320, y: 165 },
    { x: 368, y: 52 },
]
const GRAPH_EDGES: [number, number][] = [
    [0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5], [4, 6], [5, 7], [5, 8],
    [7, 8], [8, 9], [8, 10], [9, 12], [10, 11], [10, 12], [6, 9],
]

function GraphScan() {
    return (
        <svg
            className="graph-scan w-full max-w-[360px]"
            viewBox="0 0 400 200"
            fill="none"
            role="img"
            aria-label="Analysing the codebase graph"
        >
            <defs>
                <linearGradient id="graph-accent" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#d946ef" />
                    <stop offset="50%" stopColor="#0ea5e9" />
                    <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
                {/* Vignette: keeps the centre crisp and fades the edges out so the
                    camera framing reads as a viewport and blends into the card on
                    any background. Lives OUTSIDE the animated groups, so it stays
                    fixed to the frame while the graph flies behind it. */}
                <radialGradient id="graph-fade" cx="50%" cy="50%" r="60%">
                    <stop offset="52%" stopColor="#fff" />
                    <stop offset="100%" stopColor="#000" />
                </radialGradient>
                <mask id="graph-mask">
                    <rect width="400" height="200" fill="url(#graph-fade)" />
                </mask>
            </defs>

            <g mask="url(#graph-mask)">
                {/* Outer = tilt (rotates the scene around centre); inner = pan/zoom
                    (centres a focal point and scales in). Splitting them keeps each
                    motion's maths independent and lets the two run on out-of-sync
                    periods so the tour never settles into an obvious loop. */}
                <g className="graph-tilt">
                    <g className="graph-pan">
                        {/* Faint static skeleton of the graph */}
                        {GRAPH_EDGES.map(([a, b], i) => (
                            <line
                                key={`base-${i}`}
                                x1={GRAPH_NODES[a].x} y1={GRAPH_NODES[a].y}
                                x2={GRAPH_NODES[b].x} y2={GRAPH_NODES[b].y}
                                className="stroke-zinc-200"
                                strokeWidth={1.5}
                            />
                        ))}

                        {/* Glints travelling along each edge — staggered via --i */}
                        {GRAPH_EDGES.map(([a, b], i) => (
                            <line
                                key={`flow-${i}`}
                                x1={GRAPH_NODES[a].x} y1={GRAPH_NODES[a].y}
                                x2={GRAPH_NODES[b].x} y2={GRAPH_NODES[b].y}
                                className="gedge-flow"
                                stroke="url(#graph-accent)"
                                strokeWidth={1.75}
                                strokeLinecap="round"
                                style={{ ["--i" as string]: i } as React.CSSProperties}
                            />
                        ))}

                        {/* Nodes: a pulsing dot wrapped in an expanding sonar ring */}
                        {GRAPH_NODES.map((n, i) => (
                            <g key={`node-${i}`} style={{ ["--i" as string]: i } as React.CSSProperties}>
                                <circle className="gsonar" cx={n.x} cy={n.y} r={5} fill="none" stroke="url(#graph-accent)" strokeWidth={1.25} />
                                <circle className="gnode" cx={n.x} cy={n.y} r={4} fill="url(#graph-accent)" />
                            </g>
                        ))}
                    </g>
                </g>
            </g>
        </svg>
    )
}

export function SmallSpinner() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
    )
}
