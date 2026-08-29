import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { getComponentPickerService } from "@/modules/embeds"

// GET /api/projects/[id]/embeds/thumb?componentId=Card
//
// The picker's preview images. This is a PROXY, and deliberately so: Zoo
// authenticates the catalogue with a bearer token, and an <img> cannot send a
// header — so either the credential goes in the URL (it must not: this token can
// read the whole repo's catalogue) or our server fetches the bytes. It fetches.
//
// The upstream contract's warning about proxying (§9) is about proxies that
// STRIP the access check. This one is the access check: requireProjectAccess
// runs first, and the Zoo token never leaves the server. It also carries nothing
// pinned — these are the studio's own cheap palette thumbnails, not embeds, so
// browsing the picker mints nothing and costs nothing.
//
// 202 means the developer's daemon has started rendering; the client asks again.
// That is a normal first-look outcome, not an error.

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext(request).requireProjectAccess(id)
    if (error) return error

    const componentId = new URL(request.url).searchParams.get("componentId")?.trim() ?? ""
    if (!componentId) return jsonError("bad_request", "componentId is required.", 400)

    const picker = getComponentPickerService()
    if (!picker) return new Response(null, { status: 404 })

    const projectR = await repoRead(() => ctx.projects.findFull(id))
    if (projectR.error) return projectR.error
    const repoUrl = projectR.data?.repo_url ?? ""
    if (!repoUrl) return new Response(null, { status: 404 })

    const thumb = await picker.thumbnail(repoUrl, componentId, id)
    if (thumb.status === "pending") {
        return Response.json({ status: "pending" }, { status: 202 })
    }
    if (thumb.status === "unavailable") {
        // No image, and no reason to dress it up: the picker falls back to the
        // component's name, which is what it showed before previews existed.
        return new Response(null, { status: 404 })
    }

    return new Response(thumb.bytes, {
        headers: {
            "Content-Type": thumb.contentType,
            "X-Content-Type-Options": "nosniff",
            // Short and private, mirroring Zoo: a thumbnail tracks the working
            // tree, so unlike a pinned embed it is not immutable.
            "Cache-Control": "private, max-age=60",
        },
    })
}
