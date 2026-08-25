import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { Role } from "@/modules/access"

// Which review profile this project's PR reviews run under.
//
// GET — the assigned profile, or null for the built-in default (any member with
//       access to the project).
// PUT — assign one, or null to go back to the default (team admins).
//
// The profile lives on the TEAM and the project points at it, so assignment has
// two authorisation questions, not one: may this caller touch this project, and
// does the profile they named belong to the same team. Both are checked — the
// second is what stops a project being pointed at another tenant's profile by
// id, which would leak its instructions into this project's reviews.

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const { data, error: dbErr } = await repoRead(() => ctx.reviewProfiles.findForProject(id))
    if (dbErr) return dbErr
    // null is the NORMAL answer, not an error: no project has a profile until
    // somebody assigns one, and that means the built-in default reviewer.
    return Response.json({ profile: data ?? null })
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    let body: Record<string, unknown>
    try {
        body = await request.json()
    } catch {
        return jsonError("bad_request", "invalid JSON", 400)
    }
    const profileId = body?.profile_id == null ? null : String(body.profile_id)

    const { data: teamId, error: teamErr } = await repoRead(() => ctx.projects.findTeamId(id))
    if (teamErr) return teamErr
    if (!teamId) return jsonError("not_found", "project not found", 404)

    const role = await ctx.access.teamRole(teamId, user.id)
    if (!role || !Role.of(role).atLeast("admin")) {
        return forbidden("only team admins can change which review profile a project uses")
    }

    if (profileId) {
        // The profile must belong to THIS project's team. find() is scoped by
        // team, so a profile from another tenant simply isn't found — the caller
        // learns nothing about whether it exists.
        const { data: profile, error: findErr } = await repoRead(() => ctx.reviewProfiles.find(teamId, profileId))
        if (findErr) return findErr
        if (!profile) return jsonError("not_found", "review profile not found", 404)
    }

    const { error: dbErr } = await repoRead(() => ctx.reviewProfiles.assign(id, profileId))
    if (dbErr) return dbErr
    return Response.json({ profile_id: profileId })
}
