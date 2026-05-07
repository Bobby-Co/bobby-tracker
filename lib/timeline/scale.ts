// Coordinate helpers for the planning timeline.
//
// The canvas works in "pixels per hour". The timeline component
// stores this as a continuous number so the user can wheel-zoom
// freely; the Zoom enum just names a few preset densities for the
// preset buttons. Day-grid lines are drawn at every 24h. All
// position state on disk is time-based (ISO timestamps) plus a
// 0..1 fraction for vertical lane, so layout survives across
// screen sizes and zoom levels.

export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS

export type Zoom = "day" | "week" | "month" | "quarter"

export const ZOOM_PX_PER_HOUR: Record<Zoom, number> = {
    day:     32,   // 768 px/day — fine-grained planning
    week:    8,    // 192 px/day — default
    month:   2.4,  // 57.6 px/day
    quarter: 0.9,  // 21.6 px/day — tile shows just the icon
}

export const ZOOM_LABEL: Record<Zoom, string> = {
    day: "Day",
    week: "Week",
    month: "Month",
    quarter: "Quarter",
}

// Bounds on the continuous zoom slider. Below the lower bound the
// canvas can't fit useful labels; above the upper bound a single
// hour spans most of the viewport.
export const PX_PER_HOUR_MIN = 0.4
export const PX_PER_HOUR_MAX = 96

export function clampPxPerHour(n: number): number {
    return Math.max(PX_PER_HOUR_MIN, Math.min(PX_PER_HOUR_MAX, n))
}

// Pick the named preset closest to the given continuous zoom value
// — used to highlight the active preset button while the user
// wheel-zooms between snaps.
export function nearestZoomPreset(pxPerHour: number): Zoom {
    let best: Zoom = "week"
    let bestDist = Infinity
    for (const key of Object.keys(ZOOM_PX_PER_HOUR) as Zoom[]) {
        const d = Math.abs(Math.log(pxPerHour) - Math.log(ZOOM_PX_PER_HOUR[key]))
        if (d < bestDist) { bestDist = d; best = key }
    }
    return best
}

export function pxPerDay(pxPerHour: number): number {
    return pxPerHour * 24
}

// Convert a time → x pixel position relative to the canvas origin.
export function timeToX(t: Date | string | number, originMs: number, pxPerHour: number): number {
    const ms = typeof t === "string"
        ? Date.parse(t)
        : typeof t === "number"
            ? t
            : t.getTime()
    return ((ms - originMs) / HOUR_MS) * pxPerHour
}

// Inverse — used to translate a drop position back to a timestamp.
export function xToTime(x: number, originMs: number, pxPerHour: number): Date {
    return new Date(originMs + (x / pxPerHour) * HOUR_MS)
}

// Snap a millisecond-time to the nearest hour boundary.
export function snapToHour(ms: number): number {
    return Math.round(ms / HOUR_MS) * HOUR_MS
}

// Default tile duration when scheduling from the tray. Long enough
// to be visible across all zooms but not so long the user has to
// resize every time. 1 day is a sensible "I'll think about this
// today" placeholder.
export const DEFAULT_TILE_HOURS = 24
