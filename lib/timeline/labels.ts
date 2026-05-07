// Default colour palette for project labels. Used by the label
// chip in the issue drawer and the label-icon manager when a row
// has no explicit colour set yet — we hash the label name into a
// stable slot so the same label always picks the same default.
const PALETTE = [
    "#7c3aed", // violet
    "#3b82f6", // blue
    "#06b6d4", // cyan
    "#10b981", // emerald
    "#84cc16", // lime
    "#f59e0b", // amber
    "#ef4444", // rose-red
    "#ec4899", // pink
]

export function defaultLabelColor(label: string): string {
    let hash = 0
    for (let i = 0; i < label.length; i++) {
        hash = (hash * 31 + label.charCodeAt(i)) | 0
    }
    return PALETTE[Math.abs(hash) % PALETTE.length]
}

export const LABEL_COLOR_PALETTE: readonly string[] = PALETTE

// Soft / muted chip style derived from a label's colour. Used by
// the label chips in the issue editor and drawer so the colour is
// hinted at (low-alpha background + slightly darker border)
// without dominating the UI. Text + icon stay neutral zinc-700.
export function softLabelChipStyle(hex: string): {
    background: string
    borderColor: string
    color: string
} {
    return {
        background: hexToRgba(hex, 0.08),
        borderColor: hexToRgba(hex, 0.28),
        color: "#3f3f46",
    }
}

function hexToRgba(hex: string, alpha: number): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex)
    if (!m) return `rgba(0,0,0,${alpha})`
    const n = parseInt(m[1], 16)
    const r = (n >> 16) & 0xff
    const g = (n >> 8) & 0xff
    const b = n & 0xff
    return `rgba(${r},${g},${b},${alpha})`
}
