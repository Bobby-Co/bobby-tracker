import { randomBytes } from "node:crypto"
import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"

// GET    — list sessions owned by the current user (newest first)
// POST   — create a new session, optionally with an initial project list

function newToken() {
    return randomBytes(24).toString("base64url")
}

function parseWindow(v: unknown): string | null | undefined {
    if (v === undefined) return undefined
    if (v === null || v === "") return null
    if (typeof v !== "string") return undefined
    const t = Date.parse(v)
    if (Number.isNaN(t)) return undefined
    return new Date(t).toISOString()
}

export async function GET(request: Request) {
    const { ctx, teamId, error } = await new ApiContext(request).requireTeam()
    if (error) return error
    const { data: sessions, error: dbErr } = await repoRead(() => ctx.sessionsAdmin.listForTeam(teamId))
    if (dbErr) return dbErr
    return Response.json({ sessions })
}

export async function POST(request: Request) {
    const { ctx, user, teamId, error } = await new ApiContext(request).requireTeam()
    if (error) return error

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* allow empty */ }

    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) return jsonError("bad_request", "name required", 400)

    const title = typeof body.title === "string" ? body.title.trim() || null : null
    const description = typeof body.description === "string" ? body.description.trim() || null : null
    const start_at = parseWindow(body.start_at) ?? null
    const end_at = parseWindow(body.end_at) ?? null
    if (start_at && end_at && Date.parse(start_at) >= Date.parse(end_at)) {
        return jsonError("bad_request", "start_at must be before end_at", 400)
    }

    const access_mode = body.access_mode === "invite" ? "invite" : "link"
    const submissions_visibility = body.submissions_visibility === "own" ? "own" : "all"
    const group_id_raw = typeof body.group_id === "string" ? body.group_id : null
    let group_id: string | null = null
    if (group_id_raw) {
        // Verify ownership of the group before persisting the link.
        const group = await tryOrNull(() => ctx.collections.findSummary(group_id_raw))
        if (!group) return jsonError("bad_request", "group not found or not yours", 400)
        group_id = group_id_raw
    }

    const projectIdsIn = Array.isArray(body.project_ids)
        ? body.project_ids.filter((x: unknown): x is string => typeof x === "string")
        : []

    const { data: session, error: insErr } = await repoRead(() =>
        ctx.sessionsAdmin.create({
            teamId, userId: user.id, token: newToken(),
            accessMode: access_mode, submissionsVisibility: submissions_visibility, groupId: group_id,
            name, title, description, startAt: start_at, endAt: end_at,
        }),
    )
    if (insErr) return insErr

    // Owner is always implicitly invited. Insert their email so the
    // panel renders them in the list and the public page lets them
    // in immediately if they switched the session to invite mode.
    if (access_mode === "invite") {
        const ownerEmail = (user.email ?? "").trim().toLowerCase()
        if (ownerEmail) await ctx.sessionsAdmin.addOwnerInvite(session.id, ownerEmail)
    }

    if (projectIdsIn.length > 0) {
        const { data: result, error: linkErr } = await repoRead(() => ctx.sessionsAdmin.addProjects(session.id, projectIdsIn))
        if (linkErr) return linkErr
        // Trigger raises 23514 if any project doesn't have the integration
        // enabled. Surface that distinctly so the UI can route to enable it.
        if (result === "integration_disabled") {
            return jsonError(
                "integration_disabled",
                "Enable the public submissions integration on each selected project first.",
                409,
            )
        }
    }

    return Response.json({ session })
}
