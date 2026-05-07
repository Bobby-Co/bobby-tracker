"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { IconlyIcon } from "@/components/iconly-icon"
import { DAY_MS } from "@/lib/timeline/scale"
import { DEFAULT_STATUS_COLORS, isDarkColor } from "@/lib/timeline/colors"
import type { Issue, IssueStatus, ProjectLabelIcon, ProjectStatusColor } from "@/lib/supabase/types"

const RANGE_FMT = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
})

const WINDOW_DAYS = 14

// TimelinePeek — read-only mini timeline rendered inside the
// issue detail aside. Frames a 14-day window centred on the
// focal issue so neighbouring tiles flank it. Click anywhere on
// the card to open the full timeline route, focused on this
// issue.
export function TimelinePeek({
    projectId,
    issue,
    others,
    labelIcons,
    statusColors,
}: {
    projectId: string
    issue: Issue
    /** Other issues in the project. May include scheduled and
     *  unscheduled rows; we filter to scheduled rows that fall
     *  inside the peek window. The current issue is allowed to be
     *  in this list — we de-dupe by id. */
    others: Issue[]
    labelIcons: ProjectLabelIcon[]
    statusColors: ProjectStatusColor[]
}) {
    // Hooks first — react-hooks/rules-of-hooks forbids any
    // conditional return above this block. Wall-clock + locale-
    // formatted text only render after mount so SSR and the
    // first hydration render match. nowMs > 0 doubles as our
    // "mounted" signal.
    const [nowMs, setNowMs] = useState(0)
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setNowMs(Date.now())
    }, [])

    const labelIconMap = new Map(labelIcons.map((i) => [i.label, i]))
    const colorOverrides: Partial<Record<IssueStatus, string>> = {}
    for (const c of statusColors) colorOverrides[c.status] = c.color

    const isScheduled = !!(issue.starts_at && issue.ends_at)

    if (!isScheduled) {
        return (
            <Link
                href={`/projects/${projectId}/timeline`}
                className="anim-fade group block rounded-[14px] border border-dashed border-[color:var(--c-border)] bg-white px-3 py-3 text-[12px] text-[color:var(--c-text-muted)] hover:border-zinc-400 hover:text-[color:var(--c-text)]"
            >
                <div className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.12em]">
                    Timeline
                </div>
                <div className="flex items-center justify-between gap-2">
                    <span>Not scheduled yet.</span>
                    <span className="text-[11px] font-semibold underline-offset-2 group-hover:underline">
                        Open timeline ↗
                    </span>
                </div>
            </Link>
        )
    }

    const focalStart = Date.parse(issue.starts_at!)
    const focalEnd   = Date.parse(issue.ends_at!)
    const focalMid   = (focalStart + focalEnd) / 2
    const windowStart = focalMid - (WINDOW_DAYS / 2) * DAY_MS
    const windowEnd   = focalMid + (WINDOW_DAYS / 2) * DAY_MS
    const windowMs    = windowEnd - windowStart

    // De-dupe self, keep only neighbours that overlap the window.
    const neighbours = others.filter((o) =>
        o.id !== issue.id &&
        o.starts_at && o.ends_at &&
        Date.parse(o.starts_at) < windowEnd &&
        Date.parse(o.ends_at) > windowStart,
    )

    const todayInWindow = nowMs > 0 && nowMs >= windowStart && nowMs <= windowEnd

    return (
        <Link
            href={`/projects/${projectId}/timeline?focus=${issue.id}`}
            className="anim-fade group block rounded-[14px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] p-3 transition-colors hover:bg-[color:var(--c-overlay)]"
        >
            <div className="mb-2 flex items-center justify-between text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                <span>Timeline</span>
                <span className="font-semibold normal-case tracking-normal text-[10.5px] text-[color:var(--c-text-muted)] group-hover:text-[color:var(--c-text)]">
                    Open ↗
                </span>
            </div>

            <div className="relative h-20 overflow-hidden">
                {/* Centre line — marks the focal issue's mid-point. */}
                <div className="pointer-events-none absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-zinc-300" />

                {/* Today marker — only shown if "now" falls inside
                    the visible window. Dashed red dotted line for
                    consistency with the full timeline. */}
                {todayInWindow && (
                    <div
                        className="pointer-events-none absolute top-0 bottom-0 w-px"
                        style={{
                            left: `${((nowMs - windowStart) / windowMs) * 100}%`,
                            backgroundImage: "linear-gradient(to bottom, #ef4444 0 4px, transparent 4px 8px)",
                            backgroundSize: "100% 8px",
                        }}
                    />
                )}

                {neighbours.map((n) => (
                    <PeekTile
                        key={n.id}
                        item={n}
                        windowStart={windowStart}
                        windowMs={windowMs}
                        isFocal={false}
                        labelIconMap={labelIconMap}
                        colorOverrides={colorOverrides}
                    />
                ))}
                {/* Focal rendered last so it stacks above the
                    neighbours when their pills overlap. */}
                <PeekTile
                    item={issue}
                    windowStart={windowStart}
                    windowMs={windowMs}
                    isFocal
                    labelIconMap={labelIconMap}
                    colorOverrides={colorOverrides}
                />
            </div>

            <div className="mt-2 min-h-[14px] text-[10px] tabular-nums text-[color:var(--c-text-dim)]">
                {nowMs > 0 ? fmtRange(focalStart, focalEnd) : ""}
            </div>
        </Link>
    )
}

function PeekTile({
    item,
    windowStart,
    windowMs,
    isFocal,
    labelIconMap,
    colorOverrides,
}: {
    item: Issue
    windowStart: number
    windowMs: number
    isFocal: boolean
    labelIconMap: Map<string, ProjectLabelIcon>
    colorOverrides: Partial<Record<IssueStatus, string>>
}) {
    if (!item.starts_at || !item.ends_at) return null
    const start = Date.parse(item.starts_at)
    const end   = Date.parse(item.ends_at)
    // Pill anchors at start, regardless of how short the duration
    // is, and keeps its intrinsic width so the icon + #N are
    // always readable. The bar below is what carries the duration
    // — it scales with widthPct and can be narrower than the pill.
    const leftPct  = Math.max(0, Math.min(100, ((start - windowStart) / windowMs) * 100))
    const rightPct = Math.max(0, Math.min(100, ((end - windowStart) / windowMs) * 100))
    const widthPct = Math.max(0, rightPct - leftPct)
    const fill = item.color ?? colorOverrides[item.status] ?? DEFAULT_STATUS_COLORS[item.status]
    const fg = isDarkColor(fill) ? "#ffffff" : "#0a0a0a"
    const labelKey = item.labels[0]
    const iconName = labelKey ? labelIconMap.get(labelKey)?.icon_name ?? null : null

    // Two-row layout: focal on the top row, neighbours on the
    // bottom row. Vertical positions are explicit pixels so they
    // line up regardless of overlap density.
    const pillTop = isFocal ? 4  : 44
    const barTop  = isFocal ? 26 : 66
    const z       = isFocal ? 10 : 1
    const opacity = isFocal ? 1  : 0.7

    return (
        <>
            <div
                className="absolute flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-1.5"
                style={{
                    left: `${leftPct}%`,
                    top: pillTop,
                    background: fill,
                    color: fg,
                    opacity,
                    zIndex: z,
                    boxShadow: isFocal
                        ? `0 0 0 1.5px #ffffff, 0 0 0 3px ${fill}, 0 1px 3px rgba(0,0,0,0.1)`
                        : undefined,
                }}
            >
                <IconlyIcon name={iconName} size={11} />
                <span className="font-mono text-[10px] font-bold opacity-90">#{item.issue_number}</span>
            </div>
            <div
                className="absolute h-1 rounded-full"
                style={{
                    left: `${leftPct}%`,
                    width: `${Math.max(0.5, widthPct)}%`,
                    top: barTop,
                    background: fill,
                    opacity: isFocal ? 0.85 : 0.4,
                    zIndex: z,
                }}
            />
        </>
    )
}

function fmtRange(startMs: number, endMs: number): string {
    return `${RANGE_FMT.format(new Date(startMs))} → ${RANGE_FMT.format(new Date(endMs))}`
}
