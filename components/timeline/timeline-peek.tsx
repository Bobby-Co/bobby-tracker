"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { IconlyIcon } from "@/components/icons/iconly-icon"
import { DAY_MS } from "@/lib/client/timeline/scale"
import { pastelFor, ringFor } from "@/lib/client/timeline/palette"
import type { Issue, IssueStatus, ProjectLabelIcon, ProjectStatusColor } from "@/lib/shared/types"

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
                className="anim-fade group block rounded-[14px] border border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-3 py-3 text-[12px] text-[color:var(--c-text-muted)] hover:border-zinc-400 hover:text-[color:var(--c-text)]"
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
                />
            </div>

            <div className="mt-2 min-h-[14px] text-[10px] tabular-nums text-[color:var(--c-text-dim)]">
                {nowMs > 0 ? fmtRange(focalStart, focalEnd) : ""}
            </div>
        </Link>
    )
}

// Geometry is the playful board's own, evaluated at CELL = 32 (its 100% zoom),
// so a peek tile is the same object as a board tile — not a lookalike.
const CELL = 32
const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))
const RADIUS    = cl(CELL * 0.3, 8, 17)   // 9.6
const ICON_BOX  = cl(CELL * 0.4, 12, 22)  // 12.8
const ICON_SIZE = Math.round(cl(CELL * 0.24, 8, 13))
const TITLE_F   = cl(CELL * 0.3, 8, 15)   // 9.6
const NUM_F     = cl(CELL * 0.24, 7, 12)  // 7.68
const ROW_H     = CELL - cl(CELL * 0.09, 2, 6) * 2 // 26.24
const PAD_L     = Math.max(5, CELL * 0.13)
const ICON_GAP  = Math.max(8, CELL * 0.2)
const ICON_SLOT = PAD_L + ICON_BOX + ICON_GAP // 25.8
// Borrowed room, in px, so a short tile's label still reads — the board does the
// same thing in whole columns (MIN_TILE_COLS).
const MIN_LABEL_PX = 108

function PeekTile({
    item,
    windowStart,
    windowMs,
    isFocal,
    labelIconMap,
}: {
    item: Issue
    windowStart: number
    windowMs: number
    isFocal: boolean
    labelIconMap: Map<string, ProjectLabelIcon>
}) {
    if (!item.starts_at || !item.ends_at) return null
    const start = Date.parse(item.starts_at)
    const end   = Date.parse(item.ends_at)
    const leftPct  = Math.max(0, Math.min(100, ((start - windowStart) / windowMs) * 100))
    const rightPct = Math.max(0, Math.min(100, ((end - windowStart) / windowMs) * 100))
    const widthPct = Math.max(0, rightPct - leftPct)

    // Same pastel sticker as the board — hashed off the issue id, so a tile
    // keeps its colour between the peek and the full timeline.
    const { bg, fg } = pastelFor(item.id)
    const ring  = ringFor(fg)
    const faint = `color-mix(in srgb, ${fg} 7%, transparent)`
    const dash  = `color-mix(in srgb, ${fg} 34%, transparent)`
    const labelKey = item.labels[0]
    const iconName = labelKey ? labelIconMap.get(labelKey)?.icon_name ?? null : null

    const top = isFocal ? 6 : 44
    const z   = isFocal ? 10 : 1
    const op  = isFocal ? 1 : 0.72

    return (
        <>
            {/* Solid card — its width IS the duration. */}
            <div
                className="absolute"
                style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    top,
                    height: ROW_H,
                    zIndex: z,
                    opacity: op,
                    background: bg,
                    borderRadius: RADIUS,
                    boxShadow: isFocal
                        ? `0 0 0 1.5px ${ring}, 0 0 0 3px #ffffff, 0 3px 8px -3px ${ring}`
                        : `0 0 0 1.5px ${ring}, 0 3px 8px -3px ${ring}`,
                }}
            />
            {/* Detached, dashed, ghosted extension — the tile does NOT occupy
                this time; the room is only borrowed so the label stays legible. */}
            <div
                className="absolute"
                style={{
                    left: `calc(${leftPct}% + ${widthPct}% + 3px)`,
                    width: `max(0px, calc(${MIN_LABEL_PX}px - ${widthPct}% - 3px))`,
                    top,
                    height: ROW_H,
                    zIndex: z,
                    opacity: op,
                    borderRadius: RADIUS,
                    border: `1.5px dashed ${dash}`,
                    background: faint,
                }}
            />
            {/* Label spanning both pieces: icon slot, title, then #N. */}
            <div
                className="pointer-events-none absolute flex items-center overflow-hidden"
                style={{
                    left: `${leftPct}%`,
                    width: `max(${MIN_LABEL_PX}px, ${widthPct}%)`,
                    top,
                    height: ROW_H,
                    zIndex: z,
                    opacity: op,
                    color: fg,
                }}
            >
                <div
                    className="flex shrink-0 items-center"
                    style={{ width: ICON_SLOT, paddingLeft: PAD_L }}
                >
                    <span
                        className="grid shrink-0 place-items-center rounded-[7px]"
                        style={{ width: ICON_BOX, height: ICON_BOX, background: fg, boxShadow: `0 1px 2px ${ring}` }}
                    >
                        <IconlyIcon name={iconName} size={ICON_SIZE} color="#ffffff" secondColor="#ffffff" />
                    </span>
                </div>
                <span
                    className="min-w-0 flex-1 truncate font-extrabold leading-none"
                    style={{ fontSize: TITLE_F }}
                >
                    {item.title}
                </span>
                <span
                    className="shrink-0 pl-1 pr-2 font-mono font-bold opacity-45"
                    style={{ fontSize: NUM_F }}
                >
                    #{item.issue_number}
                </span>
            </div>
        </>
    )
}

function fmtRange(startMs: number, endMs: number): string {
    return `${RANGE_FMT.format(new Date(startMs))} → ${RANGE_FMT.format(new Date(endMs))}`
}
