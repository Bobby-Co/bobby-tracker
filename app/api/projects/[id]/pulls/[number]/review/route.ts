import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import { createPullRequestAnalysisService } from "@/modules/analysis"
import { PullRequest as PullRequestEntity } from "@/modules/vcs"
import { RepoRef } from "@/modules/vcs"

// POST /api/projects/[id]/pulls/[number]/review — manually kick a PR review.
//
// The escape hatch for PRs that never got one automatically: opened before the
// project was connected, or while the analyser/webhook was down. The webhook
// path fires startPRAnalysis on `opened`; this is the same call, driven by a
// button instead of an event, built from the mirrored pull_requests row instead
// of a live webhook payload.
//
// startPRAnalysis is idempotent and already gates on connection + a ready graph,
// but it returns void and SWALLOWS every gate — perfect for a background webhook,
// useless for a button that owes the user a yes/no. So this route re-checks the
// same gates up front to return a specific reason, then awaits the kickoff (the
// analyser run itself is detached and returns in ~50ms, so this resolves in the
// time it takes to fetch the diff + post the loading comment), and finally reads
// the row back to confirm it actually entered 'analysing' rather than silently
// no-opping on, say, an empty diff.

export async function POST(request: Request, { params }: { params: Promise<{ id: string; number: string }> }) {
    const { id, number } = await params
    const prNumber = Number(number)
    if (!Number.isInteger(prNumber)) return jsonError("bad_request", "invalid PR number", 400)

    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    // Ownership + everything the kickoff needs, through the RLS-scoped context so
    // a project/PR the caller doesn't own is simply not found.
    const [projectR, pullR, analyserR, statusR] = await Promise.all([
        repoRead(() => ctx.projects.findGithubSyncContext(id)),
        repoRead(() => ctx.pullRequests.findByNumber(id, prNumber)),
        repoRead(() => ctx.analyser.findReadiness(id)),
        repoRead(() => ctx.pullRequests.findAnalysisStatus(id, prNumber)),
    ])
    const dbErr = projectR.error || pullR.error || analyserR.error || statusR.error
    if (dbErr) return dbErr

    const project = projectR.data
    const pull = pullR.data
    if (!project || !pull) return jsonError("not_found", "pull request not found", 404)

    // A run already in flight — treat as success, not an error. Two clicks (or a
    // click racing the webhook) shouldn't read as a failure; the UI just wants to
    // land on "reviewing".
    if (statusR.data === "analysing") {
        return Response.json({ started: true, already: true })
    }

    // Reviewing a closed/merged PR is pointless — its diff is history and there's
    // nothing to gate a merge on. The button only surfaces for open PRs, so this
    // is the belt to that suspenders.
    const pr = PullRequestEntity.of(pull)
    if (pr.isClosed()) {
        return jsonError("closed", "This pull request is already closed.", 409)
    }
    if (pr.isDraft()) {
        return jsonError("draft", "Draft pull requests aren't reviewed.", 409)
    }

    // Explicit gate reasons — startPRAnalysis would just return void on any of
    // these, leaving the user staring at a button that did nothing.
    if (!project.github_sync_enabled || project.github_installation_id == null || project.github_repo_id == null) {
        return jsonError("not_connected", "Connect the GitHub App and enable sync to run a review.", 409)
    }
    if (!RepoRef.of(project).fullName()) {
        return jsonError("not_connected", "This project has no GitHub repository.", 409)
    }
    if (!analyserR.data?.enabled || analyserR.data.status !== "ready" || !analyserR.data.graph_id) {
        return jsonError(
            "not_indexed",
            "The knowledge base isn't indexed yet — index it first so the review has codebase context.",
            409,
        )
    }

    const origin = new URL(request.url).origin
    try {
        // Await it: the analyser run is detached, so what we're waiting on is the
        // diff fetch + loading-comment post + the tracking-row upsert. When this
        // resolves the row is 'analysing' (or the kickoff genuinely failed).
        await createPullRequestAnalysisService(ctx.dataPlaneClient).start(
            project,
            {
                number: prNumber,
                title: pull.title,
                body: pull.body,
                baseSha: pull.base_sha,
                headSha: pull.head_sha,
            },
            origin,
        )
    } catch (e) {
        return jsonError("review_failed", e instanceof Error ? e.message : "couldn't start the review", 502)
    }

    // Confirm it actually started. startPRAnalysis no-ops silently on an empty
    // diff or a GitHub comment failure; reading the row back turns that silence
    // into an honest error instead of a spinner that never resolves.
    const afterStatus = await tryOrNull(() => ctx.pullRequests.findAnalysisStatus(id, prNumber))
    if (afterStatus !== "analysing") {
        return jsonError(
            "review_failed",
            "Couldn't start the review — the PR may have no reviewable changes, or GitHub rejected the request.",
            502,
        )
    }

    return Response.json({ started: true })
}
