import { ApiContext, jsonError } from "@/lib/server/http/api"
import { BetaEmail, getBetaWaitlist } from "@/modules/beta"

// POST /api/beta/request → { ok }
//
// "Join the beta" on /waitlist. Records the request in tracker.beta_requests so
// the queue is a table we can sort and enrol from — previously the only trace was
// a `beta_requested` flag in the user's own auth metadata, which answers "did I
// ask?" but never "who is waiting?".
//
// Signed-in only: the address has to be one an identity provider vouched for, or
// the queue fills with typos and strangers. Idempotent — pressing the button
// again keeps the original position in the queue.
export async function POST() {
    const { user, error } = await new ApiContext().requireUser()
    if (error) return error

    const email = BetaEmail.of(user.email)
    if (!email) return jsonError("no_email", "this account has no email address", 400)

    const displayName =
        (user.user_metadata?.full_name as string | undefined) ??
        (user.user_metadata?.name as string | undefined) ??
        null

    try {
        await getBetaWaitlist().record(email, { userId: user.id, displayName })
        return Response.json({ ok: true })
    } catch (e) {
        console.error("[beta/request] record failed:", (e as Error).message)
        return jsonError("db_error", "couldn't join the waitlist just now", 500)
    }
}
