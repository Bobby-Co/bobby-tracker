// Grid coordinate helpers for the board planning view.
//
// The board works in DISCRETE cells: each column is one day, each row
// is a lane. Tasks are bricks that occupy whole cells — a duration is a
// count of columns, a lane is a row.
//
// On-disk state is continuous (starts_at / ends_at ISO strings + lane_y
// 0..1, the shape the DB constrains) — these helpers are the bridge
// between that storage and the snapped grid.

import type { Issue } from "@/lib/shared/types"
import { DAY_MS } from "./scale"

export const CELL = 32              // px — square baseplate cell (at 100% zoom)
export const MIN_COLS = 56          // never render a cramped board
export const PAST_PAD_DAYS = 3      // runway before the earliest task
export const FUTURE_PAD_DAYS = 21   // empty slots to drag future work into
export const MIN_DURATION_DAYS = 1  // a brick is at least one cell wide

export interface Cell {
    col: number
    row: number
    days: number
}

// Local midnight for a wall-clock ms value. The board's columns are
// day-aligned to the user's timezone, not UTC, so grid lines fall on
// the user's 00:00.
export function localMidnight(ms: number): number {
    const d = new Date(ms)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
}

// Add whole days to a ms value via the calendar, so a DST day still
// lands on local midnight rather than drifting by an hour.
export function addDays(ms: number, days: number): number {
    const d = new Date(ms)
    d.setDate(d.getDate() + days)
    return d.getTime()
}

// lane_y (0..1) <-> row index, for a board of `rows` lanes. Storage is
// fractional because the column is constrained to 0..1; the board pins
// `rows` to ABS_LANES below so a row means the same lane every time.
export function laneToRow(laneY: number, rows: number): number {
    if (rows <= 1) return 0
    return Math.min(rows - 1, Math.max(0, Math.round(laneY * (rows - 1))))
}

export function rowToLane(row: number, rows: number): number {
    if (rows <= 1) return 0
    return Math.min(1, Math.max(0, row / (rows - 1)))
}

// The board's day-0 column: local midnight a couple of days before
// the earliest scheduled task (or now, whichever is earlier).
export function boardOrigin(issues: Issue[], nowMs: number): number {
    let earliest = nowMs
    for (const i of issues) {
        if (i.starts_at) {
            const s = Date.parse(i.starts_at)
            if (!Number.isNaN(s) && s < earliest) earliest = s
        }
    }
    return addDays(localMidnight(earliest), -PAST_PAD_DAYS)
}

// How many day-columns the board spans: enough to cover the latest
// task plus future runway, and never fewer than MIN_COLS.
export function boardCols(issues: Issue[], originMs: number, nowMs: number): number {
    let latest = nowMs
    for (const i of issues) {
        if (i.ends_at) {
            const e = Date.parse(i.ends_at)
            if (!Number.isNaN(e) && e > latest) latest = e
        }
    }
    const span = Math.ceil((latest - originMs) / DAY_MS) + FUTURE_PAD_DAYS
    return Math.max(MIN_COLS, span)
}

// A scheduled issue -> its brick cell, or null if unscheduled.
// Duration rounds to whole days (min 1) so a 24h tile from the Gantt
// view reads as a 1-cell brick here.
export function issueToCell(issue: Issue, originMs: number, rows: number): Cell | null {
    if (!issue.starts_at || !issue.ends_at || issue.lane_y == null) return null
    const startMs = Date.parse(issue.starts_at)
    const endMs = Date.parse(issue.ends_at)
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null
    const col = Math.max(0, Math.round((startMs - originMs) / DAY_MS))
    const days = Math.max(MIN_DURATION_DAYS, Math.round((endMs - startMs) / DAY_MS))
    return { col, row: laneToRow(issue.lane_y, rows), days }
}

// A brick cell -> the schedule patch to persist it. Uses the
// calendar-aware addDays so start/end stay on local midnight.
export function cellToSchedule(
    col: number,
    row: number,
    days: number,
    originMs: number,
    rows: number,
): { starts_at: string; ends_at: string; lane_y: number } {
    const startMs = addDays(originMs, col)
    const endMs = addDays(originMs, col + Math.max(MIN_DURATION_DAYS, days))
    return {
        starts_at: new Date(startMs).toISOString(),
        ends_at: new Date(endMs).toISOString(),
        lane_y: rowToLane(row, rows),
    }
}

// --- Absolute lane rows (playful board) ---------------------------------
//
// The sticker board addresses lanes as ABSOLUTE integer rows: a row keeps
// its identity when the window resizes, mirroring the unbounded absolute
// day-columns. Storage is still the shared `lane_y` fraction — the column
// is a `real` with a `0 <= lane_y <= 1` CHECK, and the Gantt view reads it
// as "how far down the canvas" — so rows ride on a FIXED virtual board of
// ABS_LANES lanes rather than the viewport-derived count TimelineGrid uses.
// That keeps both writers inside the constraint and keeps the two views
// mutually readable.
//
// The trade: rows outside [0, ABS_LANES-1] can't be expressed, so they
// clamp on the way out (laneToRow / rowToLane already clamp for us).
export const ABS_LANES = 64

export function laneToRowAbs(laneY: number): number {
    return laneToRow(laneY, ABS_LANES)
}

export function rowToLaneAbs(row: number): number {
    return rowToLane(row, ABS_LANES)
}
