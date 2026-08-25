import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { Role } from "@/modules/access"
import { DEFAULT_DIALS, parseDials, parseLenses, sanitiseInstructions } from "@/modules/analysis"

// The team's library of PR-reviewer profiles (0077).
//
// GET  /api/teams/[id]/review-profiles — list them (any member).
// POST /api/teams/[id]/review-profiles — create one (admins).
//
// ─── Why creating one is an admin action ────────────────────────────────────
//
// A profile's `blocking` and `evidence` dials decide what counts as a
// merge-blocking finding, and modules/vcs/domain/MergeGate.ts refuses an in-app
// merge while any exist. Editing a profile can therefore loosen who is allowed
// to merge what — which puts it in the same class as changing a team's settings,
// not in the same class as filing an issue. Reading is open to any member,
// because a profile is the explanation for a review they are already seeing.

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    // teamRole is the membership check AND the 404: a team the caller doesn't
    // belong to is indistinguishable from one that doesn't exist.
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)

    const { data, error: dbErr } = await repoRead(() => ctx.reviewProfiles.listForTeam(id))
    if (dbErr) return dbErr
    return Response.json({ profiles: data ?? [] })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) {
        return forbidden("only team admins can create a review profile")
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
        ctx.reviewProfiles.create(id, { ...parsed.input, actorId: user.id }),
    )
    if (dbErr) return dbErr
    return Response.json({ profile: data, issues: parsed.issues }, { status: 201 })
}

/** Read a request body into repository input.
 *
 *  Everything except the name goes through the DOMAIN rather than being
 *  validated here: unknown dial values fall back, unknown lenses are dropped,
 *  free text is sanitised. That is deliberate — a request that names a dial
 *  value this build doesn't know should save a slightly plainer profile, not
 *  400. The name is the exception, because a nameless profile is unusable in
 *  the picker and silently defaulting it would be worse than saying so.
 *
 *  `issues` come back to the client so a stripped zero-width character or a
 *  trimmed paragraph is visible to the author rather than a mystery later. */
export function parseProfileBody(
    body: Record<string, unknown>,
): { input: ProfileInput; issues: unknown[] } | { error: Response } {
    const name = String(body?.name ?? "").trim()
    if (!name) return { error: jsonError("bad_request", "name is required", 400) }
    if (name.length > 60) return { error: jsonError("bad_request", "that name is too long", 400) }

    const clean = sanitiseInstructions(body?.instructions, body?.path_rules)
    const preset = typeof body?.preset === "string" && body.preset ? body.preset : null

    return {
        input: {
            name,
            preset,
            dials: { ...DEFAULT_DIALS, ...parseDials(body?.dials) },
            lenses: parseLenses(body?.lenses),
            instructions: clean.instructions,
            pathRules: clean.pathRules,
        },
        issues: clean.issues,
    }
}

type ProfileInput = {
    name: string
    preset: string | null
    dials: Record<string, string>
    lenses: string[]
    instructions: string
    pathRules: { glob: string; text: string }[]
}
