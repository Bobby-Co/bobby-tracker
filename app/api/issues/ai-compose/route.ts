import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { AnalyserError, getAnalyser } from "@/modules/analysis"

// POST /api/issues/ai-compose
//
// Body: { project_id, paragraph, images?: string[] }  (images are
// base64 data URIs produced by lib/image-compress.ts on the client)
//
// Returns a structured draft the user can edit before persisting via
// the regular POST /api/issues path. We don't insert anything here —
// the compose flow is conversational; the user stays in control of
// the final shape and the "is this a duplicate?" decision.
//
// All AI inference happens in bobby-analyser (POST /issues/compose).
// The tracker just enforces project ownership and forwards the
// already-compressed images.
export async function POST(request: Request) {
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const project_id = String(body?.project_id ?? "").trim()
    const paragraph = typeof body?.paragraph === "string" ? body.paragraph : ""
    const rawImages = Array.isArray(body?.images) ? body.images : []
    const images = rawImages
        .filter((x: unknown): x is string => typeof x === "string" && x.startsWith("data:image/"))
        .slice(0, 6) // hard cap mirrored on the analyser side

    if (!project_id) return jsonError("bad_request", "project_id required", 400)

    // The project id comes from the BODY, so the guard runs after parsing it —
    // the same two-step shape as POST /api/issues. This was requireUser plus a
    // findName() "visibility check" that was only ever visibility-scoped because
    // RLS made it so; AccessService also applies the group-level gate.
    const { ctx, error } = await new ApiContext().requireProjectAccess(project_id)
    if (error) return error
    if (!paragraph.trim() && images.length === 0) {
        return jsonError("bad_request", "Provide a paragraph or at least one image.", 400)
    }

    // Name for the compose prompt. Access was already decided above; a null here
    // now means genuinely absent.
    const projects = ctx.projects
    const { data: projectName, error: pErr } = await repoRead(() => projects.findName(project_id))
    if (pErr) return pErr
    if (!projectName) return jsonError("not_found", "project not found", 404)

    try {
        const proposal = await getAnalyser().compose({ paragraph, images })
        return Response.json({ proposal })
    } catch (e) {
        if (e instanceof AnalyserError) return jsonError(e.code, e.message, 502)
        return jsonError("ai_failed", e instanceof Error ? e.message : String(e), 502)
    }
}
