import { jsonError, requireUser } from "@/lib/api"
import { fetchAnalyserWorkers, type RelayModel, type RelayWorker } from "@/lib/relay"

// AUTH. List the signed-in user's active (non-revoked) workers, enriched
// with live connection state from the analyser. The analyser lookup is
// best-effort — on any failure every worker just shows offline.
export async function GET() {
    const { supabase, error } = await requireUser()
    if (error) return error

    const { data: rows, error: dbErr } = await supabase
        .from("relay_workers")
        .select("*")
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    const live = await fetchAnalyserWorkers()

    const workers: RelayWorker[] = (rows ?? []).map((row) => {
        // Prefer matching on workerId (the analyser sends it when it has
        // it); fall back to userId for older analyser builds.
        const conn = live.byWorkerId.get(row.id) ?? live.byUserId.get(row.user_id)
        const models = Array.isArray(row.models) ? (row.models as RelayModel[]) : []
        return {
            id: row.id,
            name: row.name,
            endpoint: (conn?.endpoint ?? row.endpoint) ?? null,
            models: conn?.models ?? models,
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at ?? null,
            online: Boolean(conn),
            connectedSince: conn?.connectedSince ?? null,
        }
    })

    return Response.json({ workers })
}
