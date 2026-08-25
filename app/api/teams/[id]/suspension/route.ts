import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { SlotPolicy, hashAccountEmail } from "@/modules/billing"

// POST /api/teams/[id]/suspension  { suspended: boolean }
//
// Pause or resume a team. Suspended means: everything is kept and readable, no
// usage may be recorded, and — the reason this exists — the team RELEASES its
// free slot (0076). An owner with both free teams in use can pause one to make
// room for another, and a team suspended because its paid plan ended resumes here
// once there is room for it.
//
// Owner-only: it changes what the account may spend, which is the owner's call
// rather than an admin's.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (role !== "owner") return forbidden("only the team owner can pause or resume a team")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    if (typeof body?.suspended !== "boolean") {
        return jsonError("bad_request", "suspended must be true or false", 400)
    }
    const suspended = body.suspended

    const { data: subject, error: subjErr } = await repoRead(() => ctx.usageSubjects.findForTeam(id))
    if (subjErr) return subjErr
    if (!subject) {
        // Pre-0076 team that the lazy backfill hasn't reached. Creating a team
        // backfills it; refusing here is honest rather than silently pausing
        // something whose billing identity we don't know.
        return jsonError("not_ready", "this team has no billing identity yet — create or open a team first", 409)
    }

    if (!suspended) {
        // Resuming can be refused: if another team took the slot while this one
        // was paused, waking it would quietly hand the owner two free teams.
        const ownerHash = user.email ? await hashAccountEmail(user.email) : null
        const { data: subjects, error: listErr } = ownerHash
            ? await repoRead(() => ctx.usageSubjects.listForOwner(ownerHash))
            : { data: [], error: null }
        if (listErr) return listErr
        if (!new SlotPolicy().canResume(subjects, subject.id)) {
            return jsonError(
                "slot_taken",
                "Your free team slot is in use. Pause the other team, or put this one on a plan, to resume it.",
                409,
            )
        }
    }

    const { error: statusErr } = await repoRead(() =>
        ctx.usageSubjects.setStatus(subject.id, suspended ? "suspended" : "active"),
    )
    if (statusErr) return statusErr

    // Mirror it onto the subscription so the billing surfaces agree with the
    // billing identity — one of them is what every read happens to look at.
    await repoRead(() => ctx.subscriptions.setStatus(id, suspended ? "suspended" : "active"))

    return Response.json({ suspended })
}
