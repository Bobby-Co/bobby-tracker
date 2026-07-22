// The email side of notifications: the parallel channel that reaches a user when
// they're not looking at the app. ONE entry point — send(id) — invoked by the
// DB→app callback (/api/internal/notification-email, migration 0051's pg_net
// trigger). Best-effort + self-gating: unset SMTP_* short-circuits before any work.
//
// (Legacy trigger-path renderer; retires when the outbox cutover takes over.)

import { mergeVerdictLabel } from "@/lib/shared/rendering/badge"
import { findingState, createServicePullRequestStore } from "@/modules/vcs"
import { isEmailConfigured, sendMail } from "@/lib/server/email/jmap"
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { createServiceClient } from "@/lib/server/supabase"
import type { NotificationKind, PRAnalysis } from "@/lib/shared/types"

type Svc = ReturnType<typeof createServiceClient>

interface NotificationRow {
    id: string
    user_id: string
    project_id: string | null
    kind: NotificationKind
    title: string
    meta: string | null
    href: string | null
}

interface EmailContent {
    subject: string
    html: string
    text: string
}

export class NotificationEmail {
    /** Load the notification, resolve the recipient, send a per-kind email. No-op
     *  (never throws for config/lookup reasons) when email is unconfigured or the
     *  owner has no resolvable address. */
    async send(notificationId: string): Promise<void> {
        if (!isEmailConfigured()) return

        const svc = createServiceClient()
        const { data: n } = await svc
            .from("notifications")
            .select("id,user_id,project_id,kind,title,meta,href")
            .eq("id", notificationId)
            .maybeSingle<NotificationRow>()
        if (!n?.user_id) return

        const email = await this.resolveUserEmail(svc, n.user_id)
        if (!email) return

        const projectName = n.project_id ? await this.loadProjectName(svc, n.project_id) : null
        const built = await this.buildEmail(svc, n, projectName, this.absoluteUrl(n.href))
        await sendMail({ to: email, subject: built.subject, html: built.html, text: built.text })
    }

    // PR reviews get the rich template (enriched from the stored analysis result);
    // everything else gets the generic one from the feed row.
    private async buildEmail(svc: Svc, n: NotificationRow, projectName: string | null, url: string): Promise<EmailContent> {
        if (n.kind === "pr_analysis_ready") {
            const enriched = await this.loadPrResult(svc, n.project_id, n.href)
            if (enriched) {
                return this.prReviewedTemplate(projectName || "your project", enriched.prNumber, url, enriched.result)
            }
        }
        return this.genericTemplate(n.kind, n.title, n.meta, projectName, url)
    }

    // ─── recipient + lookups ─────────────────────────────────────────────────
    // auth.users email via the service-role admin API — identity lives only in
    // Supabase auth (no profiles mirror), and this is a server-to-server context.
    private async resolveUserEmail(svc: Svc, userId: string): Promise<string | null> {
        try {
            const { data, error } = await svc.auth.admin.getUserById(userId)
            if (error) return null
            return data.user?.email ?? null
        } catch {
            return null
        }
    }

    private loadProjectName(svc: Svc, projectId: string): Promise<string | null> {
        return createSupabaseProjectsRepository(svc).findName(projectId)
    }

    // The PR number comes from the notification href (/projects/<id>/pulls/<n>).
    private async loadPrResult(
        svc: Svc,
        projectId: string | null,
        href: string | null,
    ): Promise<{ prNumber: number; result: PRAnalysis } | null> {
        if (!projectId || !href) return null
        const m = href.match(/\/pulls\/(\d+)/)
        if (!m) return null
        const prNumber = Number(m[1])
        const result = await createServicePullRequestStore().findAnalysisResult(projectId, prNumber)
        return result ? { prNumber, result } : null
    }

    // NEXT_PUBLIC_APP_URL is required here (a DB-driven callback has no request
    // origin) — without it the button won't resolve in a mail client.
    private absoluteUrl(href: string | null): string {
        const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "").replace(/\/+$/, "")
        if (!href) return base
        if (/^https?:\/\//.test(href)) return href
        return base ? `${base}${href.startsWith("/") ? "" : "/"}${href}` : href
    }

    // ─── templates ───────────────────────────────────────────────────────────
    private prReviewedTemplate(projectName: string, prNumber: number, url: string, r: PRAnalysis): EmailContent {
        const hasScore = typeof r.score === "number" && typeof r.score_max === "number" && r.score_max > 0
        const scoreStr = hasScore ? `${r.score}/${r.score_max}` : ""
        const verdictLabel = r.verdict ? mergeVerdictLabel(r.verdict) : ""
        const verdictColor = r.verdict ? this.verdictHex(r.verdict) : "#6b7280"

        const findings = r.findings ?? []
        const blockers = findings.filter((f) => findingState(f.severity) === "critical").length
        const toReview = findings.filter((f) => findingState(f.severity) === "review").length
        const summary = (r.summary || "").trim()

        // Score is only shown when the analyser returned one — never invented.
        const subject = hasScore
            ? `PR review ready — ${scoreStr} · ${projectName} #${prNumber}`
            : `PR review ready · ${projectName} #${prNumber}`

        const text = this.compactLines([
            "Your pull request review is ready.",
            "",
            `${projectName} · PR #${prNumber}`,
            hasScore ? `Merge readiness: ${scoreStr}` : null,
            verdictLabel ? `Verdict: ${verdictLabel}` : null,
            blockers || toReview ? `Findings: ${blockers} blocker(s), ${toReview} to review` : null,
            summary ? `\n${summary}` : null,
            "",
            "View the full review:",
            url,
            "",
            "— Ucelot",
            "Ucelot is AI-assisted and can make mistakes — verify findings before acting.",
        ])

        const chips: string[] = []
        if (verdictLabel) chips.push(this.chip(verdictLabel, "#ffffff", verdictColor))
        if (hasScore) chips.push(this.chip(`Merge readiness ${scoreStr}`, "#0f172a", "#f1f5f9"))
        if (blockers) chips.push(this.chip(`${blockers} blocker${blockers === 1 ? "" : "s"}`, "#991b1b", "#fee2e2"))
        if (toReview) chips.push(this.chip(`${toReview} to review`, "#92400e", "#fef3c7"))

        let content = ""
        if (chips.length) content += `<div style="margin-top:18px;">${chips.join("&nbsp;&nbsp;")}</div>`
        if (summary) content += `<p style="margin:18px 0 0 0;font-size:15px;line-height:1.6;color:#334155;">${this.htmlEscape(summary)}</p>`

        const html = this.emailShell({
            eyebrow: "Ucelot · PR review",
            heading: "Your pull request review is ready",
            subline: `${projectName} · PR #${prNumber}`,
            contentHtml: content,
            ctaLabel: "View the full review →",
            ctaUrl: url,
            footerExtra: "Ucelot is AI-assisted and can make mistakes — verify findings before acting.",
        })
        return { subject, html, text }
    }

    private genericTemplate(kind: NotificationKind, title: string, meta: string | null, projectName: string | null, url: string): EmailContent {
        const subline = meta || projectName || ""
        const cta = this.ctaFor(kind)
        // Add the project to the subject when the title doesn't already name it.
        const subject = projectName && !title.includes(projectName) ? `${title} · ${projectName}` : title
        const text = this.compactLines([title, "", subline || null, "", `${cta.replace(/\s*→\s*$/, "")}:`, url, "", "— Ucelot"])
        const html = this.emailShell({
            eyebrow: this.eyebrowFor(kind),
            heading: title,
            subline,
            contentHtml: "",
            ctaLabel: cta,
            ctaUrl: url,
        })
        return { subject, html, text }
    }

    private eyebrowFor(kind: NotificationKind): string {
        switch (kind) {
            case "kb_ready":
            case "kb_updated":
                return "Ucelot · Knowledge base"
            case "pr_opened":
                return "Ucelot · Pull request"
            default:
                return "Ucelot · PR review"
        }
    }

    private ctaFor(kind: NotificationKind): string {
        switch (kind) {
            case "kb_ready":
            case "kb_updated":
                return "Open the project →"
            case "pr_opened":
                return "View the pull request →"
            default:
                return "Open in Ucelot →"
        }
    }

    // ─── html shell + small helpers ──────────────────────────────────────────
    // Self-contained, inline-styled email (clients strip <style>/remote CSS);
    // table-based shell, light theme (clients auto-invert for dark).
    private emailShell(v: {
        eyebrow: string
        heading: string
        subline: string
        contentHtml: string
        ctaLabel: string
        ctaUrl: string
        footerExtra?: string
    }): string {
        const esc = (s: string) => this.htmlEscape(s)
        const content = v.contentHtml ? `<tr><td style="padding:0 32px;">${v.contentHtml}</td></tr>` : ""
        const footerExtra = v.footerExtra ? `${esc(v.footerExtra)}<br>` : ""
        return `<!-- ucelot notification email -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr><td style="padding:28px 32px 0 32px;">
        <div style="font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#64748b;">${esc(v.eyebrow)}</div>
        <div style="margin-top:6px;font-size:22px;font-weight:700;color:#0f172a;line-height:1.3;">${esc(v.heading)}</div>
        ${v.subline ? `<div style="margin-top:6px;font-size:14px;color:#64748b;">${esc(v.subline)}</div>` : ""}
      </td></tr>
      ${content}
      <tr><td style="padding:24px 32px 32px 32px;">
        <a href="${esc(v.ctaUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:10px;">${esc(v.ctaLabel)}</a>
      </td></tr>
      <tr><td style="padding:18px 32px 26px 32px;border-top:1px solid #f1f5f9;font-size:12px;line-height:1.6;color:#94a3b8;">
        ${footerExtra}You're receiving this because you own this project in Ucelot.
      </td></tr>
    </table>
  </td></tr>
</table>`
    }

    private chip(label: string, fg: string, bg: string): string {
        return `<span style="display:inline-block;padding:4px 10px;border-radius:9999px;background:${bg};color:${fg};font-size:12px;font-weight:600;">${this.htmlEscape(label)}</span>`
    }

    private verdictHex(v: string): string {
        return v === "approve" ? "#059669" : v === "request_changes" ? "#e11d48" : "#d97706"
    }

    // Drop nulls and collapse 3+ blank lines so conditional rows don't leave gaps.
    private compactLines(lines: (string | null)[]): string {
        return lines.filter((l): l is string => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim()
    }

    private htmlEscape(s: string): string {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    }
}
