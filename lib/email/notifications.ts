// Email side of the notification system. The in-app feed (the topbar bell) is
// written by DB triggers (migration 0049); email is the parallel channel that
// reaches the user when they're not looking at the app.
//
// There is ONE entry point — sendNotificationEmail(id) — invoked by the DB→app
// callback (/api/internal/notification-email, fired by migration 0051's pg_net
// trigger on every notification insert). It reloads the row, resolves the
// owner's address, and renders a per-kind email. This is the single dispatch
// path for every kind, including the KB events that have no app-code hook at all.
//
// Everything here is best-effort and self-gating: if SMTP_* is unset,
// isEmailConfigured() short-circuits before any work or any Workers-only import.

import { mergeVerdictLabel } from "@/lib/badge"
import { findingState } from "@/modules/pull-requests"
import { isEmailConfigured, sendMail } from "@/lib/email/jmap"
import { createServiceClient } from "@/lib/supabase/server"
import type { NotificationKind, PRAnalysis } from "@/lib/supabase/types"

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

// sendNotificationEmail loads the notification, resolves the recipient, and
// sends a per-kind email. No-op (never throws for config/lookup reasons) when
// email is unconfigured or the owner has no resolvable address.
export async function sendNotificationEmail(notificationId: string): Promise<void> {
    if (!isEmailConfigured()) return

    const svc = createServiceClient()
    const { data: n } = await svc
        .from("notifications")
        .select("id,user_id,project_id,kind,title,meta,href")
        .eq("id", notificationId)
        .maybeSingle<NotificationRow>()
    if (!n?.user_id) return

    const email = await resolveUserEmail(svc, n.user_id)
    if (!email) return

    const projectName = n.project_id ? await loadProjectName(svc, n.project_id) : null
    const url = absoluteUrl(n.href)
    const built = await buildEmail(svc, n, projectName, url)
    await sendMail({ to: email, subject: built.subject, html: built.html, text: built.text })
}

// buildEmail renders the right template for the kind. PR reviews get the rich
// template (enriched from the stored analysis result); everything else gets the
// generic one built straight from the feed row's title/meta/href.
async function buildEmail(
    svc: Svc,
    n: NotificationRow,
    projectName: string | null,
    url: string,
): Promise<{ subject: string; html: string; text: string }> {
    if (n.kind === "pr_analysis_ready") {
        const enriched = await loadPrResult(svc, n.project_id, n.href)
        if (enriched) {
            return prReviewedTemplate({
                projectName: projectName || "your project",
                prNumber: enriched.prNumber,
                url,
                result: enriched.result,
            })
        }
        // Legacy row with no stored result — fall through to the generic email.
    }
    return genericTemplate({ kind: n.kind, title: n.title, meta: n.meta, projectName, url })
}

// ─── recipient + lookups ────────────────────────────────────────────────────

// resolveUserEmail looks up an auth.users email via the service-role admin API.
// There is no profiles mirror table — identity lives only in Supabase auth — and
// this is a server-to-server context with no logged-in user, so the admin
// endpoint is the way in. (db.schema:"tracker" on the service client doesn't
// affect the auth admin surface.)
async function resolveUserEmail(svc: Svc, userId: string): Promise<string | null> {
    try {
        const { data, error } = await svc.auth.admin.getUserById(userId)
        if (error) return null
        return data.user?.email ?? null
    } catch {
        return null
    }
}

async function loadProjectName(svc: Svc, projectId: string): Promise<string | null> {
    const { data } = await svc.from("projects").select("name").eq("id", projectId).maybeSingle<{ name: string | null }>()
    return data?.name ?? null
}

// loadPrResult pulls the stored analysis so the review email can show the score,
// verdict, and finding counts. The PR number comes from the notification href
// (/projects/<id>/pulls/<n>) — the feed row doesn't carry the analysis id.
async function loadPrResult(
    svc: Svc,
    projectId: string | null,
    href: string | null,
): Promise<{ prNumber: number; result: PRAnalysis } | null> {
    if (!projectId || !href) return null
    const m = href.match(/\/pulls\/(\d+)/)
    if (!m) return null
    const prNumber = Number(m[1])
    const { data } = await svc
        .from("pull_request_analyses")
        .select("result")
        .eq("project_id", projectId)
        .eq("pr_number", prNumber)
        .maybeSingle<{ result: PRAnalysis | null }>()
    if (!data?.result) return null
    return { prNumber, result: data.result }
}

// absoluteUrl turns a notification's relative href into a full link for email.
// This path has no request origin (it's a DB-driven callback), so
// NEXT_PUBLIC_APP_URL is required for links to resolve — without it the href
// stays relative and the button won't work in a mail client.
function absoluteUrl(href: string | null): string {
    const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "").replace(/\/+$/, "")
    if (!href) return base
    if (/^https?:\/\//.test(href)) return href
    return base ? `${base}${href.startsWith("/") ? "" : "/"}${href}` : href
}

// ─── templates ──────────────────────────────────────────────────────────────

interface PrReviewedTemplateInput {
    projectName: string
    prNumber: number
    url: string
    result: PRAnalysis
}

function prReviewedTemplate(input: PrReviewedTemplateInput): { subject: string; html: string; text: string } {
    const { projectName, prNumber, url, result: r } = input
    const hasScore = typeof r.score === "number" && typeof r.score_max === "number" && r.score_max > 0
    const scoreStr = hasScore ? `${r.score}/${r.score_max}` : ""
    const verdictLabel = r.verdict ? mergeVerdictLabel(r.verdict) : ""
    const verdictColor = r.verdict ? verdictHex(r.verdict) : "#6b7280"

    const findings = r.findings ?? []
    const blockers = findings.filter((f) => findingState(f.severity) === "critical").length
    const toReview = findings.filter((f) => findingState(f.severity) === "review").length
    const summary = (r.summary || "").trim()

    // Subject mirrors the in-app feed title ("PR review ready — X/N") and adds
    // the project + PR for inbox context. Score is only shown when the analyser
    // actually returned one — never invented (see migration 0049's note).
    const subject = hasScore
        ? `PR review ready — ${scoreStr} · ${projectName} #${prNumber}`
        : `PR review ready · ${projectName} #${prNumber}`

    const text = compactLines([
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
    if (verdictLabel) chips.push(chip(verdictLabel, "#ffffff", verdictColor))
    if (hasScore) chips.push(chip(`Merge readiness ${scoreStr}`, "#0f172a", "#f1f5f9"))
    if (blockers) chips.push(chip(`${blockers} blocker${blockers === 1 ? "" : "s"}`, "#991b1b", "#fee2e2"))
    if (toReview) chips.push(chip(`${toReview} to review`, "#92400e", "#fef3c7"))

    let content = ""
    if (chips.length) content += `<div style="margin-top:18px;">${chips.join("&nbsp;&nbsp;")}</div>`
    if (summary) {
        content += `<p style="margin:18px 0 0 0;font-size:15px;line-height:1.6;color:#334155;">${htmlEscape(summary)}</p>`
    }

    const html = emailShell({
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

interface GenericTemplateInput {
    kind: NotificationKind
    title: string
    meta: string | null
    projectName: string | null
    url: string
}

function genericTemplate(v: GenericTemplateInput): { subject: string; html: string; text: string } {
    const eyebrow = eyebrowFor(v.kind)
    const cta = ctaFor(v.kind)
    const subline = v.meta || v.projectName || ""
    // Add the project to the subject when the title doesn't already name it
    // (KB titles are generic — "Knowledge base is ready!").
    const subject = v.projectName && !v.title.includes(v.projectName) ? `${v.title} · ${v.projectName}` : v.title

    const text = compactLines([v.title, "", subline || null, "", `${cta.replace(/\s*→\s*$/, "")}:`, v.url, "", "— Ucelot"])
    const html = emailShell({
        eyebrow,
        heading: v.title,
        subline,
        contentHtml: "",
        ctaLabel: cta,
        ctaUrl: v.url,
    })
    return { subject, html, text }
}

function eyebrowFor(kind: NotificationKind): string {
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

function ctaFor(kind: NotificationKind): string {
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

// ─── html shell ─────────────────────────────────────────────────────────────

interface EmailShellInput {
    eyebrow: string
    heading: string
    subline: string
    /** Optional HTML injected between the subline and the CTA (chips, summary). */
    contentHtml: string
    ctaLabel: string
    ctaUrl: string
    /** Optional extra footer line above the ownership note. */
    footerExtra?: string
}

// emailShell renders a self-contained, inline-styled email (no external assets —
// clients strip <style>/remote CSS). Table-based shell for client compatibility;
// light theme (clients auto-invert for dark mode).
function emailShell(v: EmailShellInput): string {
    const esc = htmlEscape
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

// ─── small helpers ──────────────────────────────────────────────────────────

function chip(label: string, fg: string, bg: string): string {
    return `<span style="display:inline-block;padding:4px 10px;border-radius:9999px;background:${bg};color:${fg};font-size:12px;font-weight:600;">${htmlEscape(label)}</span>`
}

function verdictHex(v: string): string {
    return v === "approve" ? "#059669" : v === "request_changes" ? "#e11d48" : "#d97706"
}

// compactLines drops nulls and collapses 3+ blank lines, so conditional rows
// don't leave ragged gaps in the plain-text part.
function compactLines(lines: (string | null)[]): string {
    return lines
        .filter((l): l is string => l !== null)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

function htmlEscape(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
