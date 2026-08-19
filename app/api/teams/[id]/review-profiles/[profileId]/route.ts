import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { Role } from "@/modules/access"
import { parseProfileBody } from "../route"

// One saved review profile.
//
// PATCH  — edit it (admins). DELETE — remove it (admins).
//
// Deleting is safe to offer without a confirmation dance: projects pointing at
// the profile fall back to the built-in default (0077 uses ON DELETE SET NULL),
// so the worst case is that their reviews go back to how they were before
// anybody configured anything.

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string; profileId: string }> },
) {
    const { id, profileId } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) {
        return forbidden("only team admins can edit a review profile")
    }

    let body: Record<string, unknown>
    try {
        body = await request.json()
    } catch {
        return jsonError("bad_request", "invalid JSON", 400)
    }

    const parsed = parseProfileBody(body)
    if ("error" in parsed) return parsed.error

    const { data, error: dbErr } = await repoRead(() =>
        ctx.reviewProfiles.update(id, profileId, { ...parsed.input, actorId: user.id }),
    )
    if (dbErr) return dbErr
    // The repository filters by team AND id, so a profile belonging to another
    // team reads as "not found" — the caller can't use this to discover it exists.
    if (!data) return jsonError("not_found", "review profile not found", 404)
    return Response.json({ profile: data, issues: parsed.issues })
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string; profileId: string }> },
) {
    const { id, profileId } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) {
        return forbidden("only team admins can delete a review profile")
    }

    const { error: dbErr } = await repoRead(() => ctx.reviewProfiles.remove(id, profileId))
    if (dbErr) return dbErr
    return Response.json({ deleted: true })
}
