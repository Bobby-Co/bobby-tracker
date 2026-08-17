import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { ProjectAnalyser as ProjectAnalyserModel } from "@/modules/analysis"

// GET — cross-project issue feed for a group's Issues tab. Returns the
// group's identity, its member projects (with analyser readiness +
// has-summary flags), and every issue across those projects in one
// round-trip. The client buckets/derives the parent-child trees per
// project, matching what the per-project Issues page does.
//
// Shape: { group: { id, name }, members: MemberInfo[], issues: Issue[] }
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireUser()
    if (error) return error

    const { data: group, error: gErr } = await repoRead(() => ctx.collections.findSummary(id))
    if (gErr) return gErr
    if (!group) return jsonError("not_found", "group not found", 404)

    // Members + their analyser readiness + summary state. The repo flattens the
    // PostgREST embed; readiness is derived here from the analyser fields.
    const members = (await ctx.collections.listMembers(id))
        .map((m) => ({
            id: m.id,
            name: m.name,
            analyser_ready: ProjectAnalyserModel.from({ status: m.status, enabled: m.enabled, graph_id: m.graph_id }).isReady(),
            has_summary: m.has_summary,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

    const memberIds = members.map((m) => m.id)

    // Pull every issue across the member projects in one shot. Single
    // round-trip is cheaper than a query per project, and the limit
    // keeps the payload bounded for big groups.
    const issues = await ctx.issues.listAcrossProjects(memberIds, 500)

    return Response.json({ group, members, issues })
}
