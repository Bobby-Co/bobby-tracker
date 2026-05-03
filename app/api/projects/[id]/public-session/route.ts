import { randomBytes } from "node:crypto"
import { jsonError, requireUser } from "@/lib/api"
import type { ProjectPublicSession } from "@/lib/supabase/types"

// Owner-only management of a project's public-issue session.
// GET    — fetch the current session (or null if none exists)
// POST   — create-or-rotate the token (and enable it)
// PATCH  — toggle enabled or update title/description
// DELETE — disable the session (keeps the row so the same link can be re-enabled)

function newToken() {
    // 32 url-safe chars; far past the 16-char min the schema enforces.
    return randomBytes(24).toString("base64url")
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error
    const { data } = await supabase
        .from("project_public_sessions")
        .select("*")
        .eq("project_id", id)
        .maybeSingle<ProjectPublicSession>()
    return Response.json({ session: data ?? null })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* empty body is fine */ }
    const title = typeof body.title === "string" ? body.title.trim() || null : null
    const description = typeof body.description === "string" ? body.description.trim() || null : null

    const token = newToken()
    const { data, error: dbErr } = await supabase
        .from("project_public_sessions")
        .upsert(
            { project_id: id, token, enabled: true, title, description },
            { onConflict: "project_id" },
        )
        .select("*")
        .single<ProjectPublicSession>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ session: data })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const patch: Record<string, unknown> = {}
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled
    if (typeof body.title === "string") patch.title = body.title.trim() || null
    if (typeof body.description === "string") patch.description = body.description.trim() || null
    if (Object.keys(patch).length === 0) return jsonError("bad_request", "no fields to update", 400)

    const { data, error: dbErr } = await supabase
        .from("project_public_sessions")
        .update(patch)
        .eq("project_id", id)
        .select("*")
        .single<ProjectPublicSession>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ session: data })
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error
    const { error: dbErr } = await supabase
        .from("project_public_sessions")
        .delete()
        .eq("project_id", id)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
