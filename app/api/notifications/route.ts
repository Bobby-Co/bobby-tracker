import { after } from "next/server"
import { jsonError, requireUser } from "@/lib/platform/http/api"
import { createServiceClient } from "@/lib/supabase/server"
import { drainNotifications } from "@/modules/notifications"
import type { Notification } from "@/lib/supabase/types"

// The tray renders a bounded list, and migration 0049 trims each user's feed to
// 50 rows on write — so this ceiling is really just belt-and-braces.
const LIMIT = 50

// GET /api/notifications — the bell's feed, newest first.
//
// RLS scopes rows to the caller (notifications_owner_select), so there is no
// user filter here for the same reason the projects list has none.
//
// unread is returned rather than derived client-side: the badge must stay
// correct even though the list is capped, and it costs a head-count, not a
// second round-trip.
export async function GET() {
    const { supabase, error } = await requireUser()
    if (error) return error

    // Belt-and-braces drain: if the pg_net wake-up (migration 0054) was missed,
    // surface pending events when someone opens the bell — a repair path this
    // no-cron/no-retry stack otherwise lacks. Self-gating on the drain token;
    // after() so it never delays or fails the response. No-op when the outbox is
    // empty (i.e. before cutover).
    if (process.env.NOTIFY_DRAIN_TOKEN) {
        after(() => drainNotifications(createServiceClient(), 10).catch(() => {}))
    }

    const { data, error: dbErr } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(LIMIT)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    const notifications = (data ?? []) as Notification[]
    return Response.json({
        notifications,
        unread: notifications.filter((n) => n.read_at === null).length,
    })
}

// PATCH /api/notifications — mark every unread notification read.
//
// Backs "Mark all read". Filtering on read_at is null keeps it from rewriting
// timestamps on rows already read, so the value stays "when it was first read".
export async function PATCH() {
    const { supabase, error } = await requireUser()
    if (error) return error

    // The UPDATE grant is column-scoped to read_at (0049) — touching any other
    // column here would fail at the privilege layer, by design.
    const { error: dbErr } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .is("read_at", null)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    return new Response(null, { status: 204 })
}
