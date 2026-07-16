// PR-analysis orchestration: on a GitHub pull_request event the tracker fetches
// the diff, posts an "analysing…" comment, kicks a DETACHED analyser run
// (/pr/analyse/run), and edits that comment in place when the analyser calls
// back (/api/internal/pr-analysis-result). Closing the PR cancels the run.
// GitHub I/O lives here (the App creds are here); the analyser is GitHub-free.
// See the analyser's ADR-0052 + pr.go/pr_async.go.

import { badge, confidenceLevelTone, confidenceTone, icon, mergeVerdictIcon, mergeVerdictLabel, mergeVerdictTone, severityIcon, severityLabel, severityTone, verdictTone } from "@/lib/badge"
import { createIssueComment, listPullRequestFiles, updateIssueComment } from "@/lib/github-app"
import { repoFullName } from "@/lib/integrations/github"
import { cancelPRAnalysis as analyserCancelPR, runPRAnalysis, type PRAnalyseFile } from "@/lib/analyser"
import { createServiceClient } from "@/lib/supabase/server"
import type { PRAnalysis, PRChecks, PRConfidences, PRFinding, Project } from "@/lib/supabase/types"

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
    let commentId = existing?.github_comment_id ?? null
    if (commentId != null) {
        try {
            await updateIssueComment(installationId, owner, repo, commentId, loadingComment(origin))
        } catch {
            commentId = null
        }
    }
    if (commentId == null) {
        try {
            const created = await createIssueComment(installationId, owner, repo, pr.number, loadingComment(origin))
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
                const body =
                    status === "done" && result
                        ? resultComment(result, origin)
                        : status === "cancelled"
                          ? cancelledComment(origin)
                          : failedComment(origin)
                try {
                    await updateIssueComment(project.github_installation_id!, owner, repo, row.github_comment_id, body)
                } catch {
                    // Comment may have been deleted on GitHub — don't fail the callback.
                }
            }
        }
    }

    // Persist the structured review alongside the status so the Pull-requests
    // tab can render it natively (not just via the GitHub comment).
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

function loadingComment(origin: string): string {
    return [
        PR_MARKER,
        "**Bobby** is reviewing this pull request…",
        "",
        badge(origin, "reviewing", "blue"),
        "",
        "Reading the diff and tracing its impact through the codebase. This comment updates automatically.",
    ].join("\n")
}

function cancelledComment(origin: string): string {
    return [PR_MARKER, "**Bobby** — review cancelled", "", badge(origin, "cancelled", "zinc"), "", "The PR was closed before the review finished."].join("\n")
}

function failedComment(origin: string): string {
    return [PR_MARKER, "**Bobby** — review unavailable", "", badge(origin, "failed", "rose"), "", "Bobby couldn't complete the review this time."].join("\n")
}

function resultComment(r: PRAnalysis, origin: string): string {
    const out: string[] = [PR_MARKER, "### Bobby · PR review", ""]
    if (r.verdict) {
        out.push(badge(origin, mergeVerdictLabel(r.verdict), mergeVerdictTone(r.verdict), { icon: mergeVerdictIcon(r.verdict) }), "")
        if (r.verdict_reason?.trim()) out.push(`_${esc(r.verdict_reason)}_`, "")
    }
    // Per-dimension calibrated confidence (analyser ADR-0057): three small chips
    // toned by level. Falls back to the flat rollup badge for legacy results that
    // only carry `confidence`.
    const confLine = confidenceChips(r.confidences, origin)
    if (confLine) out.push(confLine, "")
    else if (r.confidence) out.push(badge(origin, `confidence: ${r.confidence}`, confidenceTone(r.confidence)), "")

    // Summary is short markdown bullets (analyser ADR-0054) — render them plainly
    // so they read as a scannable list, not a wrapped blockquote.
    if (r.summary?.trim()) out.push(r.summary.trim(), "")

    if (r.impact?.trim()) out.push(`${icon(origin, "nodes")} **Impact**`, "", r.impact.trim(), "")
    if (r.impact_files?.length) {
        out.push("<details><summary>Affected files</summary>", "")
        for (const f of r.impact_files) out.push(`- \`${f.file}\` — ${esc(f.reason)}`)
        out.push("", "</details>", "")
    }

    if (r.findings?.length) {
        out.push(`${icon(origin, "search")} **Review**`, "")
        for (const f of r.findings) {
            const loc = f.line ? `\`${f.file}:${f.line}\`` : `\`${f.file}\``
            const title = findingTitle(f)
            const chip = badge(origin, severityLabel(f.severity || ""), severityTone(f.severity || ""), { icon: severityIcon(f.severity || "") })
            out.push(`- ${chip} **${title}** — ${loc}`)
            if (f.title && f.detail && f.detail.trim() !== f.title.trim()) out.push(`  ${esc(f.detail)}`)
            // Cited KB anchors backing the finding (analyser ADR-0057) — the top
            // 1-2 as a dim sub-line so the review reads as grounded, not asserted.
            const ev = findingEvidenceLine(f)
            if (ev) out.push(ev)
        }
        out.push("")
    }

    if (r.fix_claims?.length) {
        out.push(`${icon(origin, "target")} **Fix claims**`, "", "| Claim | Verdict | Why |", "|:--|:--|:--|")
        for (const c of r.fix_claims) {
            out.push(`| ${esc(c.claim)} | ${badge(origin, c.verdict || "unclear", verdictTone(c.verdict))} | ${esc(c.reason)} |`)
        }
        out.push("")
    }

    if (r.concerns?.length) {
        out.push("**Concerns**", "")
        for (const c of r.concerns) out.push(`- ${c}`)
        out.push("")
    }

    if (r.checklist?.length) {
        out.push(`${icon(origin, "list")} **Nice to check**`, "")
        for (const c of r.checklist) out.push(`- ${esc(c)}`)
        out.push("")
    }

    // KB-diligence footer (analyser ADR-0057): a terse tally of what the reviewer
    // verified against the knowledge graph. Omitted entirely for legacy results.
    const checks = checksFooter(r.checks)
    if (checks) out.push(checks, "")

    const dur = r.duration_ms ? `reviewed in ${(r.duration_ms / 1000).toFixed(1)}s` : undefined
    out.push(`<sub>🔎 Reviewed by Bobby${dur ? ` · ${dur}` : ""}</sub>`)
    return out.join("\n")
}

// confidenceChips renders the three per-dimension confidence chips as one line,
// each toned by level (high=green, medium=amber, low=zinc). Returns "" when the
// analyser didn't calibrate per-dimension (legacy results) so the caller can
// fall back to the flat rollup badge.
function confidenceChips(confidences: PRConfidences | null | undefined, origin: string): string {
    if (!confidences) return ""
    const dims: [string, { level?: string } | undefined][] = [
        ["correctness", confidences.correctness],
        ["load/perf", confidences.load_perf],
        ["security", confidences.security],
    ]
    const chips = dims
        .filter(([, d]) => d && typeof d.level === "string" && d.level)
        .map(([label, d]) => badge(origin, `${label}: ${d!.level}`, confidenceLevelTone(d!.level!)))
    return chips.join(" ")
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

// findingEvidenceLine renders the top 1-2 cited anchors under a finding as a dim
// sub-line, e.g. `  ↳ evidence: \`x.go:12\` — wraps errors with %w`. Returns ""
// when the finding carries no evidence (legacy findings).
function findingEvidenceLine(f: PRFinding): string {
    const ev = (f.evidence || []).filter((e) => e && e.file)
    if (ev.length === 0) return ""
    const parts = ev.slice(0, 2).map((e) => {
        const loc = e.line ? `\`${e.file}:${e.line}\`` : `\`${e.file}\``
        const note = (e.note || "").trim()
        return note ? `${loc} — ${esc(note)}` : loc
    })
    return `  <sub>↳ evidence: ${parts.join(" · ")}</sub>`
}

// checksFooter summarises the KB-verification tally as one terse line, omitting
// zero counts. When findings were dropped for being ungrounded, it appends that
// too. Returns "" when there's nothing non-zero to report.
function checksFooter(checks: PRChecks | null | undefined): string {
    if (!checks) return ""
    const bits: string[] = []
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
    if (checks.callers > 0) bits.push(plural(checks.callers, "caller", "callers"))
    if (checks.precedents > 0) bits.push(plural(checks.precedents, "precedent", "precedents"))
    if (checks.tests > 0) bits.push(plural(checks.tests, "test", "tests"))
    if (checks.git_reads > 0) bits.push(plural(checks.git_reads, "git read", "git reads"))
    if (checks.failure_probes > 0) bits.push(plural(checks.failure_probes, "failure probe", "failure probes"))
    if (checks.removed_symbols && checks.removed_symbols > 0) bits.push(plural(checks.removed_symbols, "removed symbol", "removed symbols"))
    if (bits.length === 0 && !(checks.dropped && checks.dropped > 0)) return ""
    let line = bits.length ? `Checked ${bits.join(" · ")}` : "Checked the knowledge graph"
    if (checks.dropped && checks.dropped > 0) line += ` · ${checks.dropped} ungrounded dropped`
    return `<sub>${line}</sub>`
}
