import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import type { PublicSessionPatch } from "@/modules/public"

function parseWindow(v: unknown): string | null | undefined {
    if (v === undefined) return undefined
    if (v === null || v === "") return null
    if (typeof v !== "string") return undefined
    const t = Date.parse(v)
    if (Number.isNaN(t)) return undefined
    return new Date(t).toISOString()
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    // Session access, not just identity: this returns the session, its projects
    // and the team's eligible-project list.
    const { ctx, teamId, error } = await new ApiContext().requireSessionAccess(id)
    if (error) return error
    const { data: session, error: dbErr } = await repoRead(() => ctx.sessionsAdmin.findById(id))
    if (dbErr) return dbErr
    if (!session) return jsonError("not_found", "session not found", 404)

    const projects = await ctx.sessionsAdmin.listProjectNames(id)
    // Projects eligible to be added — only those with the integration enabled.
    const allProjects = await ctx.sessionsAdmin.listEligibleProjects(teamId)
    // Whitelisted invite emails (best-effort; [] on read failure, as before).
    const invites = (await tryOrNull(() => ctx.sessionsAdmin.listInvites(id))) ?? []
    // Eligible groups for the source picker — owner-only via RLS.
    const allGroups = await ctx.collections.listNames(teamId)

    return Response.json({ session, projects, allProjects, invites, allGroups })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireSessionAccess(id, { write: true })
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const patch: PublicSessionPatch = {}
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled
    if (body.access_mode === "link" || body.access_mode === "invite") {
        patch.access_mode = body.access_mode
    }
    if (body.submissions_visibility === "all" || body.submissions_visibility === "own") {
        patch.submissions_visibility = body.submissions_visibility
    }
    // Source toggle: group_id null clears the group binding (drops
    // back to manual project list); a non-null value points the
    // session at a project group. RLS on project_groups (owner-only)
    // means a non-owner id silently fails the FK check on update.
    if (body.group_id === null) {
        patch.group_id = null
    } else if (typeof body.group_id === "string" && body.group_id.length > 0) {
        // Confirm the group belongs to the caller before persisting
        // — clearer than letting the FK error bubble up.
        const gid = body.group_id
        const group = await tryOrNull(() => ctx.collections.findSummary(gid))
        if (!group) {
            return jsonError("bad_request", "group not found or not yours", 400)
        }
        patch.group_id = gid
    }
    if (typeof body.name === "string") {
        const v = body.name.trim()
        if (!v) return jsonError("bad_request", "name cannot be empty", 400)
        patch.name = v
    }
    if (typeof body.title === "string") patch.title = body.title.trim() || null
    if (typeof body.description === "string") patch.description = body.description.trim() || null
    const start_at = parseWindow(body.start_at)
    const end_at = parseWindow(body.end_at)
    if (start_at !== undefined) patch.start_at = start_at
    if (end_at !== undefined) patch.end_at = end_at
    if (start_at && end_at && Date.parse(start_at) >= Date.parse(end_at)) {
        return jsonError("bad_request", "start_at must be before end_at", 400)
    }
    if (Object.keys(patch).length === 0) return jsonError("bad_request", "no fields to update", 400)

    const { data, error: dbErr } = await repoRead(() => ctx.sessionsAdmin.update(id, patch))
    if (dbErr) return dbErr

    // When the session flips into invite mode, ensure the owner is on
    // the whitelist so they don't lock themselves out the moment they
    // toggle. Idempotent — no-op if it's already there.
    if (patch.access_mode === "invite") {
        const ownerEmail = (user.email ?? "").trim().toLowerCase()
        if (ownerEmail) await ctx.sessionsAdmin.addOwnerInvite(id, ownerEmail)
    }

    return Response.json({ session: data })
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireSessionAccess(id, { write: true })
    if (error) return error
    const { error: dbErr } = await repoRead(() => ctx.sessionsAdmin.delete(id))
    if (dbErr) return dbErr
    return new Response(null, { status: 204 })
}
