import { jsonError, requireUser } from "@/lib/api"

// DELETE /api/sessions/[id]/invites/[email] — remove a whitelisted
// email. The email path segment is URL-encoded by the caller; we
// decode and lowercase before matching since rows are stored lower.
//
// The owner can never be removed: it would lock them out of their
// own session the moment access_mode is 'invite'. Defensive at the
// API layer because the UI's "no remove" button isn't a security
// boundary on its own.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; email: string }> }) {
    const { id, email: rawEmail } = await params
    const { supabase, user, error } = await requireUser()
    if (error) return error

    const email = decodeURIComponent(rawEmail).trim().toLowerCase()
    if (!email) return jsonError("bad_request", "email required", 400)

    const ownerEmail = (user.email ?? "").trim().toLowerCase()
    if (ownerEmail && email === ownerEmail) {
        return jsonError(
            "owner_protected",
            "You can't remove yourself from your own session's invite list.",
            409,
        )
    }

    const { error: dbErr } = await supabase
        .from("public_session_invites")
        .delete()
        .eq("session_id", id)
        .eq("email", email)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
