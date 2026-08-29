import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { getComponentPickerService } from "@/modules/embeds"

// GET  /api/projects/[id]/embeds  → the Zoo components this project can embed
// POST /api/projects/[id]/embeds  → freeze one into a pinned embed
//
// Both sit behind requireProjectAccess, and both touch our Zoo signing key, so
// the access check is what stands between a viewer and our credential — the
// same gate the issue view uses (upstream contract §9).
//
// The two verbs have very different costs. GET is a cached read on Zoo's side
// and keeps working when the developer's daemon is offline. POST asks that
// daemon to drive a headless browser, so it is deliberately a user action —
// never something a page render triggers.
//
// The project's git remote is the join key: Zoo indexes projects by normalized
// remote, which we already store, so neither side learns the other's ids.
//
// The PROJECT ID is the consent subject. Zoo records access per (app, subject,
// repo), so consent is scoped to this one project rather than to our whole
// deployment — pointing a second project at the same repo does not inherit the
// first one's grant, which is the point: a tracker user must not be able to
// reach a repo by naming it.

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const picker = getComponentPickerService()
    if (!picker) return Response.json({ configured: false, online: false, components: [] })

    const projectR = await repoRead(() => ctx.projects.findFull(id))
    if (projectR.error) return projectR.error
    const repoUrl = projectR.data?.repo_url ?? ""
    // A project with no linked repo has nothing to look up: Zoo is keyed by
    // remote, so this is "nothing to show", not a failure.
    if (!repoUrl) {
        return Response.json({ configured: true, online: false, components: [], reason: "no-repo" })
    }

    const outcome = await picker.list(repoUrl, id)
    if (outcome.status === "not-connected") {
        // Signed fine, but the repo's owner has not approved THIS project. The one
        // state the user can act on, so it must not read as "no such project".
        return Response.json({ configured: true, online: false, components: [], reason: "not-connected" })
    }
    if (outcome.status === "unavailable") {
        return Response.json({ configured: true, online: false, components: [], reason: "no-zoo-project" })
    }

    // Private: scoped to one caller's authorization, and short — `online` is the
    // volatile part and the picker acts on it.
    const { catalogue } = outcome
    return Response.json(
        { configured: true, online: catalogue.online, project: catalogue.project, components: catalogue.components },
        { headers: { "Cache-Control": "private, max-age=20" } },
    )
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext(request).requireProjectAccess(id)
    if (error) return error

    const picker = getComponentPickerService()
    if (!picker) return jsonError("embeds_unconfigured", "Zoo embeds aren't configured for this deployment.", 503)

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const componentId = typeof body.componentId === "string" ? body.componentId.trim() : ""
    const presetKey = typeof body.presetKey === "string" ? body.presetKey : ""
    if (!componentId) return jsonError("bad_request", "componentId is required.", 400)

    const projectR = await repoRead(() => ctx.projects.findFull(id))
    if (projectR.error) return projectR.error
    const repoUrl = projectR.data?.repo_url ?? ""
    if (!repoUrl) return jsonError("no_repo", "This project has no linked repository.", 400)

    const picked = await picker.pick({ repoUrl, componentId, presetKey, subject: id })
    if (!picked.ok) {
        const { status, message } = MINT_FAILURE[picked.reason] ?? MINT_FAILURE.error
        return jsonError(`mint_${picked.reason.replace(/-/g, "_")}`, message, status)
    }
    return Response.json({ embed: picked.embed }, { status: 201 })
}

/** Zoo's structured reasons, turned into something an author can act on. The
 *  distinction that matters is retryable (the daemon is asleep) versus not (the
 *  component needs data wired) — flattening both to "failed" would leave the
 *  author with nothing to do. */
const MINT_FAILURE: Record<string, { status: number; message: string }> = {
    offline: {
        status: 503,
        message: "The Zoo daemon for this repo isn't running. Start it and try again.",
    },
    empty: {
        status: 422,
        message: "That component renders nothing on its own — wire it to a preset in Zoo first.",
    },
    toobig: { status: 422, message: "That render is too large to pin as an embed." },
    "unknown-component": { status: 404, message: "Zoo doesn't know that component any more." },
    unclaimed: { status: 409, message: "That Zoo project hasn't been claimed by a user yet." },
    "not-found": { status: 404, message: "Zoo has no project for this repository." },
    "not-granted": {
        status: 403,
        message: "This project isn't connected to Zoo yet — the repo's owner has to approve it.",
    },
    "scope-not-granted": {
        status: 403,
        message: "This project can read Zoo components but isn't approved to pin them. The repo's owner can allow it.",
    },
    error: { status: 502, message: "Zoo couldn't render that component." },
}
