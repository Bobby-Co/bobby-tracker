import { after } from "next/server"
import { ApiContext, repoRead } from "@/lib/server/http/api"
import { Supabase } from "@/lib/server/supabase"
import { createNotificationService } from "@/modules/notifications"

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
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    // Belt-and-braces drain: if the pg_net wake-up (migration 0054) was missed,
    // surface pending events when someone opens the bell — a repair path this
    // no-cron/no-retry stack otherwise lacks. Self-gating on the drain token;
    // after() so it never delays or fails the response. No-op when the outbox is
    // empty (i.e. before cutover).
    if (process.env.NOTIFY_DRAIN_TOKEN) {
        after(() => createNotificationService(Supabase.service()).drain(10).catch(() => {}))
    }

    const { data: notifications, error: dbErr } = await repoRead(() => ctx.notifications.listRecent(user.id, LIMIT))
    if (dbErr) return dbErr

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
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    // The UPDATE grant is column-scoped to read_at (0049) — touching any other
    // column here would fail at the privilege layer, by design.
    const { error: dbErr } = await repoRead(() => ctx.notifications.markAllRead(user.id))
    if (dbErr) return dbErr

    return new Response(null, { status: 204 })
}
