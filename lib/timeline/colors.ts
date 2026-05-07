import type { IssueStatus } from "@/lib/supabase/types"

// Default status palette for issues on the planning timeline.
// Mirrors the canvas mock — purple (open) → amber (waiting / in
// progress) → red (blocked / urgent) → done. Used as the fallback
// when project_status_colors has no row for a status.
export const DEFAULT_STATUS_COLORS: Record<IssueStatus, string> = {
    open:        "#7c3aed",
    in_progress: "#f59e0b",
    blocked:     "#ef4444",
    done:        "#10b981",
    archived:    "#94a3b8",
    duplicated:  "#a78bfa",
}

export function statusColor(
    status: IssueStatus,
    overrides?: Partial<Record<IssueStatus, string>>,
): string {
    return overrides?.[status] ?? DEFAULT_STATUS_COLORS[status]
}

// Cheap luminance check so we can pick a readable foreground colour
// against the tile fill. Returns true for dark backgrounds.
export function isDarkColor(hex: string): boolean {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex)
    if (!m) return true
    const n = parseInt(m[1], 16)
    const r = (n >> 16) & 0xff
    const g = (n >> 8) & 0xff
    const b = n & 0xff
    // perceptual luminance ≈ 0.299r + 0.587g + 0.114b
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return lum < 0.6
}
