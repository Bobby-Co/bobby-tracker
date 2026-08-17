import { jsonError } from "@/lib/server/http/api"
import { Supabase } from "@/lib/server/supabase"
import { createNotificationService } from "@/modules/notifications"

export const dynamic = "force-dynamic"

// POST /api/internal/notifications/drain — drains the notification outbox.
//
// Fired by the DB via pg_net when an event is enqueued (migration 0054's trigger
// on tracker.notification_outbox), and safe to call opportunistically. This is
// the app-owned replacement for the old per-event delivery triggers: it pulls
// pending events and dispatches each to its channels (in-app feed + email),
// resolving team-aware recipients.
//
// Server-to-server, authenticated with the shared NOTIFY_DRAIN_TOKEN, which must
// equal tracker.app_config.notify_drain_token. Body is ignored (the drain pulls
// all pending rows); the pg_net ping is just a wake-up.
export async function POST(request: Request) {
    const expected = process.env.NOTIFY_DRAIN_TOKEN
    if (!expected) return jsonError("not_configured", "notification drain is not configured", 503)

    const auth = request.headers.get("authorization") ?? ""
    const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : ""
    if (presented !== expected) return jsonError("unauthorized", "bad drain token", 401)

    try {
        const drained = await createNotificationService(Supabase.service()).drain(50)
        return Response.json({ ok: true, drained })
    } catch (err) {
        const e = err as { message?: string }
        return jsonError("drain_failed", e?.message ?? "drain failed", 500)
    }
}
