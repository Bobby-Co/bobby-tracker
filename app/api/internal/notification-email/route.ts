import { jsonError } from "@/lib/platform/http/api"
import { sendNotificationEmail } from "@/modules/notifications"

export const dynamic = "force-dynamic"

// POST /api/internal/notification-email — the DB→app callback fired by the
// tracker.email_notification trigger (pg_net) on every notification insert
// (migration 0051). Server-to-server, authenticated with the shared
// NOTIFY_EMAIL_TOKEN, which must equal tracker.app_config.notify_email_token.
// Body is just { id }; we reload the row here so the email always reflects
// committed state. pg_net is fire-and-forget, so the response is only for logs.
export async function POST(request: Request) {
    const expected = process.env.NOTIFY_EMAIL_TOKEN
    if (!expected) return jsonError("not_configured", "notification email callback is not configured", 503)

    const auth = request.headers.get("authorization") ?? ""
    const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : ""
    if (presented !== expected) return jsonError("unauthorized", "bad notify token", 401)

    let id: string | undefined
    try {
        const body = (await request.json()) as { id?: string }
        id = body.id
    } catch {
        return jsonError("bad_request", "invalid json body", 400)
    }
    if (!id) return jsonError("bad_request", "id is required", 400)

    try {
        await sendNotificationEmail(id)
    } catch (err) {
        const e = err as { message?: string }
        return jsonError("send_failed", e?.message ?? "send failed", 500)
    }
    return Response.json({ ok: true })
}
