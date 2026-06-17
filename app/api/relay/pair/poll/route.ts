import { jsonError } from "@/lib/api"
import { createServiceClient } from "@/lib/supabase/server"

// PUBLIC. The bobby-relay app polls this with its device_code until the
// user approves (or denies) the pairing. On approval it returns the opaque
// worker token + userId the relay stores and presents to the analyser.
export async function GET(request: Request) {
    const url = new URL(request.url)
    const deviceCode = url.searchParams.get("deviceCode") ?? ""
    if (!deviceCode) return jsonError("bad_request", "deviceCode required", 400)

    const svc = createServiceClient()
    const { data: pairing, error: dbErr } = await svc
        .from("relay_pairings")
        .select("*")
        .eq("device_code", deviceCode)
        .maybeSingle()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    if (!pairing) return jsonError("not_found", "unknown device code", 404)

    // Expire a stale pending pairing on read so the relay stops polling.
    if (pairing.status === "pending" && new Date(pairing.expires_at).getTime() < Date.now()) {
        await svc.from("relay_pairings").update({ status: "expired" }).eq("id", pairing.id)
        return Response.json({ status: "expired" })
    }

    switch (pairing.status) {
        case "pending":
            return Response.json({ status: "pending" })
        case "denied":
            return Response.json({ status: "denied" })
        case "expired":
            return Response.json({ status: "expired" })
        case "consumed":
            return Response.json({ status: "consumed" })
        case "approved": {
            // Hand the worker token to the relay exactly once, then flip
            // the pairing to consumed so a replayed poll can't re-leak it.
            const { data: worker, error: wErr } = await svc
                .from("relay_workers")
                .select("token, user_id")
                .eq("id", pairing.worker_id)
                .maybeSingle()
            if (wErr) return jsonError("db_error", wErr.message, 500)
            if (!worker) return jsonError("not_found", "worker missing", 404)

            await svc
                .from("relay_pairings")
                .update({ status: "consumed", consumed_at: new Date().toISOString() })
                .eq("id", pairing.id)

            return Response.json({ status: "approved", token: worker.token, userId: worker.user_id })
        }
        default:
            return Response.json({ status: pairing.status })
    }
}
