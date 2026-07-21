// Analysis presentation — GitHub-comment rendering for PR reviews. Pure string
// building, no I/O; a cohesive renderer owned by this concept file (only the four
// comment builders are the surface — the marker/escaping/badge/finding helpers
// are internals).

import { badge, type BadgeTone, badgeUrl, confidenceImage, mergeVerdictIcon, mergeVerdictLabel, mergeVerdictTone, scoreImage, verdictTone } from "@/lib/rendering/badge"
import { findingState } from "@/lib/rendering/finding-state"
import type { PRAnalysis, PRFinding } from "@/lib/supabase/types"

const PR_MARKER = "<!-- bobby:pr-analysis -->"

function esc(s: string): string {
    return s.replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim()
}

const prTitle = (name?: string) => (name ?? "").replace(/[\r\n]+/g, " ").trim()

// loadingComment is the "reviewing" state — the same header + CTA as the result,
// with the self-hosted animated brand loader. It edits in place to the finished review.
export function loadingComment(origin: string, prName?: string, uiUrl?: string): string {
    const name = prTitle(prName)
    const out = [
        PR_MARKER,
        `## PR Review${name ? ` (${name})` : ""}`,
        "",
        `<img align="absmiddle" src="${origin}/brand_loader.webp" width="26" alt="" /> **Ucelot is reviewing this pull request…**`,
        "",
        "Reading the diff and tracing its impact through the codebase — this comment fills in automatically when the review is ready.",
    ]
    if (uiUrl) out.push("", "---", "", `**[View the full review in ucelot →](${uiUrl})**`)
    return out.join("\n")
}

export function cancelledComment(origin: string, prNumber?: number): string {
    const name = prNumber != null ? `#${prNumber}` : ""
    return [PR_MARKER, `## PR Review${name ? ` (${name})` : ""}`, "", badge(origin, "cancelled", "zinc", { size: "header" }), "", "The PR was closed before the review finished."].join("\n")
}

export function failedComment(origin: string, prNumber?: number): string {
    const name = prNumber != null ? `#${prNumber}` : ""
    return [PR_MARKER, `## PR Review${name ? ` (${name})` : ""}`, "", badge(origin, "review unavailable", "rose", { size: "header" }), "", "Ucelot couldn't complete the review this time."].join("\n")
}

// Finding groups → collapsible comment sections, traffic-light order (issues
// first). Issue groups render open; positives collapse.
const FINDING_GROUPS: { key: "critical" | "review" | "good"; title: string; tone: BadgeTone; ic: string; open: boolean }[] = [
    { key: "critical", title: "Blockers", tone: "rose", ic: "alert", open: true },
    { key: "review", title: "Worth a review", tone: "amber", ic: "search", open: true },
    { key: "good", title: "Looks good", tone: "emerald", ic: "check", open: false },
]

// badgeImg is the RAW <img> form of a badge — required inside <summary>, where
// GitHub renders the content as HTML and does NOT parse markdown, so ![alt](url)
// would show literally. `&` is escaped so the src is valid HTML.
function badgeImg(origin: string, text: string, tone: BadgeTone, opts: { icon?: string; size?: "sm" | "header" } = {}): string {
    const url = badgeUrl(origin, text, tone, opts).replace(/&/g, "&amp;")
    return `<picture><img align="absmiddle" src="${url}" alt="${text.replace(/"/g, "")}" /></picture>`
}

// resultComment is the GitHub-comment TEASER: a terse, bullet-point digest that
// links through to the full, navigable review in ucelot. Deliberately low-detail
// — verdict, summary, the issue findings as one-liners, fix-claim verdicts, and
// the link. Everything richer lives in the app.
export function resultComment(r: PRAnalysis, origin: string, uiUrl?: string, prNumber?: number): string {
    const name = (r.title ?? "").replace(/[\r\n]+/g, " ").trim() || (prNumber != null ? `#${prNumber}` : "")
    const out: string[] = [PR_MARKER, `## PR Review${name ? ` (${name})` : ""}`, ""]
    if (r.verdict) out.push(badge(origin, mergeVerdictLabel(r.verdict), mergeVerdictTone(r.verdict), { icon: mergeVerdictIcon(r.verdict), size: "header" }), "")
    if (r.verdict_reason?.trim()) out.push(`_${esc(r.verdict_reason)}_`, "")

    // ── Quick Summary — readiness score, the confidence rubrics, what the PR does.
    out.push("### Quick Summary")
    // Score comes from the analyser only — never faked here.
    if (r.score_max && r.score_max > 0) out.push("**Merge Readiness**\\", scoreImage(origin, r.score ?? 0, r.score_max), "")
    else out.push("**Merge Readiness**\\", "`…` _not ready_", "")
    if (r.confidences) {
        const c = r.confidences
        out.push("**Analysis rubrics**\\", confidenceImage(origin, [c.correctness?.level, c.load_perf?.level, c.security?.level].map((l) => l || "low")), "")
    }
    if (r.summary?.trim()) out.push("**About this PR**", r.summary.trim(), "")

    // ── Ucelot Notes — grouped findings, the changed code, and fix-claim verdicts.
    const findings = r.findings ?? []
    const hasGroups = FINDING_GROUPS.some((g) => findings.some((f) => findingState(f.severity) === g.key))
    const withSnip = findings.filter((f) => findingState(f.severity) !== "good" && f.snippet?.trim()).slice(0, 4)
    if (hasGroups || withSnip.length > 0 || (r.fix_claims?.length ?? 0) > 0) out.push("### Ucelot Notes", "")

    for (const g of FINDING_GROUPS) {
        const items = findings.filter((f) => findingState(f.severity) === g.key)
        if (!items.length) continue
        out.push(`<details${g.open ? " open" : ""}>`, `<summary>${badgeImg(origin, `${g.title} · ${items.length}`, g.tone, { icon: g.ic, size: "header" })}</summary>`, "")
        for (const f of items.slice(0, 8)) {
            const loc = f.line ? ` — \`${f.file}:${f.line}\`` : f.file ? ` — \`${f.file}\`` : ""
            out.push(`- ${esc(findingTitle(f))}${loc}`)
        }
        if (items.length > 8) out.push(`- …and ${items.length - 8} more`)
        out.push("", "</details>", "")
    }

    // The changed code, in one collapsible — GitHub highlights the diff when expanded.
    if (withSnip.length) {
        out.push("<details>", `<summary>${badgeImg(origin, `Changed code · ${withSnip.length}`, "zinc", { icon: "code", size: "header" })}</summary>`, "")
        for (const f of withSnip) {
            const loc = f.line ? `${f.file}:${f.line}` : f.file || ""
            out.push(`**${esc(f.title || "")}**${loc ? ` — \`${loc}\`` : ""}`, "", "```" + (f.lang || "diff"), f.snippet!.trim(), "```", "")
        }
        out.push("</details>", "")
    }

    // Fix claims — a header banner + one line each (verdict + claim).
    if (r.fix_claims?.length) {
        out.push("<br>", "", badge(origin, "Fix claims", "indigo", { icon: "target", size: "header" }), "")
        for (const c of r.fix_claims) out.push(`- ${badge(origin, c.verdict || "unclear", verdictTone(c.verdict))} ${esc(c.claim)}`)
        out.push("")
    }

    // The call to action: the full, navigable review.
    out.push("---", "")
    if (uiUrl) out.push(`**[View the full review in ucelot →](${uiUrl})**`, "")

    const dur = r.duration_ms ? ` · reviewed in ${(r.duration_ms / 1000).toFixed(1)}s` : ""
    out.push(`<sub>🔎 Reviewed by Ucelot${dur}</sub>`, "", `<sub>Ucelot is AI-assisted and can make mistakes — verify findings before acting.</sub>`)
    return out.join("\n")
}

// findingTitle leads the finding title with its category as a tag (Bug:, …) when
// the title doesn't already carry one.
function findingTitle(f: PRFinding): string {
    const base = esc(f.title || f.detail)
    const cat = (f.category || "").trim()
    if (!cat || cat === "good") return base
    const tag = categoryLabel(cat)
    if (base.toLowerCase().startsWith(`${tag.toLowerCase()}:`)) return base
    return `${tag}: ${base}`
}

// categoryLabel humanises a finding category slug into a short tag word.
function categoryLabel(cat: string): string {
    switch (cat) {
        case "bug": return "Bug"
        case "convention": return "Convention"
        case "blast_radius": return "Blast radius"
        case "test_gap": return "Test gap"
        case "drift": return "Drift"
        case "failure": return "Failure"
        case "history": return "History"
        default: return cat.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
    }
}
