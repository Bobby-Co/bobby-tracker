import { ApiContext } from "@/lib/server/http/api"
import { getRegionRegistry } from "@/modules/regions"

// GET /api/regions — the regions a new project may be placed in (0062).
//
// REGIONS ONLY. Cells are deliberately not exposed: which cell holds a graph is
// an internal placement detail, and handing it to a client invites the client to
// start choosing one — which is the registry's job (RegionRegistry.assignCell),
// precisely so placement can become load-aware later without a client change.
//
// A region with no configured cell is omitted entirely, so the picker can only
// ever offer somewhere a project can actually be indexed. That means this can
// legitimately return a single region (today) or, in a misconfigured
// environment, none at all — the client renders no picker in both cases and
// creation falls back to the home cell.
export async function GET() {
    const { error } = await new ApiContext().requireUser()
    if (error) return error

    const regions = getRegionRegistry()
        .regions()
        .map((r) => ({ id: r.id, label: r.label }))

    return Response.json({ regions })
}
