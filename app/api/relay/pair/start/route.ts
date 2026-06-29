import { jsonError } from "@/lib/api"
import { createServiceClient } from "@/lib/supabase/server"
import { genDeviceCode, genUserCode, normalizeUserCode } from "@/lib/relay"
import { clientKey, enforceRateLimit } from "@/lib/rate-limit"

// PUBLIC. Called by the bobby-relay app (no Supabase session) to start a
// device-pairing handshake. Mints a (device_code, user_code) pair and
// returns the URL the user should open while signed into the tracker to
// approve it. The relay then polls /api/relay/pair/poll with device_code.
export async function POST(request: Request) {
    // Unauthenticated — cap pairing-row creation per IP to stop spam.
    const limited = await enforceRateLimit("RELAY_RL", clientKey(request, "relay-start"))
    if (limited) return limited

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* empty body is fine */ }

    const name = typeof body?.name === "string" ? body.name.trim() : ""

    const deviceCode = genDeviceCode()
    const userCode = genUserCode() // dashed, for display
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()

    const svc = createServiceClient()
    const { error: dbErr } = await svc
        .from("relay_pairings")
        .insert({
            device_code: deviceCode,
            // Store the canonical (dashless, upper) form so approve/deny — which
            // normalize the user's input — match regardless of how it's typed.
            user_code: normalizeUserCode(userCode),
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

// Resolve the public origin to build the approval link. Prefer the
// operator-configured NEXT_PUBLIC_APP_URL so a spoofed Origin/Host header
// can't redirect the approval link to an attacker domain. Fall back to the
// request headers only when no app URL is configured (e.g. local dev).
function pairOrigin(request: Request): string {
    const configured = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
    if (configured) return configured

    const origin = request.headers.get("origin")
    if (origin) return origin.replace(/\/+$/, "")
    const host = request.headers.get("host")
    if (host) {
        // localhost dev runs over http; everything else is https.
        const scheme = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https"
        return `${scheme}://${host}`
    }
    return ""
}
