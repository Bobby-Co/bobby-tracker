import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { disabledMcpIntegration } from "@/modules/mcp"

// Per-project toggle for the MCP integration: whether this project's indexed
// knowledge base may be queried by an AI assistant connected over MCP.
//
// Opt-in — a project with no row reads as disabled, and GET renders that default
// rather than 404ing, so the Integrations tab has something to show before the
// switch is ever touched.
//
// AUTHZ. Reading the flag is a plain project read (requireProjectAccess: team
// membership + the group-level gate). CHANGING it is admin-gated on top of that:
// flipping this on publishes a project's whole codebase index to any MCP client
// the team has connected, which is the same class of decision as adding a project
// to the team (POST /api/projects) — so it uses the same requireRole(role,
// "admin") guard. The gate covers disable as well as enable: letting a plain
// member switch the integration off would silently break every assistant relying
// on it, and "admins own the exposure decision" is the simpler rule. In a personal
// team the sole member is the owner, so this is transparent for solo use.
//
// RLS only proves team membership (migration 0060) — the role check lives here,
// matching the hybrid authz model in modules/README.md.

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error
    const data = await ctx.mcpIntegration.findIntegration(id)
    return Response.json({ integration: data ?? disabledMcpIntegration(id) })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, role, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const roleErr = new ApiContext().requireRole(role, "admin")
    if (roleErr) return roleErr

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    if (typeof body.enabled !== "boolean") return jsonError("bad_request", "enabled (boolean) required", 400)
    const enabled = body.enabled

    const { data, error: dbErr } = await repoRead(() => ctx.mcpIntegration.setIntegration(id, enabled))
    if (dbErr) return dbErr

    return Response.json({ integration: data })
}
