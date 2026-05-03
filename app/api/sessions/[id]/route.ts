import { jsonError, requireUser } from "@/lib/api"
import type { PublicSession } from "@/lib/supabase/types"

function parseWindow(v: unknown): string | null | undefined {
    if (v === undefined) return undefined
    if (v === null || v === "") return null
    if (typeof v !== "string") return undefined
    const t = Date.parse(v)
    if (Number.isNaN(t)) return undefined
    return new Date(t).toISOString()
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error
    const { data, error: dbErr } = await supabase
        .from("public_sessions")
        .select("*")
        .eq("id", id)
        .maybeSingle<PublicSession>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    if (!data) return jsonError("not_found", "session not found", 404)

    const { data: links } = await supabase
        .from("public_session_projects")
        .select("project_id,projects(name)")
        .eq("session_id", id)
    const projects = (links ?? [])
        .map((r: { project_id: string; projects: unknown }) => {
            const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects
            const name = (proj && typeof proj === "object" && "name" in proj) ? (proj as { name: string }).name : ""
            return { id: r.project_id, name }
        })

    return Response.json({ session: data, projects })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const patch: Record<string, unknown> = {}
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled
    if (body.access_mode === "link" || body.access_mode === "invite") {
        patch.access_mode = body.access_mode
    }
    if (body.submissions_visibility === "all" || body.submissions_visibility === "own") {
        patch.submissions_visibility = body.submissions_visibility
    }
    if (typeof body.name === "string") {
        const v = body.name.trim()
        if (!v) return jsonError("bad_request", "name cannot be empty", 400)
        patch.name = v
    }
    if (typeof body.title === "string") patch.title = body.title.trim() || null
    if (typeof body.description === "string") patch.description = body.description.trim() || null
    const start_at = parseWindow(body.start_at)
    const end_at = parseWindow(body.end_at)
    if (start_at !== undefined) patch.start_at = start_at
    if (end_at !== undefined) patch.end_at = end_at
    if (start_at && end_at && Date.parse(start_at) >= Date.parse(end_at)) {
        return jsonError("bad_request", "start_at must be before end_at", 400)
    }
    if (Object.keys(patch).length === 0) return jsonError("bad_request", "no fields to update", 400)

    const { data, error: dbErr } = await supabase
        .from("public_sessions")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single<PublicSession>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ session: data })
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error
    const { error: dbErr } = await supabase.from("public_sessions").delete().eq("id", id)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
