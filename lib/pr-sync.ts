// PR-analysis orchestration: on a GitHub pull_request event the tracker fetches
// the diff, posts an "analysing…" comment, kicks a DETACHED analyser run
// (/pr/analyse/run), and edits that comment in place when the analyser calls
// back (/api/internal/pr-analysis-result). Closing the PR cancels the run.
// GitHub I/O lives here (the App creds are here); the analyser is GitHub-free.
// See the analyser's ADR-0052 + pr.go/pr_async.go.

import { badge, type BadgeTone, badgeUrl, confidenceImage, mergeVerdictIcon, mergeVerdictLabel, mergeVerdictTone, scoreImage, verdictTone } from "@/lib/badge"
import { findingState } from "@/modules/pull-requests"
import { createIssueComment, listPullRequestFiles, updateIssueComment } from "@/lib/github-app"
import { repoFullName } from "@/lib/integrations/github"
import { cancelPRAnalysis as analyserCancelPR, runPRAnalysis, type PRAnalyseFile } from "@/lib/analyser"
import { createServiceClient } from "@/lib/supabase/server"
import type { PRAnalysis, PRFinding, Project } from "@/lib/supabase/types"

// The subset of a tracker.projects row PR analysis reads.
type PRProject = Pick<Project, "id" | "repo_url" | "repo_full_name"> & {
    github_installation_id: number | null
    github_repo_id: number | null
    github_sync_enabled: boolean
}

const PR_PROJECT_COLS =
    "id,repo_url,repo_full_name,github_installation_id,github_repo_id,github_sync_enabled"

// PRInput is the PR metadata from the webhook payload.
export type PRInput = {
    number: number
    title: string
    body: string | null
    baseSha: string | null
    headSha: string | null
}

function prReady(p: PRProject): boolean {
    return p.github_sync_enabled && p.github_installation_id != null && p.github_repo_id != null
}

// startPRAnalysis gates on the App being linked + the graph indexed, fetches the
// PR diff, posts (or re-uses) the "analysing…" comment, upserts the tracking row
// (its id is the analyser task_id), and kicks the detached run. Idempotent: a
// run already in flight for this PR is left alone.
export async function startPRAnalysis(project: PRProject, pr: PRInput, origin: string): Promise<void> {
    if (!prReady(project)) return
    const full = repoFullName(project)
    if (!full) return
    const [owner, repo] = full.split("/")
    const installationId = project.github_installation_id!

    const svc = createServiceClient()

    // Gate: the graph must be indexed for the review to have codebase context.
    const { data: analyser } = await svc
        .from("project_analyser")
        .select("enabled,status,graph_id")
        .eq("project_id", project.id)
        .maybeSingle<{ enabled: boolean; status: string; graph_id: string | null }>()
    if (!analyser?.enabled || analyser.status !== "ready" || !analyser.graph_id) return

    // Idempotency: don't start a second run while one is in flight for this PR.
    const { data: existing } = await svc
        .from("pull_request_analyses")
        .select("id,status,github_comment_id")
        .eq("project_id", project.id)
        .eq("pr_number", pr.number)
        .maybeSingle<{ id: string; status: string | null; github_comment_id: number | null }>()
    if (existing?.status === "analysing") return

    // Fetch the diff (per-file patches).
    let files: PRAnalyseFile[]
    try {
        const gh = await listPullRequestFiles(installationId, owner, repo, pr.number)
        files = gh.map((f) => ({
            path: f.filename,
            previous_path: f.previous_filename,
            status: f.status,
            patch: f.patch,
            additions: f.additions,
            deletions: f.deletions,
        }))
    } catch {
        return
    }
    if (files.length === 0) return

    // Loading comment: edit the prior one on a re-run, else post fresh.
    const loadingUrl = `${origin}/projects/${project.id}/pulls/${pr.number}`
    let commentId = existing?.github_comment_id ?? null
    if (commentId != null) {
        try {
            await updateIssueComment(installationId, owner, repo, commentId, loadingComment(origin, pr.title, loadingUrl))
        } catch {
            commentId = null
        }
    }
    if (commentId == null) {
        try {
            const created = await createIssueComment(installationId, owner, repo, pr.number, loadingComment(origin, pr.title, loadingUrl))
            commentId = created.id
        } catch {
            return
        }
    }

    // Upsert the tracking row — id doubles as the analyser task_id.
    const { data: row } = await svc
        .from("pull_request_analyses")
        .upsert(
            {
                project_id: project.id,
                pr_number: pr.number,
                github_comment_id: commentId,
                head_sha: pr.headSha,
                status: "analysing",
            },
            { onConflict: "project_id,pr_number" },
        )
        .select("id")
        .single<{ id: string }>()
    if (!row) return

    await runPRAnalysis(
        {
            repoId: analyser.graph_id,
            number: pr.number,
            title: pr.title,
            body: pr.body || "",
            baseSha: pr.baseSha || undefined,
            headSha: pr.headSha || undefined,
            files,
            projectId: project.id,
        },
        row.id,
        { url: `${origin}/api/internal/pr-analysis-result`, token: process.env.BOBBY_ANALYSER_TOKEN },
    )
}

// applyPRResult is invoked by /api/internal/pr-analysis-result when the analyser
// reports a terminal state. It edits the PR comment in place and records status.
export async function applyPRResult(
    taskId: string,
    status: "done" | "failed" | "cancelled",
    result: PRAnalysis | null,
    origin: string,
): Promise<void> {
    const svc = createServiceClient()

    const { data: row } = await svc
        .from("pull_request_analyses")
        .select("id,project_id,pr_number,github_comment_id")
        .eq("id", taskId)
        .maybeSingle<{ id: string; project_id: string; pr_number: number; github_comment_id: number | null }>()
    if (!row) return

    if (row.github_comment_id != null) {
        const { data: project } = await svc
            .from("projects")
            .select(PR_PROJECT_COLS)
            .eq("id", row.project_id)
            .maybeSingle<PRProject>()
        if (project && prReady(project)) {
            const full = repoFullName(project)
            if (full) {
                const [owner, repo] = full.split("/")
                const uiUrl = `${origin}/projects/${row.project_id}/pulls/${row.pr_number}`
                const body =
                    status === "done" && result
                        ? resultComment(result, origin, uiUrl, row.pr_number)
                        : status === "cancelled"
                          ? cancelledComment(origin, row.pr_number)
                          : failedComment(origin, row.pr_number)
                try {
                    await updateIssueComment(project.github_installation_id!, owner, repo, row.github_comment_id, body)
                } catch {
                    // Comment may have been deleted on GitHub — don't fail the callback.
                }
            }
        }
    }

    // Persist the structured review alongside the status so the Pull-requests
    // tab can render it natively (not just via the GitHub comment). This UPDATE
    // is also what fires the 'pr_analysis_ready' feed notification (trigger in
    // migration 0049), which in turn fans out the review email via the
    // notifications → pg_net dispatch (migration 0051). No email code here — one
    // path for every notification kind.
    await svc.from("pull_request_analyses").update({ status, result: result ?? null }).eq("id", taskId)
}

// cancelPRAnalysisForPR cancels an in-flight run when a PR is closed. The
// analyser reports 'cancelled' via the callback, which updates the comment.
export async function cancelPRAnalysisForPR(projectId: string, prNumber: number): Promise<void> {
    const svc = createServiceClient()
    const { data: row } = await svc
        .from("pull_request_analyses")
        .select("id,status")
        .eq("project_id", projectId)
        .eq("pr_number", prNumber)
        .maybeSingle<{ id: string; status: string | null }>()
    if (!row || row.status !== "analysing") return
    await analyserCancelPR(row.id)
}

// ─── comment rendering ──────────────────────────────────────────────────────

const PR_MARKER = "<!-- bobby:pr-analysis -->"

function esc(s: string): string {
    return s.replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim()
}

const prTitle = (name?: string) => (name ?? "").replace(/[\r\n]+/g, " ").trim()

// loadingComment is the "reviewing" state — the same header + CTA as the result,
// with the self-hosted animated brand loader (public/brand_loader.webp, the one
// the Mind panel uses). It edits in place to the finished review.
function loadingComment(origin: string, prName?: string, uiUrl?: string): string {
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

function cancelledComment(origin: string, prNumber?: number): string {
    const name = prNumber != null ? `#${prNumber}` : ""
    return [PR_MARKER, `## PR Review${name ? ` (${name})` : ""}`, "", badge(origin, "cancelled", "zinc", { size: "header" }), "", "The PR was closed before the review finished."].join("\n")
}

function failedComment(origin: string, prNumber?: number): string {
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
// links through to the full, navigable review in ucelot (evidence, per-dimension
// confidence, diff snippets, the deep-dive chat). Deliberately low-detail —
// verdict, summary, the issue findings as one-liners, fix-claim verdicts, and the
// link. Everything richer lives in the app.
function resultComment(r: PRAnalysis, origin: string, uiUrl?: string, prNumber?: number): string {
    const name = (r.title ?? "").replace(/[\r\n]+/g, " ").trim() || (prNumber != null ? `#${prNumber}` : "")
    const out: string[] = [PR_MARKER, `## PR Review${name ? ` (${name})` : ""}`, ""]
    if (r.verdict) out.push(badge(origin, mergeVerdictLabel(r.verdict), mergeVerdictTone(r.verdict), { icon: mergeVerdictIcon(r.verdict), size: "header" }), "")
    if (r.verdict_reason?.trim()) out.push(`_${esc(r.verdict_reason)}_`, "")

    // ── Quick Summary — readiness score, the confidence rubrics, what the PR does.
    // The trailing "\\" hard-breaks the bold label onto its own line above the image.
    out.push("### Quick Summary")
    // Score comes from the analyser only — never faked here. If it's absent
    // (older analyser build), show a plain "not ready" placeholder instead.
    if (r.score_max && r.score_max > 0) out.push("**Merge Readiness**\\", scoreImage(origin, r.score ?? 0, r.score_max), "")
    else out.push("**Merge Readiness**\\", "`…` _not ready_", "")
    if (r.confidences) {
        const c = r.confidences
        out.push("**Analysis rubrics**\\", confidenceImage(origin, [c.correctness?.level, c.load_perf?.level, c.security?.level].map((l) => l || "low")), "")
    }
    if (r.summary?.trim()) out.push("**About this PR**", r.summary.trim(), "")

    // ── Ucelot Notes — grouped findings, the changed code, and fix-claim verdicts.
    // The header replaces the old inter-section spacer; groups render open (issues)
    // or collapsed (good), each with a coloured badge title.
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

    // The changed code, in one collapsible — GitHub highlights the diff when
    // expanded (withSnip computed above).
    if (withSnip.length) {
        out.push("<details>", `<summary>${badgeImg(origin, `Changed code · ${withSnip.length}`, "zinc", { icon: "code", size: "header" })}</summary>`, "")
        for (const f of withSnip) {
            const loc = f.line ? `${f.file}:${f.line}` : f.file || ""
            out.push(`**${esc(f.title || "")}**${loc ? ` — \`${loc}\`` : ""}`, "", "```" + (f.lang || "diff"), f.snippet!.trim(), "```", "")
        }
        out.push("</details>", "")
    }

    // Fix claims — a header banner + one line each (verdict + claim), with a gap
    // above it so it reads as its own section.
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

// findingTitle leads the finding title with its category as a tag (Bug:,
// Convention:, …) when the title doesn't already carry one. "good" needs no tag
// (the emerald chip already says so); an empty category is skipped.
function findingTitle(f: PRFinding): string {
    const base = esc(f.title || f.detail)
    const cat = (f.category || "").trim()
    if (!cat || cat === "good") return base
    // Don't double-tag: the analyser sometimes already prefixes the title
    // ("Convention: …"). Compare case-insensitively against the tag word(s).
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
