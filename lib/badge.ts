// Self-hosted status chips for GitHub markdown comments — the brand equivalent
// of a shields.io badge. renderBadge() produces the SVG the /api/badge endpoint
// serves; badge() produces the `![alt](url)` markdown the comment renderers
// embed. Chips mirror the in-app pill language (soft tinted fill + saturated
// text + a leading dot), keyed by the same tone vocabulary as the UI
// (components/ui/field-card.tsx, components/issues/issue-meta.tsx).
//
// GitHub proxies these through camo as <img>, so: no scripts, no external fonts
// (system stack only), and each distinct chip is its own URL — a status change
// swaps the URL, so per-URL caching never shows a stale chip.

export type BadgeTone =
    | "emerald" | "amber" | "rose" | "violet" | "blue" | "indigo" | "cyan" | "zinc"

// bg = <tone>-50 (zinc-100), fg = <tone>-700 (zinc-600), dot = <tone>-500
// (zinc-400) — the exact Tailwind hexes the app chips use.
const TONE_HEX: Record<BadgeTone, { bg: string; fg: string; dot: string }> = {
    emerald: { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" },
    amber:   { bg: "#fffbeb", fg: "#b45309", dot: "#f59e0b" },
    rose:    { bg: "#fff1f2", fg: "#be123c", dot: "#f43f5e" },
    violet:  { bg: "#f5f3ff", fg: "#6d28d9", dot: "#8b5cf6" },
    blue:    { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" },
    indigo:  { bg: "#eef2ff", fg: "#4338ca", dot: "#6366f1" },
    cyan:    { bg: "#ecfeff", fg: "#0e7490", dot: "#06b6d4" },
    zinc:    { bg: "#f4f4f5", fg: "#52525b", dot: "#a1a1aa" },
}

export function isBadgeTone(t: string): t is BadgeTone {
    return t in TONE_HEX
}

// Domain → tone helpers, shared by the PR + issue comment renderers.
export function confidenceTone(c: string): BadgeTone {
    return c === "high" ? "emerald" : c === "medium" ? "amber" : "rose"
}
// Per-dimension confidence level (analyser ADR-0057): high=green, medium=amber,
// low=zinc. Distinct from confidenceTone — low reads as "unknown/neutral" here
// (not an alarm), since a low correctness confidence isn't itself a defect.
export function confidenceLevelTone(level: string): BadgeTone {
    return level === "high" ? "emerald" : level === "medium" ? "amber" : "zinc"
}
export function verdictTone(v: string): BadgeTone {
    return v === "likely" ? "emerald" : v === "partial" ? "amber" : v === "unlikely" ? "rose" : "zinc"
}
// A finding's STATE — the traffic-light disposition the chip shows (analyser
// ADR-0056): "critical" (block), "review" (worth a manual look), "good". Chosen
// by impact, not by the topic (which lives in the title). Normalises the legacy
// bug/risk/style/nit vocabulary so old stored rows still render.
export function findingState(s: string): "critical" | "review" | "good" {
    if (s === "critical" || s === "bug") return "critical"
    if (s === "good") return "good"
    return "review" // review, risk, style, nit, or anything else
}
// The chip label IS the state word.
export function severityLabel(s: string): string {
    return findingState(s)
}
export function severityTone(s: string): BadgeTone {
    const st = findingState(s)
    return st === "critical" ? "rose" : st === "good" ? "emerald" : "amber"
}
export function severityIcon(s: string): string {
    const st = findingState(s)
    return st === "critical" ? "alert" : st === "good" ? "check" : "search"
}
// Merge verdict (ADR-0056) → tone + human label + icon.
export function mergeVerdictTone(v: string): BadgeTone {
    return v === "approve" ? "emerald" : v === "request_changes" ? "rose" : "amber"
}
export function mergeVerdictLabel(v: string): string {
    return v === "approve" ? "approve" : v === "request_changes" ? "changes requested" : "comment"
}
export function mergeVerdictIcon(v: string): string {
    return v === "approve" ? "check" : v === "request_changes" ? "x" : "chat"
}

// ── text metrics ────────────────────────────────────────────────────────────
// Helvetica-Bold advance widths (per 1000 em) so the pill hugs its text without
// measuring in a browser. Good enough for the short labels we render.
const W: Record<string, number> = {
    " ": 278, "!": 333, '"': 474, "#": 556, $: 556, "%": 889, "&": 722, "'": 238,
    "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
    "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
    ":": 333, ";": 333, "<": 584, "=": 584, ">": 584, "?": 611, "@": 975,
    A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833,
    N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    "[": 333, "\\": 278, "]": 333, "^": 584, _: 556, "`": 333,
    a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889,
    n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
    "{": 389, "|": 280, "}": 389, "~": 584,
}
function textWidth(text: string, fontSize: number): number {
    let mille = 0
    for (const ch of text) mille += W[ch] ?? 611
    return (mille / 1000) * fontSize
}

function escapeXml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!)
}

const FONT_FAMILY = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
const MAX_CHARS = 42

// renderBadge builds a rounded-pill SVG: tinted fill + hairline, an optional
// leading dot, and centered semibold text — the app's chip, as an image.
// Tabler-style line-icon glyphs (24×24, stroke) — the same visual language as the
// in-app SVG icons, so the GitHub-comment chips match the UI.
const ICON_PATHS: Record<string, string> = {
    check: `<path d="M20 6L9 17l-5-5"/>`,
    x: `<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>`,
    chat: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
    search: `<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>`,
    alert: `<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>`,
    code: `<path d="M8 6l-5 6 5 6M16 6l5 6-5 6"/>`,
    list: `<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 5.5l1 1 1.6-1.9M4.5 11.5l1 1 1.6-1.9M4.5 17.5l1 1 1.6-1.9"/>`,
    target: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>`,
    nodes: `<circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.1 10.9l7.8-3.7M8.1 13.1l7.8 3.7"/>`,
}

export function renderBadge(text: string, tone: BadgeTone, opts: { dot?: boolean; icon?: string } = {}): string {
    const label = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS - 1) + "…" : text
    const c = TONE_HEX[tone]

    const H = 20
    const fontSize = 11
    const leftPad = 8
    const rightPad = 9
    const dotR = 3
    const gap = 5
    const iconSize = 12

    const hasIcon = !!opts.icon && !!ICON_PATHS[opts.icon]
    const dot = !hasIcon && (opts.dot ?? true)

    const leadW = hasIcon ? iconSize : dot ? dotR * 2 : 0
    const textX = leadW ? leftPad + leadW + gap : leftPad
    const tw = textWidth(label, fontSize)
    const width = Math.ceil(textX + tw + rightPad)

    let lead = ""
    if (hasIcon) {
        const scale = iconSize / 24
        const y = (H - iconSize) / 2
        lead = `<g transform="translate(${leftPad},${y}) scale(${scale.toFixed(4)})" fill="none" stroke="${c.fg}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[opts.icon!]}</g>`
    } else if (dot) {
        lead = `<circle cx="${leftPad + dotR}" cy="${H / 2}" r="${dotR}" fill="${c.dot}"/>`
    }

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="${escapeXml(label)}">`,
        `<rect x="0.5" y="0.5" width="${width - 1}" height="${H - 1}" rx="${(H - 1) / 2}" fill="${c.bg}" stroke="${c.dot}" stroke-opacity="0.4"/>`,
        lead,
        `<text x="${textX}" y="14" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="600" fill="${c.fg}">${escapeXml(label)}</text>`,
        `</svg>`,
    ].join("")
}

// renderIcon builds a small standalone line-icon (no pill) — used to prefix the
// comment's section headers so they carry the same glyphs as the app.
export function renderIcon(name: string, tone: BadgeTone = "zinc"): string {
    const path = ICON_PATHS[name] ?? ICON_PATHS.search
    const c = TONE_HEX[tone]
    const S = 16
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 24 24" fill="none" stroke="${c.fg}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" role="img">${path}</svg>`
}

// badgeUrl builds the absolute /api/badge URL (origin is this app's public
// origin — the same one comment renderers already use for images).
export function badgeUrl(origin: string, text: string, tone: BadgeTone, opts: { dot?: boolean; icon?: string } = {}): string {
    const q = new URLSearchParams({ text, tone })
    if (opts.dot === false) q.set("dot", "0")
    if (opts.icon) q.set("icon", opts.icon)
    return `${origin}/api/badge?${q.toString()}`
}

// badge returns the markdown image embed for a comment.
export function badge(origin: string, text: string, tone: BadgeTone, opts: { dot?: boolean; icon?: string } = {}): string {
    const alt = text.replace(/[[\]]/g, "")
    return `![${alt}](${badgeUrl(origin, text, tone, opts)})`
}

// icon returns the markdown embed for a standalone section-header glyph.
export function iconUrl(origin: string, name: string, tone: BadgeTone = "zinc"): string {
    return `${origin}/api/icon?${new URLSearchParams({ name, tone }).toString()}`
}
export function icon(origin: string, name: string, tone: BadgeTone = "zinc"): string {
    return `![](${iconUrl(origin, name, tone)})`
}
