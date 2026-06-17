import { jsonError, requireUser } from "@/lib/api"
import { createServiceClient } from "@/lib/supabase/server"
import { normalizeUserCode } from "@/lib/relay"

// AUTH. The signed-in user rejects a pending pairing by user_code. The
// relay's next poll then sees status "denied" and stops.
export async function POST(request: Request) {
    const { error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const userCode = normalizeUserCode(String(body?.userCode ?? ""))
    if (!userCode) return jsonError("bad_request", "userCode required", 400)

    const svc = createServiceClient()
    const { error: dbErr } = await svc
        .from("relay_pairings")
        .update({ status: "denied" })
        .eq("user_code", userCode)
        .eq("status", "pending")
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    return Response.json({ ok: true })
}
