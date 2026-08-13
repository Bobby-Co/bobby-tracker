// The playful board's pastel chips, shared so every timeline surface draws a
// given issue in the same colour.
//
// Lives here rather than in timeline-grid-playful.tsx because TimelinePeek
// needs it too, and that component is heavy (framer-motion, drag controls) —
// importing it just for a colour table would pull all of that onto the issue
// detail page.

export type Pastel = { bg: string; fg: string }

export const PALETTE: Pastel[] = [
    { bg: "#EAE6FB", fg: "#7350D6" }, // violet
    { bg: "#E0EBFD", fg: "#3370D4" }, // blue
    { bg: "#DEEDFC", fg: "#2484CC" }, // azure
    { bg: "#D8F3F4", fg: "#0E9AA4" }, // cyan
    { bg: "#D7F2EC", fg: "#10917F" }, // teal
    { bg: "#DDF5EB", fg: "#1FA06E" }, // mint
    { bg: "#E0F4DC", fg: "#3D9A37" }, // green
    { bg: "#EDF5CE", fg: "#7C9011" }, // lime
    { bg: "#FBF1CC", fg: "#B8930C" }, // gold
    { bg: "#FBE9C9", fg: "#C57F0C" }, // amber
    { bg: "#FDE7C9", fg: "#CE7A12" }, // tangerine
    { bg: "#FCE3D0", fg: "#D26B26" }, // orange
    { bg: "#FCE3DD", fg: "#D45441" }, // coral
    { bg: "#FBE3EF", fg: "#C84C86" }, // pink
]

export function hashStr(s: string): number {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
    return Math.abs(h)
}

/** A stable pastel chip for an issue, hashed by id. */
export function pastelFor(id: string): Pastel {
    return PALETTE[hashStr(id) % PALETTE.length]
}

/** The hairline ring the playful tiles carry, derived from their accent. */
export const ringFor = (fg: string) => `color-mix(in srgb, ${fg} 24%, transparent)`
