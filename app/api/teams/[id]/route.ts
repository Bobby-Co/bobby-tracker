import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import { Role } from "@/modules/access"
import type { TeamWithRole } from "@/lib/shared/types"

// GET /api/teams/[id] — a team the caller belongs to, with their role.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    const { data, error: dbErr } = await repoRead(() => ctx.teams.findById(id))
    if (dbErr) return dbErr
    const team: TeamWithRole | null = data ? { ...data, role } : null
    return Response.json({ team })
}

// PATCH /api/teams/[id] — rename the team (admins). Personal teams can't be renamed.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can rename a team")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const name = String(body?.name ?? "").trim()
    if (!name) return jsonError("bad_request", "name is required", 400)

    if (await ctx.teams.isPersonal(id)) return jsonError("bad_request", "a personal team can't be renamed", 400)

    const { data, error: dbErr } = await repoRead(() => ctx.teams.rename(id, name))
    if (dbErr) return dbErr
    return Response.json({ team: { ...data, role } as TeamWithRole })
}

// DELETE /api/teams/[id] — owners only; personal teams can't be deleted (they
// are recreated on the owner's next request, so it reads as a broken button).
// Cascades resources — a heavy op the UI should confirm.
//
// The personal-team rule used to be enforced by RLS alone (teams_owner_delete
// used `not is_personal`). 0067 dropped those policies and this context now
// queries with a service-role client, which means the database stopped saying no
// — the check below is the rule again rather than a belt-and-braces echo of it.
// Deleting an account is the one path allowed past it, and it goes through
// modules/account, not here.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (role !== "owner") return forbidden("only the team owner can delete a team")
    if (await ctx.teams.isPersonal(id)) {
        return jsonError("bad_request", "your personal team can't be deleted", 400)
    }

    // A team on a paid plan is not deletable while it is paid (0076). Deleting it
    // would silently abandon a subscription that keeps billing, and the recovery
    // — "where did my paid team go?" — is not one the app can offer afterwards.
    // Cancelling the plan first is the deliberate step; the team then falls to Kit
    // or to suspension, and can be deleted from there.
    const { data: sub } = await repoRead(() => ctx.subscriptions.findByTeam(id))
    if (sub && sub.tier !== "kit") {
        return jsonError(
            "plan_active",
            "This team is on a paid plan. Cancel the plan before deleting the team.",
            409,
        )
    }

    // Bind before the purge below: ProjectDeletionService clears REGIONAL content,
    // and the data plane throws until a region is bound. Every project here belongs
    // to this team, so one binding covers the whole loop.
    await ctx.bindTeam(id)

    // Deleting the team row cascades to its projects (that FK is central and
    // intact), but a cascade cannot reach the REGIONAL content those projects
    // own — the keys that used to carry it were dropped when the planes split.
    // So walk each project through the full deletion path first. Doing it the
    // other way round removes the projects and leaves their issues, comments and
    // embeddings behind with nothing left to identify them by.
    //
    // Sequential rather than parallel: each delete is several round trips across
    // two databases, and a team with many projects would otherwise open a burst
    // of concurrent connections to both.
    const owned = await tryOrNull(() => ctx.projects.listForTeam(id, "all"))
    for (const project of owned ?? []) {
        const { error: pErr } = await repoRead(() => ctx.projectDeletion.delete(project.id))
        // Stop on the first failure. A partially-deleted team is recoverable —
        // the team still exists, so retrying resumes. Pressing on would remove
        // the team while some projects' content survived.
        if (pErr) return pErr
    }

    // Release the billing identity, don't delete it (0076): the subject keeps the
    // team's usage, so recreating a team reattaches to the same balance instead of
    // handing out a fresh monthly allowance. This is the "usage stays even when
    // the team goes" half of the free-team quota.
    await tryOrNull(() => ctx.usageSubjects.unbind(id))

    const { error: dbErr } = await repoRead(() => ctx.teams.delete(id))
    if (dbErr) return dbErr
    return new Response(null, { status: 204 })
}
