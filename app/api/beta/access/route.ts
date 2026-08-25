import { ApiContext, jsonError } from "@/lib/server/http/api"
import { getBetaEnrollmentService } from "@/modules/beta"

// POST /api/beta/access → { allowed }
//
// "Has my beta spot opened yet?" The waitlist page asks on load, and the OAuth
// callback asks the same service inline at sign-in.
//
// This exists because the two halves of the gate live in different places. The
// enrolment list is a table only the server can read (RLS with no policies,
// 0074); the gate is a synchronous check of the user's auth metadata that runs in
// the browser. So somebody has to look the caller up and stamp the flag onto
// their identity — that is this route, and modules/beta is where it happens.
//
// A POST rather than a GET because it MUTATES: on a hit it writes the metadata
// stamp. On `allowed: true` the client must refresh its session before the flag
// appears in its JWT (the waitlist page does exactly that, then routes on).
export async function POST() {
    const { user, error } = await new ApiContext().requireUser()
    if (error) return error

    try {
        const allowed = await getBetaEnrollmentService().admit({
            id: user.id,
            email: user.email,
            stamped: user.user_metadata?.whitelisted === true,
        })
        return Response.json({ allowed })
    } catch (e) {
        // Fail CLOSED, loudly. Answering `allowed: false` on a database error
        // would be indistinguishable from "not invited" and would quietly park
        // enrolled users on the waitlist; a 500 at least says something broke.
        console.error("[beta/access] admit failed:", (e as Error).message)
        return jsonError("db_error", "couldn't check beta access just now", 500)
    }
}
