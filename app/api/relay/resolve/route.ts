import { jsonError } from "@/lib/api"
import { createServiceClient } from "@/lib/supabase/server"

// SERVER-TO-SERVER. The bobby-analyser presents an opaque worker token and
// gets back the owning userId + workerId. Authenticated with the shared
// BOBBY_ANALYSER_TOKEN (the same secret the tracker uses to call the
// analyser). Revoked workers don't resolve, which is what makes revoke
// take effect on the analyser side.
export async function GET(request: Request) {
    const expected = process.env.BOBBY_ANALYSER_TOKEN
    if (!expected) return jsonError("not_configured", "relay resolve is not configured", 503)

    const auth = request.headers.get("authorization") ?? ""
    const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : ""
    if (presented !== expected) return jsonError("unauthorized", "bad analyser token", 401)

    const url = new URL(request.url)
    const token = url.searchParams.get("token") ?? ""
    if (!token) return jsonError("bad_request", "token required", 400)

    const svc = createServiceClient()
    const { data: worker, error: dbErr } = await svc
        .from("relay_workers")
        .select("id, user_id")
        .eq("token", token)
        .is("revoked_at", null)
        .maybeSingle()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    if (!worker) return jsonError("not_found", "unknown or revoked token", 404)

    // Bump liveness so the workers UI can show recency even between
    // analyser /relay/workers reports.
    await svc
        .from("relay_workers")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", worker.id)

    return Response.json({ userId: worker.user_id, workerId: worker.id })
}
