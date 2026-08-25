import { ApiContext, jsonError } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import { createIssueAnalysisService } from "@/modules/analysis"

export const dynamic = "force-dynamic"

// POST /api/issues/[id]/analyse — ensure the SINGLE analysis run for this issue
// is under way (idempotent / one-shot). The suggestion box calls this instead
// of /suggest so it shares the same run as the GitHub-comment flow rather than
// starting a duplicate. Returns the cached suggestion when the run already
// finished; otherwise the result lands via the issue_suggestions realtime
// INSERT the box is subscribed to.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireIssueAccess(id)
    if (error) return error

    const issues = ctx.issues
    const suggestions = ctx.issueSuggestions

    // Ownership (RLS): the cookie client only sees the caller's issues. A read
    // error folds to null → 404 (fail closed), matching the old inline check.
    const ownedProjectId = await tryOrNull(() => issues.findProjectId(id))
    if (!ownedProjectId) return jsonError("not_found", "issue not found", 404)

    const status = await createIssueAnalysisService(ctx.dataPlaneClient).ensure(id, new URL(request.url).origin)
    if (status === "not_ready") {
        return jsonError(
            "needs_indexing",
            "Enable the bobby-analyser integration and run an index for this project before requesting suggestions.",
            409,
        )
    }
    if (status === "no_issue") return jsonError("not_found", "issue not found", 404)
    // A billing stop (0076) — paused, or the monthly allowance is spent. Not a
    // missing index, so it gets its own answer rather than being folded into
    // "needs_indexing" and sending the user off to re-run an index that would not
    // have helped. The gate wrote the message; it knows which of the two it was
    // and what the way out is.
    if (typeof status === "object") return jsonError(status.reason, status.message, 402)

    // 'queued' arrives here as a normal 200, not an error: the team was at its
    // concurrency cap, the request was ACCEPTED, and the run starts when a slot
    // frees (0085). The client already does the right thing with it — anything
    // that isn't 'done' means "a run is coming", so it keeps waiting for the row
    // to land by realtime or poll.
    //
    // Return the cached suggestion if the run already completed (status 'done').
    // Fail-safe: a read error folds to null, matching the old maybeSingle.
    const suggestion = await tryOrNull(() => suggestions.findLatest(id))
    return Response.json({ status, suggestion: suggestion ?? null })
}