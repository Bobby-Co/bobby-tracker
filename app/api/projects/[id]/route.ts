import { jsonError, requireUser } from "@/lib/api"
import type { Project } from "@/lib/supabase/types"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const allowed: Record<string, unknown> = {}
    if (typeof body.name === "string") allowed.name = body.name.trim()
    if (typeof body.description === "string") allowed.description = body.description
    if (typeof body.repo_url === "string") allowed.repo_url = body.repo_url.trim()
    if (Object.keys(allowed).length === 0) return jsonError("bad_request", "no fields to update", 400)

    const { data, error: dbErr } = await supabase
        .from("projects")
        .update(allowed)
        .eq("id", id)
        .select("*")
        .single<Project>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ project: data })
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error
    const { error: dbErr } = await supabase.from("projects").delete().eq("id", id)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
