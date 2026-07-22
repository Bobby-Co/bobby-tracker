import { badge, type BadgeTone, badgeUrl, confidenceImage, mergeVerdictIcon, mergeVerdictLabel, mergeVerdictTone, scoreImage, verdictTone } from "@/lib/shared/rendering/badge"
import { findingState } from "@/lib/shared/rendering/finding-state"
import type { PrAnalysis, PrFinding } from "@/lib/shared/types"

// Finding groups → collapsible sections, traffic-light order; issues open, positives collapsed.
const FINDING_GROUPS: { key: "critical" | "review" | "good"; title: string; tone: BadgeTone; ic: string; open: boolean }[] = [
    { key: "critical", title: "Blockers", tone: "rose", ic: "alert", open: true },
    { key: "review", title: "Worth a review", tone: "amber", ic: "search", open: true },
    { key: "good", title: "Looks good", tone: "emerald", ic: "check", open: false },
]

/** Builds the GitHub-comment body for a PR review. */
export class PullRequestAnalysisComment {
    private readonly marker = "<!-- bobby:pr-analysis -->"

    loading(origin: string, prName?: string, uiUrl?: string): string {
        const name = this.title(prName)
        const out = [
            this.marker,
            `## PR Review${name ? ` (${name})` : ""}`,
            "",
            `<img align="absmiddle" src="${origin}/brand_loader.webp" width="26" alt="" /> **Ucelot is reviewing this pull request…**`,
            "",
            "Reading the diff and tracing its impact through the codebase — this comment fills in automatically when the review is ready.",
        ]
        if (uiUrl) out.push("", "---", "", `**[View the full review in ucelot →](${uiUrl})**`)
        return out.join("\n")
    }

    cancelled(origin: string, prNumber?: number): string {
        const name = prNumber != null ? `#${prNumber}` : ""
        return [this.marker, `## PR Review${name ? ` (${name})` : ""}`, "", badge(origin, "cancelled", "zinc", { size: "header" }), "", "The PR was closed before the review finished."].join("\n")
    }

    failed(origin: string, prNumber?: number): string {
        const name = prNumber != null ? `#${prNumber}` : ""
        return [this.marker, `## PR Review${name ? ` (${name})` : ""}`, "", badge(origin, "review unavailable", "rose", { size: "header" }), "", "Ucelot couldn't complete the review this time."].join("\n")
    }

    result(r: PrAnalysis, origin: string, uiUrl?: string, prNumber?: number): string {
        const name = (r.title ?? "").replace(/[\r\n]+/g, " ").trim() || (prNumber != null ? `#${prNumber}` : "")
        const out: string[] = [this.marker, `## PR Review${name ? ` (${name})` : ""}`, ""]
        if (r.verdict) out.push(badge(origin, mergeVerdictLabel(r.verdict), mergeVerdictTone(r.verdict), { icon: mergeVerdictIcon(r.verdict), size: "header" }), "")
        if (r.verdict_reason?.trim()) out.push(`_${this.esc(r.verdict_reason)}_`, "")

        out.push("### Quick Summary")
        // Score comes from the analyser only — never faked here.
        if (r.score_max && r.score_max > 0) out.push("**Merge Readiness**\\", scoreImage(origin, r.score ?? 0, r.score_max), "")
        else out.push("**Merge Readiness**\\", "`…` _not ready_", "")
        if (r.confidences) {
            const c = r.confidences
            out.push("**Analysis rubrics**\\", confidenceImage(origin, [c.correctness?.level, c.load_perf?.level, c.security?.level].map((l) => l || "low")), "")
        }
        if (r.summary?.trim()) out.push("**About this PR**", r.summary.trim(), "")

        const findings = r.findings ?? []
        const hasGroups = FINDING_GROUPS.some((g) => findings.some((f) => findingState(f.severity) === g.key))
        const withSnip = findings.filter((f) => findingState(f.severity) !== "good" && f.snippet?.trim()).slice(0, 4)
        if (hasGroups || withSnip.length > 0 || (r.fix_claims?.length ?? 0) > 0) out.push("### Ucelot Notes", "")

        for (const g of FINDING_GROUPS) {
            const items = findings.filter((f) => findingState(f.severity) === g.key)
            if (!items.length) continue
            out.push(`<details${g.open ? " open" : ""}>`, `<summary>${this.badgeImg(origin, `${g.title} · ${items.length}`, g.tone, { icon: g.ic, size: "header" })}</summary>`, "")
            for (const f of items.slice(0, 8)) {
                const loc = f.line ? ` — \`${f.file}:${f.line}\`` : f.file ? ` — \`${f.file}\`` : ""
                out.push(`- ${this.esc(this.findingTitle(f))}${loc}`)
            }
            if (items.length > 8) out.push(`- …and ${items.length - 8} more`)
            out.push("", "</details>", "")
        }

        if (withSnip.length) {
            out.push("<details>", `<summary>${this.badgeImg(origin, `Changed code · ${withSnip.length}`, "zinc", { icon: "code", size: "header" })}</summary>`, "")
            for (const f of withSnip) {
                const loc = f.line ? `${f.file}:${f.line}` : f.file || ""
                out.push(`**${this.esc(f.title || "")}**${loc ? ` — \`${loc}\`` : ""}`, "", "```" + (f.lang || "diff"), f.snippet!.trim(), "```", "")
            }
            out.push("</details>", "")
        }

        if (r.fix_claims?.length) {
            out.push("<br>", "", badge(origin, "Fix claims", "indigo", { icon: "target", size: "header" }), "")
            for (const c of r.fix_claims) out.push(`- ${badge(origin, c.verdict || "unclear", verdictTone(c.verdict))} ${this.esc(c.claim)}`)
            out.push("")
        }

        out.push("---", "")
        if (uiUrl) out.push(`**[View the full review in ucelot →](${uiUrl})**`, "")

        const dur = r.duration_ms ? ` · reviewed in ${(r.duration_ms / 1000).toFixed(1)}s` : ""
        out.push(`<sub>🔎 Reviewed by Ucelot${dur}</sub>`, "", `<sub>Ucelot is AI-assisted and can make mistakes — verify findings before acting.</sub>`)
        return out.join("\n")
    }

    private esc(s: string): string {
        return s.replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim()
    }

    private title(name?: string): string {
        return (name ?? "").replace(/[\r\n]+/g, " ").trim()
    }

    // Raw <img> badge — required inside <summary>, where GitHub renders HTML and won't parse markdown.
    private badgeImg(origin: string, text: string, tone: BadgeTone, opts: { icon?: string; size?: "sm" | "header" } = {}): string {
        const url = badgeUrl(origin, text, tone, opts).replace(/&/g, "&amp;")
        return `<picture><img align="absmiddle" src="${url}" alt="${text.replace(/"/g, "")}" /></picture>`
    }

    private findingTitle(f: PrFinding): string {
        const base = this.esc(f.title || f.detail)
        const cat = (f.category || "").trim()
        if (!cat || cat === "good") return base
        const tag = this.categoryLabel(cat)
        if (base.toLowerCase().startsWith(`${tag.toLowerCase()}:`)) return base
        return `${tag}: ${base}`
    }

    private categoryLabel(cat: string): string {
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
}
