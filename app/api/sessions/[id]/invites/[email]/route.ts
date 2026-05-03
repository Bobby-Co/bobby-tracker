import { jsonError, requireUser } from "@/lib/api"

// DELETE /api/sessions/[id]/invites/[email] — remove a whitelisted
// email. The email path segment is URL-encoded by the caller; we
// decode and lowercase before matching since rows are stored lower.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; email: string }> }) {
    const { id, email: rawEmail } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const email = decodeURIComponent(rawEmail).trim().toLowerCase()
    if (!email) return jsonError("bad_request", "email required", 400)

    const { error: dbErr } = await supabase
        .from("public_session_invites")
        .delete()
        .eq("session_id", id)
        .eq("email", email)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
