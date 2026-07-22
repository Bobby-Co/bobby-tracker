import { after } from "next/server"
import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { importExistingIssues } from "@/modules/vcs"
import { GITHUB_SYNC_DIRECTIONS } from "@/lib/shared/types"
import type { GithubSyncPatch } from "@/modules/projects"

// POST /api/projects/[id]/github-sync — update the GitHub sync settings. Any of
// { enabled, direction, deletes } may be supplied; at least one is required.
// RLS-scoped via the cookie client (the owner update policy on tracker.projects
// covers these columns), returns the refreshed row. Kept separate from
// project_analyser.enabled — sync and indexing are orthogonal.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const body = (await request.json().catch(() => null)) as {
        enabled?: unknown
        direction?: unknown
        deletes?: unknown
    } | null

    const patch: GithubSyncPatch = {}
    if (typeof body?.enabled === "boolean") patch.github_sync_enabled = body.enabled
    if (
        typeof body?.direction === "string" &&
        (GITHUB_SYNC_DIRECTIONS as readonly string[]).includes(body.direction)
    ) {
        patch.github_sync_direction = body.direction
    }
    if (typeof body?.deletes === "boolean") patch.github_sync_deletes = body.deletes
    if (Object.keys(patch).length === 0) {
        return jsonError(
            "bad_request",
            "one of enabled (boolean), direction (inbound|outbound|both), or deletes (boolean) is required",
            400,
        )
    }

    const { data, error: dbErr } = await repoRead(() => ctx.projects.updateSyncSettings(id, patch))
    if (dbErr) return dbErr

    // When the user turns sync on (or points the direction inbound), pull the
    // repo's existing issues in automatically — the backfill they'd otherwise
    // have to trigger by hand from the Integrations tab. Only when this request
    // actually touched enabled/direction, so a bare `deletes` toggle doesn't
    // re-run it. importExistingIssues is idempotent (skips already-linked),
    // self-guards on sync readiness, and deliberately does NOT auto-analyse the
    // imported issues. after() so it runs post-response (a bare promise would be
    // frozen on Workers). See [[workers-detached-promises]].
    const touchedSync = "github_sync_enabled" in patch || "github_sync_direction" in patch
    const inboundNow = data.github_sync_direction === "inbound" || data.github_sync_direction === "both"
    if (touchedSync && data.github_sync_enabled && inboundNow) {
        after(() => importExistingIssues(id).catch(() => {}))
    }

    return Response.json({ project: data })
}
