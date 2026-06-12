import { jsonError } from "@/lib/api"
import { createServiceClient } from "@/lib/supabase/server"
import { genDeviceCode, genUserCode } from "@/lib/relay"

// PUBLIC. Called by the bobby-relay app (no Supabase session) to start a
// device-pairing handshake. Mints a (device_code, user_code) pair and
// returns the URL the user should open while signed into the tracker to
// approve it. The relay then polls /api/relay/pair/poll with device_code.
export async function POST(request: Request) {
    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* empty body is fine */ }

    const name = typeof body?.name === "string" ? body.name.trim() : ""

    const deviceCode = genDeviceCode()
    const userCode = genUserCode()
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()

    const svc = createServiceClient()
    const { error: dbErr } = await svc
        .from("relay_pairings")
        .insert({
            device_code: deviceCode,
            user_code: userCode,
            status: "pending",
            worker_name: name || null,
            expires_at: expiresAt,
        })
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    const origin = pairOrigin(request)
    return Response.json({
        deviceCode,
        userCode,
        pairUrl: `${origin}/link?code=${userCode}`,
        interval: 2,
        expiresIn: 600,
    })
}

// Resolve the public origin to build the approval link: prefer the
// request's Origin header, then reconstruct from the Host header, then
// fall back to the configured app URL.
function pairOrigin(request: Request): string {
    const origin = request.headers.get("origin")
    if (origin) return origin.replace(/\/+$/, "")
    const host = request.headers.get("host")
    if (host) return `https://${host}`
    return (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
}
