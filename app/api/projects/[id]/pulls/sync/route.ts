import { after } from "next/server"
import { jsonError, requireProjectAccess } from "@/lib/server/http/api"
import { getPullRequestServiceForProject } from "@/modules/vcs"

// POST /api/projects/[id]/pulls/sync
//
// Explicit "Refresh" trigger for the Pull-requests tab: re-runs the GitHub
// backfill for this project. Ownership is enforced by RLS — the user-scoped
// select only returns the project if the caller owns it — before we kick the
// service-role backfill (detached, off the response path).
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireProjectAccess(id)
    if (error) return error

    const { data: project, error: projErr } = await supabase
        .from("projects")
        .select("id")
        .eq("id", id)
        .maybeSingle<{ id: string }>()
    if (projErr) return jsonError("db_error", projErr.message, 500)
    if (!project) return jsonError("not_found", "project not found", 404)

    after(async () => {
        const prs = await getPullRequestServiceForProject(id)
        await prs?.backfillPullRequests(id)
    })
    return Response.json({ syncing: true })
}
