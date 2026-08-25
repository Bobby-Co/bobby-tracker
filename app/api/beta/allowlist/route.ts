import { ApiContext, jsonError, forbidden } from "@/lib/server/http/api"
import { EnvBetaStaff, createBetaMailer, getBetaEnrollmentService, getBetaWaitlist } from "@/modules/beta"

// The beta list, as a staff surface.
//
//   GET    /api/beta/allowlist            → { enrolled, waiting }
//   POST   /api/beta/allowlist  { email, note? }  → { entry }   enrol someone
//   DELETE /api/beta/allowlist?email=…            → { removed } withdraw an invite
//
// Gated on EnvBetaStaff, not on a team role: every role this app has is scoped to
// a team, and "may run the beta" isn't a property of any team. Staff are named in
// BETA_ADMIN_EMAILS (falling back to the legacy NEXT_PUBLIC_BETA_ALLOWED_EMAILS),
// and an unset variable admits nobody.
//
// Enrolling here is exactly equivalent to inserting the row by hand from the SQL
// editor — the route is the convenience, the table is the contract.

/** requireUser + the staff check, which is the same three lines in all three
 *  handlers and must not drift between them. */
async function requireStaff() {
    const { user, error } = await new ApiContext().requireUser()
    if (error) return { user: null, error }
    if (!new EnvBetaStaff().includes(user.email)) {
        return { user: null, error: forbidden("only beta admins can manage the beta list") }
    }
    return { user, error: null as null }
}

export async function GET() {
    const { error } = await requireStaff()
    if (error) return error

    try {
        // Both lists in one response: enrolling is done by reading the queue and
        // picking from it, so a staff surface that returns one without the other
        // is half a tool.
        const [enrolled, waiting] = await Promise.all([
            getBetaEnrollmentService().list(),
            getBetaWaitlist().list(),
        ])
        return Response.json({ enrolled, waiting })
    } catch (e) {
        return jsonError("db_error", (e as Error).message, 500)
    }
}

export async function POST(request: Request) {
    const { user, error } = await requireStaff()
    if (error) return error

    let email = ""
    let note: string | null = null
    try {
        const body = (await request.json()) as { email?: unknown; note?: unknown }
        email = typeof body.email === "string" ? body.email : ""
        note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null
    } catch {
        return jsonError("bad_request", "expected a JSON body", 400)
    }

    try {
        const entry = await getBetaEnrollmentService().enroll(email, { invitedBy: user.id, note })
        // null means the input wasn't an address at all — a caller mistake, not
        // an empty result.
        if (!entry) return jsonError("bad_request", "that doesn't look like an email address", 400)

        // Tell the invitee. This is the whole point of enrolling: the row lives
        // in a table they cannot see, on a screen they will never visit, so
        // without this the invitation is silent until they happen to sign in
        // again. The mailer swallows its own failures — an enrolment that
        // succeeded must not be reported as a failure because mail was down.
        await createBetaMailer().sendAccessGranted({ to: entry.email, note })

        return Response.json({ entry })
    } catch (e) {
        return jsonError("db_error", (e as Error).message, 500)
    }
}

export async function DELETE(request: Request) {
    const { error } = await requireStaff()
    if (error) return error

    const email = new URL(request.url).searchParams.get("email") ?? ""
    if (!email) return jsonError("bad_request", "email is required", 400)

    try {
        const removed = await getBetaEnrollmentService().revoke(email)
        // Withdraws the INVITATION. Anyone already admitted on that address keeps
        // the metadata stamp and stays in the app until they are evicted by user
        // id — see BetaEnrollmentService.revoke for why that is the default.
        return Response.json({ removed })
    } catch (e) {
        return jsonError("db_error", (e as Error).message, 500)
    }
}
