// Time constants for the planning views.
//
// This file used to carry the Gantt canvas's continuous "pixels per
// hour" scale (zoom presets, time↔x projection, hour snapping). That
// canvas is gone — the board is the planning view now, and it works in
// whole-day cells (see grid.ts) — so only the units survive, used by
// the board's column maths and the read-only TimelinePeek.

export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS
