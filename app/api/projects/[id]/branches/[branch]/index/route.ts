import { AnalyserError, getAnalyser } from "@/modules/analysis"
import { getGitlabCloneAuth, getVcsAppService } from "@/modules/vcs"
import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"

// POST /api/projects/[id]/branches/[branch]/index — (re)index one tracked branch
//
// Kicks off job_type="branch": the analyser copies the repository's graph and
// replays this branch's parse over the copy. No model calls — the cluster
// summaries and embeddings ride along in the copy — so this is deliberately NOT
// behind the same effort/budget knobs a bootstrap is.
//
// It IS behind the spend gate, because a paused team should not be dispatching
// work of any kind, and because the job still costs clone bandwidth, CPU and —
// the real cost of a branch — resident memory on the analyser's FalkorDB.

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; branch: string }> }) {
    const { id, branch: rawBranch } = await params
    const branch = decodeURIComponent(rawBranch)

    const { ctx, teamId, user, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const spendErr = await new ApiContext().requireSpend(ctx, teamId)
    if (spendErr) return spendErr

    const tracked = await tryOrNull(() => ctx.projectBranches.find(id, branch))
    if (!tracked) return jsonError("not_found", "that branch is not tracked", 404)

    const project = await tryOrNull(() => ctx.projects.findFull(id))
    if (!project) return jsonError("not_found", "project not found", 404)

    // The copy needs something to copy from.
    const readiness = await tryOrNull(() => ctx.analyser.findReadiness(id))
    if (!readiness?.graph_id) {
        return jsonError("not_indexed", "Index this project before indexing its branches.", 409)
    }

    const cell = await ctx.projects.findCell(id)
    if (!cell) return jsonError("placement_unavailable", "This project's data location is unavailable.", 503)

    const { error: markErr } = await repoRead(() => ctx.projectBranches.markIndexing(id, branch))
    if (markErr) return markErr

    const gitAuth = await getGitlabCloneAuth(id)

    // How far this branch has drifted, and whether inheriting the default
    // branch's analysis is still honest. Best-effort: an unreachable provider
    // yields "not diverged", which runs the cheap path — guessing the expensive
    // one on a flaky API call would spend a full analysis for nothing.
    const vcs = getVcsAppService(project)
    const divergence = vcs ? await vcs.branchDivergence(branch) : { diverged: false }

    try {
        const result = await getAnalyser(cell).startIndex({
            job_type: "branch",
            repo_url: project.repo_url,
            // The branch to clone AND the branch to index — the analyser reads
            // repo_ref for both. Its clone now names the branch directly, which
            // it could not do before: `--depth` implies `--single-branch`, so a
            // checkout of anything but the remote's HEAD used to fail outright.
            repo_ref: branch,
            ...(divergence.baseRef ? { base_ref: divergence.baseRef } : {}),
            ...(divergence.diverged ? { branch_diverged: true } : {}),
            repo_id: readiness.graph_id,
            user_id: user.id,
            ...(gitAuth ? { git_auth: gitAuth } : {}),
            // The BRANCH row's id, not the project's. A branch job reports into
            // project_branches; sending the project id would make the analyser
            // patch the default branch's analyser row and tell the product the
            // trunk had been re-indexed as this branch.
            supabase_progress: { key_value: tracked.id },
        })
        return Response.json(
            { status: "accepted", job_id: result.job_id, project_id: id, branch },
            { status: 202 },
        )
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        const code = e instanceof AnalyserError ? e.code : "kickoff_failed"
        // Roll the optimistic 'indexing' back so the UI does not sit on a
        // spinner for a job that never started.
        await ctx.projectBranches.markFailed(id, branch, message).catch(() => {})
        return jsonError(code, message, 502)
    }
}
