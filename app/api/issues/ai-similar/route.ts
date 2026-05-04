import { jsonError, requireUser } from "@/lib/api"
import { OpenAIError, embedText, issueEmbeddingText } from "@/lib/openai"
import type { Project } from "@/lib/supabase/types"

// POST /api/issues/ai-similar
//
// Body: { project_id, title, body, exclude_id?, limit? }
//
// Returns up to N already-existing issues in the same project whose
// stored embeddings are nearest (cosine) to the embedding of the
// provided draft. Used by the AI composer to surface "looks like
// you're filing #42" before the user hits Create.
//
// We embed the draft on every call instead of caching — cost is a
// fraction of a cent per request and we don't want stale results if
// the user edits the proposal before submitting.
export async function POST(request: Request) {
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const project_id = String(body?.project_id ?? "").trim()
    const title = String(body?.title ?? "")
    const issueBody = String(body?.body ?? "")
    const exclude_id = typeof body?.exclude_id === "string" ? body.exclude_id : null
    const limitRaw = Number(body?.limit ?? 5)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, Math.floor(limitRaw))) : 5

    if (!project_id) return jsonError("bad_request", "project_id required", 400)
    if (!title.trim() && !issueBody.trim()) {
        return jsonError("bad_request", "title or body required", 400)
    }

    // Cheap ownership check before paying OpenAI for an embedding.
    const { data: project } = await supabase
        .from("projects")
        .select("id")
        .eq("id", project_id)
        .maybeSingle<Pick<Project, "id">>()
    if (!project) return jsonError("not_found", "project not found", 404)

    let vector: number[]
    try {
        vector = await embedText(issueEmbeddingText({ title, body: issueBody }))
    } catch (e) {
        if (e instanceof OpenAIError) return jsonError(e.code, e.message, e.status)
        return jsonError("ai_failed", e instanceof Error ? e.message : String(e), 502)
    }

    const { data, error: rpcErr } = await supabase
        .rpc("find_similar_issues", {
            p_project_id: project_id,
            p_embedding: vector,
            p_limit: limit,
            p_exclude_id: exclude_id,
        })
    if (rpcErr) return jsonError("db_error", rpcErr.message, 500)

    return Response.json({ similar: data ?? [] })
}
