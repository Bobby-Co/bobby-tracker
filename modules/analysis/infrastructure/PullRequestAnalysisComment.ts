import { badge, type BadgeTone, badgeUrl, confidenceImage, mergeVerdictIcon, mergeVerdictLabel, mergeVerdictTone, scoreImage, verdictTone } from "@/lib/shared/rendering/badge"
import { findingState } from "@/lib/shared/rendering/finding-state"
import { layoutFor, type BlockKind, type BlockState, type BlockTone, type ReportBlock } from "@/lib/shared/report/registry"
import type { PrAnalysis, PrFinding, ReviewRunProfile } from "@/lib/shared/types"

/** Escape team-written text for inline markdown in a comment Ucelot posts under
 *  its own account. Profile NAMES are a label rather than a prompt, so they skip
 *  the instruction sanitiser — which makes this the one place an underscore stops
 *  starting italics and a stray `<` stops opening a tag. Every character escaped
 *  here is ASCII punctuation, which GFM renders back as itself. */
function mdEscape(text: string): string {
    return text.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]()#+\-.!<>|]/g, "\\$&")
}

// Finding groups → collapsible sections; issues open, positives collapsed. The
// analyser sends the STATE, this decides what the state looks like — which is
// the whole reason no colour travels on the wire.
const GROUP_STYLE: Record<BlockState, { title: string; tone: BadgeTone; ic: string; open: boolean }> = {
    critical: { title: "Blockers", tone: "rose", ic: "alert", open: true },
    review: { title: "Worth a review", tone: "amber", ic: "search", open: true },
    good: { title: "Looks good", tone: "emerald", ic: "check", open: false },
}

// Semantic tone → badge tone. The React panel maps the same five words to its
// `--c-*` token pairs; neither surface knows about the other's palette.
const TONE_BADGE: Record<BlockTone, BadgeTone> = {
    neutral: "zinc",
    info: "blue",
    good: "emerald",
    warn: "amber",
    critical: "rose",
}

// The two headings the comment has always carried, expressed as a property of
// the blocks that belong under them. A block with no entry here sits outside
// both, exactly as the verdict banner and footer always did.
const MD_SECTION: Partial<Record<BlockKind, string>> = {
    score: "Quick Summary",
    meters: "Quick Summary",
    prose: "Quick Summary",
    finding_group: "Ucelot Notes",
    claims_table: "Ucelot Notes",
    callout: "Ucelot Notes",
    spec_table: "Ucelot Notes",
    timeline: "Ucelot Notes",
    dependency_list: "Ucelot Notes",
    risk_matrix: "Ucelot Notes",
}

/** What every markdown block renderer gets. Mirrors the React renderer's props;
 *  `c` hands back the comment builder's escaping and badge helpers. */
interface MdBlockProps {
    b: ReportBlock
    r: PrAnalysis
    origin: string
    c: PullRequestAnalysisComment
}

// The renderer table, keyed as a Record over BlockKind for the same reason the
// React one is: adding a kind to the registry without teaching THIS surface
// about it is a type error rather than a section that quietly stops appearing
// on GitHub while it still appears in the app.
const MD_BLOCKS: Record<BlockKind, (p: MdBlockProps) => string[]> = {
    verdict_banner: ({ r, origin, c }) => {
        if (!r.verdict) return []
        const out = [badge(origin, mergeVerdictLabel(r.verdict), mergeVerdictTone(r.verdict), { icon: mergeVerdictIcon(r.verdict), size: "header" }), ""]
        if (r.verdict_reason?.trim()) out.push(`_${c.escape(r.verdict_reason)}_`, "")
        return out
    },

    // Score comes from the analyser only — never faked here.
    score: ({ r, origin }) =>
        r.score_max && r.score_max > 0
            ? ["**Merge Readiness**\\", scoreImage(origin, r.score ?? 0, r.score_max), ""]
            : ["**Merge Readiness**\\", "`…` _not ready_", ""],

    // The counts are legible from the group headers on this surface, so the
    // tally would just be noise. Rendering nothing is a valid answer: the
    // assembler already decided the block belongs in the layout, and each
    // surface decides what it can usefully do with it.
    tally: () => [],

    meters: ({ b, r, origin }) => {
        if (!r.confidences) return []
        const c = r.confidences
        const all = { correctness: c.correctness?.level, load_perf: c.load_perf?.level, security: c.security?.level }
        const order = b.dims?.filter((d) => d in all).length ? b.dims.filter((d) => d in all) : ["correctness", "load_perf", "security"]
        return ["**Analysis rubrics**\\", confidenceImage(origin, order.map((d) => all[d as keyof typeof all] || "low")), ""]
    },

    prose: ({ b, r }) => {
        if (b.role === "summary") return r.summary?.trim() ? ["**About this PR**", r.summary.trim(), ""] : []
        if (b.role === "impact") return r.impact?.trim() ? [`**${b.title || "Impact"}**`, r.impact.trim(), ""] : []
        return b.body?.trim() ? [`**${b.title || "Note"}**`, b.body.trim(), ""] : []
    },

    finding_group: ({ b, r, origin, c }) => {
        const state = b.state ?? "review"
        const items = (r.findings ?? []).filter((f) => findingState(f.severity) === state)
        if (!items.length) return []
        const g = GROUP_STYLE[state] ?? GROUP_STYLE.review
        const out = [
            `<details${g.open ? " open" : ""}>`,
            `<summary>${c.badgeImage(origin, `${b.title || g.title} · ${items.length}`, g.tone, { icon: g.ic, size: "header" })}</summary>`,
            "",
        ]
        for (const f of items.slice(0, 8)) {
            const loc = f.line ? ` — \`${f.file}:${f.line}\`` : f.file ? ` — \`${f.file}\`` : ""
            out.push(`- ${c.escape(c.titleOf(f))}${loc}`)
        }
        if (items.length > 8) out.push(`- …and ${items.length - 8} more`)
        out.push("", "</details>", "")
        return out
    },

    // Affected files are already named inline in the impact prose and in each
    // finding's location, so a second list earns nothing on a surface where
    // length is the enemy.
    file_impact_list: () => [],

    claims_table: ({ r, origin, c }) => {
        if (!r.fix_claims?.length) return []
        const out = ["<br>", "", badge(origin, "Fix claims", "indigo", { icon: "target", size: "header" }), ""]
        for (const cl of r.fix_claims) out.push(`- ${badge(origin, cl.verdict || "unclear", verdictTone(cl.verdict))} ${c.escape(cl.claim)}`)
        out.push("")
        return out
    },

    // The checklist and the diligence ledger are app-only, as they have always
    // been on this surface. Rendering them here would be a real improvement and
    // a real change; it is a product call, not a side effect of moving to
    // blocks, so it stays a one-line change for whenever that call is made.
    checklist: () => [],
    checks_footer: () => [],

    // The comment's footer already carries the link into the app and the
    // duration; a second call to action would be clutter.
    deep_dive_cta: () => [],

    callout: ({ b, origin, c }) => {
        if (!b.body?.trim() && !b.title?.trim()) return []
        const out: string[] = []
        if (b.title?.trim()) out.push(badge(origin, c.escape(b.title), TONE_BADGE[b.tone ?? "neutral"], { size: "header" }), "")
        if (b.body?.trim()) out.push(b.body.trim(), "")
        return out
    },

    spec_table: ({ b, c }) => {
        const rows = b.rows ?? []
        if (!rows.length) return []
        const cols = b.columns?.length ? b.columns : rows[0].map((_, i) => `Column ${i + 1}`)
        const out = [`**${b.title || "Details"}**`, ""]
        out.push(`| ${cols.map((x) => c.escape(x)).join(" | ")} |`)
        out.push(`| ${cols.map(() => "---").join(" | ")} |`)
        for (const row of rows) out.push(`| ${cols.map((_, i) => c.escape(row[i] ?? "")).join(" | ")} |`)
        out.push("")
        return out
    },

    timeline: ({ b, c }) => {
        const items = b.items ?? []
        if (!items.length) return []
        const out = ["<details>", `<summary><b>${b.title || "History"} · ${items.length}</b></summary>`, ""]
        for (const it of items) {
            const when = it.when ? `\`${it.when}\` ` : ""
            const detail = it.detail ? ` — ${c.escape(it.detail)}` : ""
            out.push(`- ${when}${c.escape(it.label ?? "")}${detail}`)
        }
        out.push("", "</details>", "")
        return out
    },

    dependency_list: ({ b, c }) => {
        const items = b.items ?? []
        if (!items.length) return []
        const out = [`**${b.title || "Dependencies"}**`, ""]
        for (const it of items) {
            const delta = it.from || it.to ? ` \`${it.from || "—"} → ${it.to || "—"}\`` : ""
            const detail = it.detail ? ` — ${c.escape(it.detail)}` : ""
            out.push(`- \`${c.escape(it.label ?? "")}\`${delta}${detail}`)
        }
        out.push("")
        return out
    },

    risk_matrix: ({ b, c }) => {
        const items = b.items ?? []
        if (!items.length) return []
        const out = [`**${b.title || "Risks"}**`, "", "| Risk | Likelihood | Impact |", "| --- | --- | --- |"]
        for (const it of items) {
            out.push(`| ${c.escape(it.label ?? "")} | ${c.escape(it.likelihood || "—")} | ${c.escape(it.impact || "—")} |`)
        }
        out.push("")
        return out
    },
}

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

    /** `profile` is what actually reviewed this PR (0079). Named in the footer
     *  when it was a team profile, and silent when it was the built-in default:
     *  a line saying "default reviewer" on every comment of every team that never
     *  opened the setting is noise, while its ABSENCE is only ever read by
     *  someone who knows the feature exists. The app-side panel is the opposite
     *  — it states the default outright, because that surface is where the
     *  question "did my profile take effect?" actually gets asked. */
    result(r: PrAnalysis, origin: string, uiUrl?: string, prNumber?: number, profile?: ReviewRunProfile | null): string {
        const name = (r.title ?? "").replace(/[\r\n]+/g, " ").trim() || (prNumber != null ? `#${prNumber}` : "")
        const out: string[] = [this.marker, `## PR Review${name ? ` (${name})` : ""}`, ""]

        // Walk the layout the analyser sent, or the classic one for the years of
        // stored reviews written before layouts existed. The two fixed section
        // headings survive as a property of the BLOCKS that land under them (see
        // MD_SECTION) rather than as fixed positions in this method — so they
        // still appear, and still appear in the right place, whatever order the
        // blocks arrive in.
        // The diff hunks behind the findings. NOT a block: collapsing them into
        // one section is an affordance this surface needs and the app doesn't
        // (there, each snippet sits inside its own finding card), so it belongs
        // to the renderer rather than to the shared vocabulary. It goes directly
        // after the finding groups it illustrates, which is where it has always
        // gone — hence the transition tracking rather than a push after the loop.
        const snippets = this.changedCode(r, origin)
        let emittedGroup = false
        let emittedSnippets = false
        const flushSnippets = () => {
            if (emittedGroup && !emittedSnippets && snippets.length) {
                out.push(...snippets)
                emittedSnippets = true
            }
        }

        let section: string | null = null
        for (const b of layoutFor(r.report)) {
            const render = MD_BLOCKS[b.kind]
            if (!render) continue // a newer analyser's vocabulary; skip, don't break
            const lines = render({ b, r, origin, c: this })
            if (lines.length === 0) continue
            if (b.kind !== "finding_group") flushSnippets()
            const want = MD_SECTION[b.kind] ?? null
            if (want && want !== section) {
                out.push(`### ${want}`, "")
                section = want
            }
            out.push(...lines)
            if (b.kind === "finding_group") emittedGroup = true
        }
        flushSnippets()

        out.push("---", "")
        if (uiUrl) out.push(`**[View the full review in ucelot →](${uiUrl})**`, "")

        const dur = r.duration_ms ? ` · reviewed in ${(r.duration_ms / 1000).toFixed(1)}s` : ""
        // Markdown-escaped: a profile name is team-written text landing in a
        // comment Ucelot posts under its own account, so an underscore in it
        // should read as an underscore rather than start italics.
        const under =
            profile?.kind === "profile" ? ` · under the ${mdEscape(profile.name)} profile` : ""
        out.push(`<sub>🔎 Reviewed by Ucelot${under}${dur}</sub>`, "", `<sub>Ucelot is AI-assisted and can make mistakes — verify findings before acting.</sub>`)
        return out.join("\n")
    }

    /** The collapsed "Changed code" section: up to four diff hunks behind the
     *  non-positive findings. Empty when nothing carries a snippet. */
    private changedCode(r: PrAnalysis, origin: string): string[] {
        const withSnip = (r.findings ?? []).filter((f) => findingState(f.severity) !== "good" && f.snippet?.trim()).slice(0, 4)
        if (!withSnip.length) return []
        const out = ["<details>", `<summary>${this.badgeImg(origin, `Changed code · ${withSnip.length}`, "zinc", { icon: "code", size: "header" })}</summary>`, ""]
        for (const f of withSnip) {
            const loc = f.line ? `${f.file}:${f.line}` : f.file || ""
            out.push(`**${this.esc(f.title || "")}**${loc ? ` — \`${loc}\`` : ""}`, "", "```" + (f.lang || "diff"), f.snippet!.trim(), "```", "")
        }
        out.push("</details>", "")
        return out
    }

    /** Public so the block renderers below can reach the escaping + badge
     *  helpers without every one of them becoming a method on this class. */
    escape(s: string): string {
        return this.esc(s)
    }
    badgeImage(origin: string, text: string, tone: BadgeTone, opts: { icon?: string; size?: "sm" | "header" } = {}): string {
        return this.badgeImg(origin, text, tone, opts)
    }
    titleOf(f: PrFinding): string {
        return this.findingTitle(f)
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
