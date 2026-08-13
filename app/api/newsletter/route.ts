import { Supabase } from "@/lib/server/supabase"

// POST /api/newsletter  { email }
//
// Landing-page newsletter sign-up. Unauthenticated by design — the audience is
// people who don't have an account yet.
//
// Writes go through the service client because tracker.newsletter_subscribers
// has RLS on and no policies (see migration 0053): an email list must not be
// readable or writable from the browser, so the only way in is this route.
//
// Always answers 200 for a well-formed address, whether or not it was already
// on the list. Reporting "you're already subscribed" would turn this into an
// oracle for whether a given person is on it, and it isn't useful to the
// person typing either.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function POST(request: Request) {
    let email = ""
    try {
        const body = (await request.json()) as { email?: unknown }
        email = typeof body.email === "string" ? body.email.trim() : ""
    } catch {
        return Response.json({ error: "Expected a JSON body." }, { status: 400 })
    }

    if (!EMAIL.test(email) || email.length > 254) {
        return Response.json({ error: "That doesn't look like an email address." }, { status: 400 })
    }
    // Normalised here rather than in the DB, so the unique index can be a
    // plain one on the column and back the upsert below.
    email = email.toLowerCase()

    // Already scoped to the `tracker` schema (see Supabase.service).
    const svc = Supabase.service()
    const { error } = await svc
        .from("newsletter_subscribers")
        .upsert(
            { email, source: "landing-footer", unsubscribed_at: null },
            { onConflict: "email", ignoreDuplicates: false },
        )

    if (error) {
        // Spread rather than log the object: a PostgrestError's fields are
        // non-enumerable, so `console.error(error)` prints an empty {}.
        console.error("newsletter signup failed", error.code, error.message, error.details)
        return Response.json({ error: "Couldn't save that just now. Try again shortly." }, { status: 500 })
    }

    return Response.json({ ok: true })
}
