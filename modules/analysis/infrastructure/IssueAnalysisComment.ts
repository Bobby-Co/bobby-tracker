// Analysis presentation — rendering an analyser run as the markdown body of the
// bot comment on the linked issue. HOW an analysis result reads as a comment is
// an analysis concern; the vcs module only provides the generic "post/edit a
// comment" tool (VcsAppService). Pure string building, no I/O — a cohesive
// renderer owned by this concept file (only the four body renderers + CommentCtx
// are the surface; the marker/footer/escaping helpers are internals).
//
// blobUrl comes from the vcs domain's pure repo helper via the deep path (not the
// vcs barrel) so this renderer carries no adapter/SDK dependency.

import { badge, confidenceTone } from "@/lib/rendering/badge"
import { blobUrl, type RepoRef } from "@/modules/vcs/domain/RepoRef"
import type { IssueAnalysis } from "../ports/AnalyserTypes"

// Hidden marker so a later pass can find/dedupe Ucelot's own comment.
const BOBBY_MARKER = "<!-- bobby:analysis -->"

/** Context for the footer link back into ucelot. */
export type CommentCtx = { origin: string; projectId: string; issueId: string }

function issueLink(ctx: CommentCtx): string {
    return `<a href="${ctx.origin}/projects/${ctx.projectId}/issues/${ctx.issueId}">Open in ucelot ↗</a>`
}

function footer(ctx: CommentCtx, extra?: string): string {
    return `<sub>${issueLink(ctx)}${extra ? ` · ${extra}` : ""}</sub>`
}

// Small self-hosted brand loader (public/brand_loader.webp), inline.
function brandMark(origin: string): string {
    return `<img src="${origin}/brand_loader.webp" width="18" align="middle" alt="Ucelot" />`
}

// escapeCell keeps a findings-table cell single-line and pipe-safe.
function escapeCell(s: string): string {
    return s.replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim()
}

export function loadingCommentBody(ctx: CommentCtx): string {
    return [
        BOBBY_MARKER,
        `${brandMark(ctx.origin)} **Ucelot** is analyzing this issue…`,
        "",
        badge(ctx.origin, "analyzing", "blue"),
        "",
        "Scanning the codebase to locate the relevant files — this comment updates automatically when it's ready.",
        "",
        footer(ctx),
    ].join("\n")
}

export function cancelledCommentBody(ctx: CommentCtx): string {
    return [
        BOBBY_MARKER,
        "**Ucelot** — analysis cancelled",
        "",
        badge(ctx.origin, "cancelled", "zinc"),
        "",
        "The issue was closed before analysis finished.",
        "",
        footer(ctx),
    ].join("\n")
}

export function failedCommentBody(ctx: CommentCtx): string {
    return [
        BOBBY_MARKER,
        "**Ucelot** — analysis unavailable",
        "",
        badge(ctx.origin, "failed", "rose"),
        "",
        "Ucelot couldn't complete the analysis this time.",
        "",
        footer(ctx),
    ].join("\n")
}

// resultCommentBody renders the result as a compact report: a badge row
// (confidence + candidate count), a one-line summary blockquote, and a ranked
// findings table with blob deep-links. Falls back to the analyser's own markdown
// when it returned no structured suggestions.
export function resultCommentBody(result: IssueAnalysis, project: RepoRef, ctx: CommentCtx): string {
    const out: string[] = [BOBBY_MARKER, "### Ucelot · code analysis", ""]

    const badges: string[] = []
    if (result.confidence) {
        badges.push(badge(ctx.origin, `confidence: ${result.confidence}`, confidenceTone(result.confidence)))
    }
    if (result.suggestions?.length) {
        badges.push(badge(ctx.origin, `${result.suggestions.length} candidates`, "zinc"))
    }
    if (badges.length) out.push(badges.join(" "), "")

    if (result.summary?.trim()) out.push(`> ${result.summary.trim().replace(/\n/g, "\n> ")}`, "")

    if (result.suggestions?.length) {
        out.push("**Most likely locations**", "", "| # | Location | Why |", "|--:|:--|:--|")
        result.suggestions.forEach((s, i) => {
            const link = blobUrl(project, s.file, s.line, null)
            const label = s.line ? `${s.file}:${s.line}` : s.file
            const loc = link ? `[\`${label}\`](${link})` : `\`${label}\``
            const sym = s.symbol ? ` \`${s.symbol}\`` : ""
            out.push(`| ${i + 1} | ${loc}${sym} | ${escapeCell(s.reason)} |`)
        })
        out.push("")
    } else if (result.markdown?.trim()) {
        out.push(result.markdown.trim(), "")
    }

    const dur = result.duration_ms ? `analysed in ${(result.duration_ms / 1000).toFixed(1)}s` : undefined
    out.push(footer(ctx, dur))
    return out.join("\n")
}
