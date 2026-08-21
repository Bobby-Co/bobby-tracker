import { after } from "next/server"
import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { getPullRequestServiceForProject } from "@/modules/vcs"
import { diffRounds } from "@/modules/analysis/domain/ReviewRounds"

/** How many rounds this page shows. The same window the review service reads,
 *  so the round selector and the scope decision are looking at one story rather
 *  than two overlapping ones. */
const ROUND_WINDOW = 8

// GET /api/projects/[id]/pulls/[number]
//
// Consolidated page-data endpoint for the PR-detail page (one Worker invocation,
// one requireUser, one Promise.all — same shape as the issue-detail route). It
// returns the mirrored PR, its project, Bobby's persisted review, the ROUNDS
// behind it (0080) and the synced comment thread. The round-over-round delta is
// computed HERE rather than in the browser: it is pure arithmetic over two
// finding lists, and deriving it twice is how two surfaces come to disagree
// about what a push fixed. If the PR is mirrored but has no comments yet (e.g. an older PR
// beyond the backfill cap), it kicks a detached per-PR comment backfill so a
// refresh fills the thread.
export async function GET(_: Request, { params }: { params: Promise<{ id: string; number: string }> }) {
    const { id, number } = await params
    const prNumber = Number(number)
    if (!Number.isInteger(prNumber)) return jsonError("bad_request", "invalid PR number", 400)

    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const [pullR, projectR, analysisR, commentsR, roundsR] = await Promise.all([
        repoRead(() => ctx.pullRequests.findByNumber(id, prNumber)),
        repoRead(() => ctx.projects.findPullContext(id)),
        repoRead(() => ctx.pullRequests.findAnalysis(id, prNumber)),
        repoRead(() => ctx.pullRequests.listComments(id, prNumber)),
        repoRead(() => ctx.pullRequests.listAnalysisRounds(id, prNumber, ROUND_WINDOW)),
    ])

    const readErr = pullR.error || projectR.error || analysisR.error || commentsR.error
    if (readErr) return readErr

    const comments = commentsR.data
    // A mirrored PR with an empty thread: fill it lazily so the next load shows it.
    if (pullR.data && comments.length === 0) {
        after(async () => {
            const prs = await getPullRequestServiceForProject(id)
            await prs?.backfillPullRequestComments(id, prNumber)
        })
    }

    // Rounds are ADDITIVE to the page: a failure to read them costs the strip,
    // never the review. Newest first from the repository; the surfaces want
    // oldest first, which is the order a conversation happened in.
    const rounds = (roundsR.error ? [] : roundsR.data).slice().reverse()
    const current = analysisR.data?.result ?? null
    const head = analysisR.data?.head_sha ?? ""

    // The round BEFORE the current review, which is not simply the newest round:
    // a completing run saves its result and then appends a round for the same
    // head, so the newest round IS the current review. Diffing the review
    // against itself made the progress line permanently read "nothing fixed" —
    // on the one surface whose entire job is to say what the last push changed.
    //
    // Matched by head rather than by position so a round that failed to record
    // (appendRound is best-effort) degrades to comparing against the newest one
    // there is, instead of skipping a round that was never written.
    const beforeCurrent = rounds.filter((r) => r.headSha !== head)
    const previous = beforeCurrent.length > 0 ? beforeCurrent[beforeCurrent.length - 1] : null

    const delta = current && previous
        ? diffRounds(
              { headSha: head, findings: current.findings ?? [], degraded: current.degraded === true },
              { headSha: previous.headSha, findings: previous.findings },
              beforeCurrent.slice(0, -1).reverse().map((r) => ({ headSha: r.headSha, findings: r.findings })),
          )
        : null

    return Response.json({
        pull: pullR.data,
        project: projectR.data,
        analysis: analysisR.data,
        comments,
        rounds,
        delta,
    })
}
