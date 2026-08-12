import { ApiContext, jsonError } from "@/lib/server/http/api"
import { AnalyserError } from "@/modules/analysis"
import { getMeteredAnalyser } from "@/modules/billing"

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
    if (!paragraph.trim() && images.length === 0) {
        return jsonError("bad_request", "Provide a paragraph or at least one image.", 400)
    }

    // Project-scoped guard: enforces the caller's access (404 on absent/invisible)
    // and yields the owning team so the compose call is billed to it.
    const { user, teamId, error } = await new ApiContext().requireProjectAccess(project_id)
    if (error) return error

    try {
        const proposal = await getMeteredAnalyser({ teamId, userId: user.id }, { projectId: project_id }).compose({ paragraph, images })
        return Response.json({ proposal })
    } catch (e) {
        if (e instanceof AnalyserError) return jsonError(e.code, e.message, 502)
        return jsonError("ai_failed", e instanceof Error ? e.message : String(e), 502)
    }
}