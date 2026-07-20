import { after } from "next/server"
import { jsonError, requireProjectAccess } from "@/lib/api"
import { importExistingIssues } from "@/lib/github-sync"
import { GITHUB_SYNC_DIRECTIONS } from "@/lib/supabase/types"
import type { Project } from "@/lib/supabase/types"

// POST /api/projects/[id]/github-sync — update the GitHub sync settings. Any of
// { enabled, direction, deletes } may be supplied; at least one is required.
// RLS-scoped via the cookie client (the owner update policy on tracker.projects
// covers these columns), returns the refreshed row. Kept separate from
// project_analyser.enabled — sync and indexing are orthogonal.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireProjectAccess(id)
    if (error) return error

    const body = (await request.json().catch(() => null)) as {
        enabled?: unknown
        direction?: unknown
        deletes?: unknown
    } | null

    const patch: Record<string, unknown> = {}
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

    const { data, error: dbErr } = await supabase
        .from("projects")
        .update(patch)
        .eq("id", id)
        .select(
            "id,github_installation_id,github_repo_id,github_sync_enabled,github_sync_direction,github_sync_deletes",
        )
        .single<
            Pick<
                Project,
                | "id"
                | "github_installation_id"
                | "github_repo_id"
                | "github_sync_enabled"
                | "github_sync_direction"
                | "github_sync_deletes"
            >
        >()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

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
