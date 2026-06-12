import { jsonError, requireUser } from "@/lib/api"
import { createServiceClient } from "@/lib/supabase/server"
import { genToken, normalizeUserCode } from "@/lib/relay"

// AUTH. The signed-in user approves a pending pairing by user_code (read
// off the relay window). We mint the worker (with its opaque token), then
// flip the pairing to approved so the relay's next poll collects the token.
export async function POST(request: Request) {
    const { user, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const userCode = normalizeUserCode(String(body?.userCode ?? ""))
    if (!userCode) return jsonError("bad_request", "userCode required", 400)

    // The relay has no session, so the pairing row isn't owned by anyone
    // yet — look it up through the service role.
    const svc = createServiceClient()
    const { data: pairing, error: pErr } = await svc
        .from("relay_pairings")
        .select("*")
        .eq("user_code", userCode)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .maybeSingle()
    if (pErr) return jsonError("db_error", pErr.message, 500)
    if (!pairing) return jsonError("not_found", "invalid or expired code", 404)

    const name = (pairing.worker_name as string | null) || "My Mac"

    const { data: worker, error: wErr } = await svc
        .from("relay_workers")
        .insert({ user_id: user.id, name, token: genToken() })
        .select("id")
        .single()
    if (wErr) return jsonError("db_error", wErr.message, 500)

    const { error: uErr } = await svc
        .from("relay_pairings")
        .update({
            status: "approved",
            user_id: user.id,
            worker_id: worker.id,
            approved_at: new Date().toISOString(),
        })
        .eq("id", pairing.id)
    if (uErr) return jsonError("db_error", uErr.message, 500)

    return Response.json({ ok: true, name })
}
