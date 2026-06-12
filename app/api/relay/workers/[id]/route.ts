import { jsonError, requireUser } from "@/lib/api"

// AUTH. Rename a worker. RLS scopes the update to the owner, so a bad id
// or another user's worker simply matches no rows.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const name = typeof body?.name === "string" ? body.name.trim() : ""
    if (!name) return jsonError("bad_request", "name is required", 400)

    const { error: dbErr } = await supabase
        .from("relay_workers")
        .update({ name })
        .eq("id", id)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    return Response.json({ ok: true })
}
