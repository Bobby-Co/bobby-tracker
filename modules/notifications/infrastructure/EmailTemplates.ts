// Notifications infrastructure — the EMAIL TEMPLATES. One builder per
// notification kind, each producing the subject, the HTML body and its
// plain-text alternative.
//
// This is the only place notification email COPY lives. Both senders render
// through it — the legacy trigger path (NotificationEmail) and the outbox
// channel (EmailChannel) — so the two can never drift, and the cutover between
// them changes delivery, not what lands in the inbox.
//
// Every builder degrades: the context carries an ENRICHMENT (the mirrored PR
// row, the stored review result) that the trigger path loads and the outbox
// path may not have. Absent, the mail is shorter but never broken, and a value
// the analyser didn't return — a score, a verdict, a confidence — is never
// invented to fill the layout out.
//
// Presentation only: no I/O and no SDK. The blocks come from the shared email
// design system in lib/server/email/layout.

import {
    bullets,
    callout,
    divider,
    excerpt,
    findingList,
    keyValues,
    meter,
    paragraph,
    plainText,
    renderEmail,
    sectionTitle,
    statGrid,
    type EmailChip,
    type EmailTone,
} from "@/lib/server/email/layout"
import { mergeVerdictLabel } from "@/lib/shared/rendering/badge"
import { findingState } from "@/lib/shared/rendering/finding-state"
import type { NotificationKind, PrAnalysis, PullRequest } from "@/lib/shared/types"

/** Everything a template may draw on. Only `kind`, `projectName` and `url` are
 *  guaranteed; the rest is enrichment the sender supplies when it has it. */
export interface NotificationEmailContext {
    kind: NotificationKind
    projectName: string
    /** Absolute link into the app — the CTA target. */
    url: string
    repoFullName?: string | null
    prNumber?: number | null
    /** The mirrored PR row (pr_opened, and extra colour on a review). */
    pull?: PullRequest | null
    /** The stored review result (pr_analysis_ready). */
    analysis?: PrAnalysis | null
    /** Score headline when the full result isn't loaded (the outbox event
     *  carries these two on their own). */
    score?: number | null
    scoreMax?: number | null
    /** Why indexing failed (kb_failed) — the analyser's last_error. */
    reason?: string | null
    /** The feed row's own copy — the fallback for a kind with no builder. */
    fallbackTitle?: string | null
    fallbackMeta?: string | null
}

export interface RenderedEmail {
    subject: string
    html: string
    text: string
}

/** Render the email for one notification. Exhaustive over NotificationKind —
 *  adding a kind makes the compiler ask for its template. */
export function renderNotificationEmail(ctx: NotificationEmailContext): RenderedEmail {
    switch (ctx.kind) {
        case "pr_analysis_ready":
            return prReviewReady(ctx)
        case "pr_opened":
            return prOpened(ctx)
        case "kb_ready":
            return knowledgeBaseReady(ctx)
        case "kb_updated":
            return knowledgeBaseUpdated(ctx)
        case "kb_failed":
            return knowledgeBaseFailed(ctx)
        default:
            return generic(ctx)
    }
}

// ─── pr_analysis_ready ───────────────────────────────────────────────────────
// The richest of the four: a review the user paid for, summarised well enough
// that they can triage it from the inbox and only open the app to act.

function prReviewReady(ctx: NotificationEmailContext): RenderedEmail {
    const r = ctx.analysis
    const prLabel = ctx.prNumber ? `PR #${ctx.prNumber}` : "your pull request"
    const score = r?.score ?? ctx.score ?? null
    const scoreMax = r?.score_max ?? ctx.scoreMax ?? null
    const scored = typeof score === "number" && typeof scoreMax === "number" && scoreMax > 0
    const scoreStr = scored ? `${score}/${scoreMax}` : ""

    const verdict = r?.verdict ?? null
    const verdictLabel = verdict ? mergeVerdictLabel(verdict) : ""
    const findings = r?.findings ?? []
    const blockers = findings.filter((f) => findingState(f.severity) === "critical")
    const toReview = findings.filter((f) => findingState(f.severity) === "review")

    const summary = (r?.summary ?? "").trim()
    const prTitle = (r?.title ?? ctx.pull?.title ?? "").trim()

    // The heading says the OUTCOME, because that's what the inbox preview shows
    // and what decides whether this gets opened now or later.
    const heading = blockers.length
        ? `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} to clear before merge`
        : verdict === "approve"
          ? "Reviewed — nothing blocking a merge"
          : "Your pull request review is ready"

    const subject = scored
        ? `${heading} — ${scoreStr} · ${ctx.projectName} ${prLabel}`
        : `${heading} · ${ctx.projectName} ${prLabel}`

    const chips: EmailChip[] = []
    if (verdictLabel) chips.push({ label: verdictLabel, tone: verdictTone(verdict) })
    if (scored) chips.push({ label: `merge readiness ${scoreStr}`, tone: "neutral" })
    if (blockers.length) chips.push({ label: `${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`, tone: "critical" })
    if (toReview.length) chips.push({ label: `${toReview.length} to review`, tone: "warning" })

    const blocks: string[] = []

    if (prTitle) blocks.push(callout({ title: prTitle, body: "", tone: "neutral" }))
    if (scored) blocks.push(meter({ label: "Merge readiness", value: score as number, max: scoreMax as number, tone: scoreTone(score as number, scoreMax as number) }))

    if (summary) {
        blocks.push(sectionTitle("Summary"))
        blocks.push(paragraph(excerpt(summary, 700), { lead: true, top: 12 }))
    }
    if (r?.verdict_reason?.trim()) {
        blocks.push(callout({ title: null, body: excerpt(r.verdict_reason, 320), tone: verdictTone(verdict) }))
    }

    const impact = (r?.impact ?? "").trim()
    if (impact) {
        blocks.push(sectionTitle("Impact"))
        blocks.push(paragraph(excerpt(impact, 450), { top: 12 }))
    }
    const impactFiles = (r?.impact_files ?? []).slice(0, 4)
    if (impactFiles.length) {
        blocks.push(bullets(impactFiles.map((f) => `${f.file}${f.reason ? ` — ${excerpt(f.reason, 110)}` : ""}`), { marker: "›", tone: "info" }))
    }

    // Blockers first: the order the user has to act in, not the order the
    // analyser happened to emit.
    const shown = [...blockers, ...toReview].slice(0, 5)
    if (shown.length) {
        blocks.push(divider())
        blocks.push(sectionTitle(`Findings (${blockers.length + toReview.length})`))
        blocks.push(
            findingList(
                shown.map((f) => {
                    const state = findingState(f.severity)
                    return {
                        tone: state === "critical" ? ("critical" as const) : ("warning" as const),
                        label: state === "critical" ? (f.category ? `blocker · ${topic(f.category)}` : "blocker") : topic(f.category) || "to review",
                        title: f.title?.trim() || excerpt(f.detail, 90),
                        detail: f.title?.trim() ? excerpt(f.detail, 260) : null,
                        location: f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : null,
                    }
                }),
            ),
        )
        const rest = blockers.length + toReview.length - shown.length
        if (rest > 0) blocks.push(paragraph(`+ ${rest} more finding${rest === 1 ? "" : "s"} in the full review.`, { top: 6 }))
    }

    const checklist = (r?.checklist ?? []).slice(0, 5)
    if (checklist.length) {
        blocks.push(sectionTitle("Verify before merge"))
        blocks.push(bullets(checklist.map((c) => excerpt(c, 160)), { marker: "☐", tone: "ember" }))
    }

    // The diligence footer: what the reviewer actually inspected. It's the
    // difference between "a model said so" and a grounded review.
    const checks = r?.checks
    if (checks) {
        const stats = [
            { label: "precedents", value: num(checks.precedents) },
            { label: "callers", value: num(checks.callers) },
            { label: "tests", value: num(checks.tests) },
            { label: "failure probes", value: num(checks.failure_probes) },
        ].filter((s) => s.value !== "")
        if (stats.length) {
            blocks.push(sectionTitle("What the reviewer checked"))
            blocks.push(statGrid(stats))
        }
    }

    const meta: { label: string; value: string }[] = []
    if (r?.confidences) {
        meta.push({ label: "Correctness", value: confidenceValue(r.confidences.correctness) })
        meta.push({ label: "Load & perf", value: confidenceValue(r.confidences.load_perf) })
        meta.push({ label: "Security", value: confidenceValue(r.confidences.security) })
    } else if (r?.confidence) {
        meta.push({ label: "Confidence", value: r.confidence })
    }
    if (ctx.repoFullName) meta.push({ label: "Repository", value: ctx.repoFullName })
    if (typeof r?.duration_ms === "number" && r.duration_ms > 0) meta.push({ label: "Review took", value: duration(r.duration_ms) })
    if (meta.length) {
        blocks.push(divider())
        blocks.push(keyValues(meta))
    }

    const html = renderEmail({
        preheader: summary ? excerpt(summary, 140) : `${ctx.projectName} · ${prLabel}${scored ? ` · ${scoreStr}` : ""}`,
        kicker: "Pull request review",
        heading,
        subheading: `${ctx.projectName} · ${prLabel}`,
        chips,
        blocks,
        action: { label: "Open the full review", url: ctx.url },
        secondary: ctx.pull?.html_url ? { label: "View the pull request on GitHub →", url: ctx.pull.html_url } : null,
        footerNote: "Ucelot is AI-assisted and can make mistakes — verify findings before acting on them.",
    })

    const text = plainText([
        heading,
        "",
        `${ctx.projectName} · ${prLabel}`,
        prTitle || null,
        scored ? `Merge readiness: ${scoreStr}` : null,
        verdictLabel ? `Verdict: ${verdictLabel}` : null,
        blockers.length || toReview.length ? `Findings: ${blockers.length} blocker(s), ${toReview.length} to review` : null,
        "",
        summary ? excerpt(summary, 700) : null,
        "",
        shown.length ? "FINDINGS" : null,
        ...shown.map((f) => `- [${findingState(f.severity)}] ${f.title?.trim() || excerpt(f.detail, 90)}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : ""}`),
        "",
        checklist.length ? "VERIFY BEFORE MERGE" : null,
        ...checklist.map((c) => `- ${excerpt(c, 160)}`),
        "",
        "Open the full review:",
        ctx.url,
        "",
        "— Ucelot",
        "Ucelot is AI-assisted and can make mistakes — verify findings before acting on them.",
    ])

    return { subject, html, text }
}

// ─── pr_opened ───────────────────────────────────────────────────────────────

function prOpened(ctx: NotificationEmailContext): RenderedEmail {
    const pr = ctx.pull
    const number = ctx.prNumber ?? pr?.pr_number ?? null
    const prLabel = number ? `PR #${number}` : "a pull request"
    const author = pr?.author_login ?? null
    const heading = author ? `${author} opened ${prLabel}` : `${prLabel} was opened`
    const subject = pr?.title ? `${heading}: ${pr.title} · ${ctx.projectName}` : `${heading} · ${ctx.projectName}`

    const chips: EmailChip[] = []
    if (pr?.draft) chips.push({ label: "draft", tone: "neutral" })
    if (pr?.head_ref && pr?.base_ref) chips.push({ label: `${pr.head_ref} → ${pr.base_ref}`, tone: "info" })

    const blocks: string[] = []
    if (pr?.title) blocks.push(callout({ title: pr.title, body: pr.body ? excerpt(pr.body, 420) : "", tone: "neutral" }))

    const stats = [
        { label: "files", value: num(pr?.changed_files) },
        { label: "added", value: pr?.additions != null ? `+${pr.additions}` : "", tone: "positive" as EmailTone },
        { label: "removed", value: pr?.deletions != null ? `−${pr.deletions}` : "", tone: "critical" as EmailTone },
        { label: "comments", value: num(pr?.comments_count) },
    ].filter((s) => s.value !== "")
    if (stats.length) blocks.push(statGrid(stats))

    const meta: { label: string; value: string }[] = []
    if (author) meta.push({ label: "Author", value: author })
    if (ctx.repoFullName) meta.push({ label: "Repository", value: ctx.repoFullName })
    if (pr?.head_ref && pr?.base_ref) meta.push({ label: "Branch", value: `${pr.head_ref} → ${pr.base_ref}` })
    if (pr?.gh_created_at) meta.push({ label: "Opened", value: shortDate(pr.gh_created_at) })
    if (meta.length) blocks.push(keyValues(meta))

    const html = renderEmail({
        preheader: pr?.title ? excerpt(pr.title, 140) : `${ctx.projectName} · ${prLabel}`,
        kicker: "Pull request",
        heading,
        subheading: `${ctx.projectName} · ${prLabel}`,
        chips,
        blocks,
        action: { label: "Open the pull request", url: ctx.url },
        secondary: pr?.html_url ? { label: "View it on GitHub →", url: pr.html_url } : null,
    })

    const text = plainText([
        heading,
        "",
        `${ctx.projectName} · ${prLabel}`,
        pr?.title ? `Title: ${pr.title}` : null,
        pr?.head_ref && pr?.base_ref ? `Branch: ${pr.head_ref} → ${pr.base_ref}` : null,
        pr?.changed_files != null ? `Changed files: ${pr.changed_files}` : null,
        pr?.additions != null && pr?.deletions != null ? `Diff: +${pr.additions} / -${pr.deletions}` : null,
        "",
        pr?.body ? excerpt(pr.body, 420) : null,
        "",
        "Open the pull request:",
        ctx.url,
        pr?.html_url ? `On GitHub: ${pr.html_url}` : null,
        "",
        "— Ucelot",
    ])

    return { subject, html, text }
}

// ─── kb_ready / kb_updated ───────────────────────────────────────────────────
// A knowledge-base mail's job is to tell the user the waiting is over AND what
// the wait bought them — this is the first moment the product actually works
// for that repo, and "Knowledge base is ready!" alone doesn't say what to do.

function knowledgeBaseReady(ctx: NotificationEmailContext): RenderedEmail {
    const heading = `${ctx.projectName} is indexed and ready`
    const blocks = [
        paragraph(
            `Ucelot has finished reading ${ctx.repoFullName || ctx.projectName} and built its knowledge base. ` +
                "Everything that depends on understanding the codebase is live from now on.",
            { lead: true },
        ),
        sectionTitle("What that unlocks"),
        bullets([
            "Pull request reviews grounded in the real code — precedents, callers and tests, not guesses.",
            "Ask questions about the codebase and get answers that cite the files they came from.",
            "New issues are checked against existing ones, so duplicates surface as you write them.",
            "Your editor's agent can reach the same knowledge base over MCP.",
        ]),
        ctx.repoFullName ? keyValues([{ label: "Repository", value: ctx.repoFullName }]) : "",
    ]

    const html = renderEmail({
        preheader: `${ctx.projectName} is indexed — reviews, search and duplicate detection are live.`,
        kicker: "Knowledge base",
        heading,
        subheading: ctx.repoFullName || ctx.projectName,
        chips: [{ label: "first build complete", tone: "positive" }],
        blocks,
        action: { label: `Open ${excerpt(ctx.projectName, 28)}`, url: ctx.url },
    })

    const text = plainText([
        heading,
        "",
        `Ucelot has finished reading ${ctx.repoFullName || ctx.projectName} and built its knowledge base.`,
        "",
        "What that unlocks:",
        "- Pull request reviews grounded in the real code.",
        "- Questions about the codebase, answered with the files they came from.",
        "- Duplicate detection on new issues.",
        "- The same knowledge base in your editor over MCP.",
        "",
        "Open the project:",
        ctx.url,
        "",
        "— Ucelot",
    ])

    return { subject: `${ctx.projectName} is indexed and ready`, html, text }
}

function knowledgeBaseUpdated(ctx: NotificationEmailContext): RenderedEmail {
    const heading = `${ctx.projectName}'s knowledge base is up to date`
    const blocks = [
        paragraph(
            `Ucelot re-indexed ${ctx.repoFullName || ctx.projectName}. Reviews, search and duplicate detection are now reading the latest code — ` +
                "anything reviewed from here on is judged against what's on the branch today, not the last build.",
            { lead: true },
        ),
        ctx.repoFullName ? keyValues([{ label: "Repository", value: ctx.repoFullName }]) : "",
    ]

    const html = renderEmail({
        preheader: `${ctx.projectName} was re-indexed — reviews now read the latest code.`,
        kicker: "Knowledge base",
        heading,
        subheading: ctx.repoFullName || ctx.projectName,
        chips: [{ label: "re-indexed", tone: "info" }],
        blocks,
        action: { label: `Open ${excerpt(ctx.projectName, 28)}`, url: ctx.url },
    })

    const text = plainText([
        heading,
        "",
        `Ucelot re-indexed ${ctx.repoFullName || ctx.projectName}. Reviews, search and duplicate detection are reading the latest code.`,
        "",
        "Open the project:",
        ctx.url,
        "",
        "— Ucelot",
    ])

    return { subject: heading, html, text }
}

// The one piece of bad news the product sends. It has a different job from the
// others: not "here is what happened" but "here is what to do about it", because
// until this is fixed the project is connected and inert — no reviews, no
// grounded answers, no duplicate detection.
function knowledgeBaseFailed(ctx: NotificationEmailContext): RenderedEmail {
    const heading = `Indexing failed for ${ctx.projectName}`
    const reason = (ctx.reason ?? "").trim()

    const blocks: string[] = [
        paragraph(
            `Ucelot couldn't finish reading ${ctx.repoFullName || ctx.projectName}, so its knowledge base wasn't built. ` +
                "Until it is, pull request reviews, codebase answers and duplicate detection have nothing to work from on this project.",
            { lead: true },
        ),
    ]

    // The analyser's own error, verbatim and monospaced. Not paraphrased: it is
    // the only thing in the mail that can tell someone whether this is a bad
    // token, a repository too large, or something to report.
    if (reason) {
        blocks.push(sectionTitle("What the analyser reported"))
        blocks.push(callout({ title: null, body: excerpt(reason, 600), tone: "critical", mono: true }))
    }

    blocks.push(sectionTitle("Worth checking"))
    blocks.push(
        bullets(
            [
                "That the repository still exists and Ucelot's access to it hasn't been revoked.",
                "That the connection is still authorised — a rotated or expired token fails exactly like this.",
                "Then start indexing again from the project's page. Most failures are transient.",
            ],
            { tone: "critical" },
        ),
    )
    if (ctx.repoFullName) blocks.push(keyValues([{ label: "Repository", value: ctx.repoFullName }]))

    const html = renderEmail({
        preheader: reason ? excerpt(reason, 140) : `${ctx.projectName} could not be indexed.`,
        kicker: "Knowledge base",
        heading,
        subheading: ctx.repoFullName || ctx.projectName,
        chips: [{ label: "indexing failed", tone: "critical" }],
        blocks,
        action: { label: "Open the project and retry", url: ctx.url },
    })

    const text = plainText([
        heading,
        "",
        `Ucelot couldn't finish reading ${ctx.repoFullName || ctx.projectName}, so its knowledge base wasn't built. Until it is, reviews, codebase answers and duplicate detection have nothing to work from on this project.`,
        "",
        reason ? "What the analyser reported:" : null,
        reason ? excerpt(reason, 600) : null,
        "",
        "Worth checking:",
        "- That the repository still exists and Ucelot's access hasn't been revoked.",
        "- That the connection is still authorised — a rotated or expired token fails exactly like this.",
        "- Then start indexing again from the project's page. Most failures are transient.",
        "",
        "Open the project:",
        ctx.url,
        "",
        "— Ucelot",
    ])

    return { subject: heading, html, text }
}

// ─── fallback ────────────────────────────────────────────────────────────────
// Reached only by a kind persisted in the database that this build has no
// template for (an older app serving a newer row). Renders the feed row's own
// copy through the same shell rather than dropping the mail.

function generic(ctx: NotificationEmailContext): RenderedEmail {
    const title = ctx.fallbackTitle?.trim() || "You have an update in Ucelot"
    const subline = ctx.fallbackMeta || ctx.projectName
    const subject = ctx.projectName && !title.includes(ctx.projectName) ? `${title} · ${ctx.projectName}` : title
    const html = renderEmail({
        preheader: subline || title,
        kicker: "Notification",
        heading: title,
        subheading: subline,
        blocks: [],
        action: { label: "Open in Ucelot", url: ctx.url },
    })
    const text = plainText([title, "", subline || null, "", "Open in Ucelot:", ctx.url, "", "— Ucelot"])
    return { subject, html, text }
}

// ─── small helpers ───────────────────────────────────────────────────────────

function verdictTone(verdict: string | null): EmailTone {
    if (verdict === "approve") return "positive"
    if (verdict === "request_changes") return "critical"
    return "warning"
}

// The readiness bar shares the traffic-light reading of the app's own score.
function scoreTone(score: number, max: number): EmailTone {
    const ratio = score / max
    return ratio >= 0.8 ? "positive" : ratio >= 0.5 ? "warning" : "critical"
}

function confidenceValue(d: { level: string; basis: string }): string {
    return d.basis ? `${d.level} — ${excerpt(d.basis, 90)}` : d.level
}

/** The analyser's category vocabulary is snake_case ("test_gap", "blast_radius");
 *  a label is read, not parsed. */
function topic(category: string | undefined): string {
    return (category ?? "").replace(/_/g, " ").trim()
}

function num(n: number | null | undefined): string {
    return typeof n === "number" ? String(n) : ""
}

function duration(ms: number): string {
    const s = Math.round(ms / 1000)
    return s < 90 ? `${s}s` : `${Math.round(s / 60)}m`
}

function shortDate(iso: string): string {
    const d = new Date(iso)
    return Number.isNaN(d.getTime())
        ? ""
        : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}
