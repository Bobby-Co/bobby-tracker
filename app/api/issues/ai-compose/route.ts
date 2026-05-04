import { jsonError, requireUser } from "@/lib/api"
import { OpenAIError, proposeIssue } from "@/lib/openai"
import type { Project } from "@/lib/supabase/types"

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
// Project ownership is enforced through the same RLS the rest of the
// app uses: requireUser() gives us a cookie-bound supabase client,
// and we look up the project under it before paying for an OpenAI
// call. A non-owner gets a 404.
export async function POST(request: Request) {
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const project_id = String(body?.project_id ?? "").trim()
    const paragraph = typeof body?.paragraph === "string" ? body.paragraph : ""
    const rawImages = Array.isArray(body?.images) ? body.images : []
    const images = rawImages
        .filter((x: unknown): x is string => typeof x === "string" && x.startsWith("data:image/"))
        .slice(0, 6) // hard cap — token cost stays bounded even with detail:"low"

    if (!project_id) return jsonError("bad_request", "project_id required", 400)
    if (!paragraph.trim() && images.length === 0) {
        return jsonError("bad_request", "Provide a paragraph or at least one image.", 400)
    }

    const { data: project } = await supabase
        .from("projects")
        .select("id")
        .eq("id", project_id)
        .maybeSingle<Pick<Project, "id">>()
    if (!project) return jsonError("not_found", "project not found", 404)

    try {
        const proposal = await proposeIssue({ paragraph, images })
        return Response.json({ proposal })
    } catch (e) {
        if (e instanceof OpenAIError) return jsonError(e.code, e.message, e.status)
        const message = e instanceof Error ? e.message : String(e)
        return jsonError("ai_failed", message, 502)
    }
}
