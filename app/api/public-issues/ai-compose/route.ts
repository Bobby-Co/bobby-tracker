import { jsonError } from "@/lib/api"
import { createServiceClient } from "@/lib/supabase/server"
import { AnalyserError, composeIssue } from "@/lib/analyser"
import { requireInviteAccess, resolvePublicSession } from "@/lib/public-session"

// POST /api/public-issues/ai-compose
//
// Body: { token, project_id, paragraph, images?: string[] }  (images
// are base64 data URIs produced by lib/image-compress.ts)
//
// Public counterpart to /api/issues/ai-compose. Authority comes from
// the session token, not auth cookies; we run the same gauntlet as
// the rest of the public-issues surface (resolve session, enforce
// invite-mode access, validate the project belongs to the session)
// before calling out to the analyser. Doesn't persist anything —
// the user reviews the draft and then submits via the regular
// POST /api/public-issues path, which is where the issue is created
// and the embedding gets queued.
export async function POST(request: Request) {
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const token = String(body?.token ?? "").trim()
    const project_id = String(body?.project_id ?? "").trim()
    const paragraph = typeof body?.paragraph === "string" ? body.paragraph : ""
    const rawImages = Array.isArray(body?.images) ? body.images : []
    const images = rawImages
        .filter((x: unknown): x is string => typeof x === "string" && x.startsWith("data:image/"))
        .slice(0, 6)

    if (!project_id) return jsonError("bad_request", "project_id required", 400)
    if (!paragraph.trim() && images.length === 0) {
        return jsonError("bad_request", "Provide a paragraph or at least one image.", 400)
    }

    const svc = createServiceClient()
    const sess = await resolvePublicSession(svc, token, { requireOpen: true })
    if (sess.error) return sess.error

    const inviteErr = await requireInviteAccess(sess.session)
    if (inviteErr) return inviteErr

    if (!sess.session.project_ids.includes(project_id)) {
        return jsonError("bad_request", "this project isn't part of the session", 400)
    }

    try {
        const proposal = await composeIssue({ paragraph, images })
        return Response.json({ proposal })
    } catch (e) {
        if (e instanceof AnalyserError) return jsonError(e.code, e.message, 502)
        return jsonError("ai_failed", e instanceof Error ? e.message : String(e), 502)
    }
}
