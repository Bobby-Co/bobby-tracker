import { ApiContext } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"

// GET /api/projects/[id]/timeline — everything the planning timeline
// needs in one round-trip: the project's identity, its issues (newest
// first), and the per-project label-icon + status-color overrides.
// `project` is null when the id doesn't resolve so the client can 404.
// Reads are best-effort (fail-safe), matching the original ignored-error shape.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const [project, issues, labelIcons, statusColors] = await Promise.all([
        tryOrNull(() => ctx.projects.findPullContext(id)),
        tryOrNull(() => ctx.issues.listForProject(id, 1000)),
        tryOrNull(() => ctx.projectDisplay.listLabelIcons(id)),
        tryOrNull(() => ctx.projectDisplay.listStatusColors(id)),
    ])

    return Response.json({
        project: project ?? null,
        issues: issues ?? [],
        labelIcons: labelIcons ?? [],
        statusColors: statusColors ?? [],
    })
}
