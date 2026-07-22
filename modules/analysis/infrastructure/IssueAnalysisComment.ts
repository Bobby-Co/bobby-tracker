import { badge, confidenceTone } from "@/lib/shared/rendering/badge"
import { RepoRef, type RepoRefFields } from "@/modules/vcs/domain/RepoRef"
import type { IssueAnalysis } from "../ports/AnalyserTypes"

export type CommentCtx = { origin: string; projectId: string; issueId: string }

/** Builds the bot-comment body for an issue's analysis run. */
export class IssueAnalysisComment {
    private readonly marker = "<!-- bobby:analysis -->"

    loading(ctx: CommentCtx): string {
        return [
            this.marker,
            `${this.brandMark(ctx.origin)} **Ucelot** is analyzing this issue…`,
            "",
            badge(ctx.origin, "analyzing", "blue"),
            "",
            "Scanning the codebase to locate the relevant files — this comment updates automatically when it's ready.",
            "",
            this.footer(ctx),
        ].join("\n")
    }

    cancelled(ctx: CommentCtx): string {
        return [
            this.marker,
            "**Ucelot** — analysis cancelled",
            "",
            badge(ctx.origin, "cancelled", "zinc"),
            "",
            "The issue was closed before analysis finished.",
            "",
            this.footer(ctx),
        ].join("\n")
    }

    failed(ctx: CommentCtx): string {
        return [
            this.marker,
            "**Ucelot** — analysis unavailable",
            "",
            badge(ctx.origin, "failed", "rose"),
            "",
            "Ucelot couldn't complete the analysis this time.",
            "",
            this.footer(ctx),
        ].join("\n")
    }

    result(result: IssueAnalysis, project: RepoRefFields, ctx: CommentCtx): string {
        const out: string[] = [this.marker, "### Ucelot · code analysis", ""]

        const badges: string[] = []
        if (result.confidence) badges.push(badge(ctx.origin, `confidence: ${result.confidence}`, confidenceTone(result.confidence)))
        if (result.suggestions?.length) badges.push(badge(ctx.origin, `${result.suggestions.length} candidates`, "zinc"))
        if (badges.length) out.push(badges.join(" "), "")

        if (result.summary?.trim()) out.push(`> ${result.summary.trim().replace(/\n/g, "\n> ")}`, "")

        if (result.suggestions?.length) {
            out.push("**Most likely locations**", "", "| # | Location | Why |", "|--:|:--|:--|")
            result.suggestions.forEach((s, i) => {
                const link = RepoRef.of(project).blobUrl(s.file, s.line, null)
                const label = s.line ? `${s.file}:${s.line}` : s.file
                const loc = link ? `[\`${label}\`](${link})` : `\`${label}\``
                const sym = s.symbol ? ` \`${s.symbol}\`` : ""
                out.push(`| ${i + 1} | ${loc}${sym} | ${this.escapeCell(s.reason)} |`)
            })
            out.push("")
        } else if (result.markdown?.trim()) {
            out.push(result.markdown.trim(), "")
        }

        const dur = result.duration_ms ? `analysed in ${(result.duration_ms / 1000).toFixed(1)}s` : undefined
        out.push(this.footer(ctx, dur))
        return out.join("\n")
    }

    private footer(ctx: CommentCtx, extra?: string): string {
        return `<sub>${this.issueLink(ctx)}${extra ? ` · ${extra}` : ""}</sub>`
    }

    private issueLink(ctx: CommentCtx): string {
        return `<a href="${ctx.origin}/projects/${ctx.projectId}/issues/${ctx.issueId}">Open in ucelot ↗</a>`
    }

    private brandMark(origin: string): string {
        return `<img src="${origin}/brand_loader.webp" width="18" align="middle" alt="Ucelot" />`
    }

    private escapeCell(s: string): string {
        return s.replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim()
    }
}
