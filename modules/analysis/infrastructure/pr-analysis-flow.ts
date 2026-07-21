// PR-analysis orchestration — moved here from the vcs module (parallels the issue
// analysis flow). On a pull_request event we fetch the diff, post an "analysing…"
// comment, kick a DETACHED analyser run (/pr/analyse/run), and edit that comment
// in place when the analyser calls back. Closing the PR cancels the run.
//
// The GitHub side is now just "read the diff / post a comment", reached through
// the vcs module's VCSAppService — this flow never touches a token, owner/repo,
// or the REST client. The pull_request_analyses table is analysis-owned state.

import { tryOrNull } from "@/lib/kernel"
import { createServiceClient } from "@/lib/supabase/server"
import { createSupabaseProjectsRepository, Project } from "@/modules/projects"
import { getVcsAppService } from "@/modules/vcs"
import type { PRAnalysis } from "@/lib/supabase/types"
import { getAnalyser } from "../composition"
import { ProjectAnalyser } from "../domain/project-analyser"
import { createSupabaseProjectAnalyserRepository } from "./supabase-project-analyser-repository"
import type { PRAnalyseFile } from "./analyser"
import { cancelledComment, failedComment, loadingComment, resultComment } from "./pr-analysis-comment"

// The project fields PR analysis reads: id + the sync-readiness/provider wiring.
type PRProject = {
    id: string
    repo_url: string | null
    repo_full_name: string | null
    github_installation_id: number | null
    github_repo_id: number | null
    github_sync_enabled: boolean
}

// PRInput is the PR metadata from the webhook payload.
export type PRInput = {
    number: number
    title: string
    body: string | null
    baseSha: string | null
    headSha: string | null
}

// startPRAnalysis gates on the App being linked + the graph indexed, fetches the
// PR diff, posts (or re-uses) the "analysing…" comment, upserts the tracking row
// (its id is the analyser task_id), and kicks the detached run. Idempotent: a
// run already in flight for this PR is left alone.
export async function startPRAnalysis(project: PRProject, pr: PRInput, origin: string): Promise<void> {
    if (!Project.of(project).isSyncReady()) return
    const vcs = getVcsAppService(project)
    if (!vcs) return

    const svc = createServiceClient()

    // Gate: the graph must be indexed for the review to have codebase context.
    const analyser = await tryOrNull(() => createSupabaseProjectAnalyserRepository(svc).findReadiness(project.id))
    if (!ProjectAnalyser.from(analyser).isReady()) return

    // Idempotency: don't start a second run while one is in flight for this PR.
    const { data: existing } = await svc
        .from("pull_request_analyses")
        .select("id,status,github_comment_id")
        .eq("project_id", project.id)
        .eq("pr_number", pr.number)
        .maybeSingle<{ id: string; status: string | null; github_comment_id: number | null }>()
    if (existing?.status === "analysing") return

    // Fetch the diff (per-file patches) through the vcs service.
    let files: PRAnalyseFile[]
    try {
        const gh = await vcs.listPullRequestFiles(pr.number)
        files = gh.map((f) => ({
            path: f.filename,
            previous_path: f.previousFilename,
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
            await vcs.updateComment(commentId, loadingComment(origin, pr.title, loadingUrl))
        } catch {
            commentId = null
        }
    }
    if (commentId == null) {
        try {
            const created = await vcs.postComment(pr.number, loadingComment(origin, pr.title, loadingUrl))
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

    await getAnalyser().startPRAnalysis(
        {
            // isReady() above guarantees a non-null analyser with a graph_id.
            repoId: analyser!.graph_id!,
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
        const project = await createSupabaseProjectsRepository(svc).findGithubSyncContext(row.project_id)
        if (project && Project.of(project).isSyncReady()) {
            const vcs = getVcsAppService(project)
            if (vcs) {
                const uiUrl = `${origin}/projects/${row.project_id}/pulls/${row.pr_number}`
                const body =
                    status === "done" && result
                        ? resultComment(result, origin, uiUrl, row.pr_number)
                        : status === "cancelled"
                          ? cancelledComment(origin, row.pr_number)
                          : failedComment(origin, row.pr_number)
                try {
                    await vcs.updateComment(row.github_comment_id, body)
                } catch {
                    // Comment may have been deleted on the remote — don't fail the callback.
                }
            }
        }
    }

    // Persist the structured review alongside the status so the Pull-requests tab
    // can render it natively. This UPDATE also fires the 'pr_analysis_ready' feed
    // notification (trigger in migration 0049) → review email via notifications.
    await svc.from("pull_request_analyses").update({ status, result: result ?? null }).eq("id", taskId)
}

// cancelPRAnalysisForPR cancels an in-flight run when a PR is closed. The analyser
// reports 'cancelled' via the callback, which updates the comment.
export async function cancelPRAnalysisForPR(projectId: string, prNumber: number): Promise<void> {
    const svc = createServiceClient()
    const { data: row } = await svc
        .from("pull_request_analyses")
        .select("id,status")
        .eq("project_id", projectId)
        .eq("pr_number", prNumber)
        .maybeSingle<{ id: string; status: string | null }>()
    if (!row || row.status !== "analysing") return
    await getAnalyser().cancelPRAnalysis(row.id)
}
