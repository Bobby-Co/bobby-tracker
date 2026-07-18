import { jsonError, requireUser } from "@/lib/api"

// PATCH /api/notifications/[id] — mark one notification read.
//
// Fired when the user opens an item from the tray. `.is("read_at", null)` makes
// it idempotent: re-opening a read notification leaves the original timestamp
// alone rather than sliding it forward.
export async function PATCH(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const { error: dbErr } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}

// DELETE /api/notifications/[id] — remove one item from the tray.
//
// RLS (notifications_owner_delete) is the authorisation check: a row belonging
// to someone else simply isn't visible to the delete, so this needs no explicit
// ownership query. Deleting an already-gone row is a no-op 204 — the tray
// removes it optimistically and must not be able to strand itself on an error
// if the user double-clicks or two tabs race.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const { error: dbErr } = await supabase.from("notifications").delete().eq("id", id)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
