import { jsonError, requireUser } from "@/lib/api"

// AUTH. Revoke a worker by stamping revoked_at. RLS scopes the update to
// the owner. Revoked rows stop resolving in /api/relay/resolve, so the
// worker's token is immediately dead — revoke is real, not cosmetic.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const { error: dbErr } = await supabase
        .from("relay_workers")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    return Response.json({ ok: true })
}
