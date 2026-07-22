import { ApiContext, repoRead } from "@/lib/server/http/api"

// PATCH /api/notifications/[id] — mark one notification read.
//
// Fired when the user opens an item from the tray. `.is("read_at", null)` makes
// it idempotent: re-opening a read notification leaves the original timestamp
// alone rather than sliding it forward.
export async function PATCH(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireUser()
    if (error) return error

    const { error: dbErr } = await repoRead(() => ctx.notifications.markRead(id))
    if (dbErr) return dbErr
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
    const { ctx, error } = await new ApiContext().requireUser()
    if (error) return error

    const { error: dbErr } = await repoRead(() => ctx.notifications.remove(id))
    if (dbErr) return dbErr
    return new Response(null, { status: 204 })
}
