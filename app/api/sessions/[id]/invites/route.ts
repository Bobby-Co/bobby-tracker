import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"

// GET — list whitelisted emails for a session.
// POST — add one or more emails. Owner-only via RLS on the table.
//
// We don't re-check session ownership in the handler: the underlying
// public_session_invites RLS policy already requires that the session
// belongs to auth.uid(), so a non-owner's insert/select silently
// returns no rows or errors out at the policy.

// Minimal email shape mirror of the DB CHECK constraint. Stricter
// validation would belong in a shared helper if the app gains other
// email-collecting features.
function normalizeEmail(raw: unknown): string | null {
    if (typeof raw !== "string") return null
    const e = raw.trim().toLowerCase()
    if (e.length > 254) return null
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return null
    return e
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireUser()
    if (error) return error

    const { data: invites, error: dbErr } = await repoRead(() => ctx.sessionsAdmin.listInvites(id))
    if (dbErr) return dbErr
    return Response.json({ invites })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireSessionAccess(id, { write: true })
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    // Accept either { email } (singular) or { emails: [] } (bulk paste).
    const raw: unknown[] = Array.isArray(body.emails)
        ? body.emails
        : body.email !== undefined
            ? [body.email]
            : []

    const seen = new Set<string>()
    const invalid: string[] = []
    const emails: string[] = []
    for (const r of raw) {
        const e = normalizeEmail(r)
        if (!e) {
            if (typeof r === "string" && r.trim()) invalid.push(r.trim())
            continue
        }
        if (seen.has(e)) continue
        seen.add(e)
        emails.push(e)
    }
    if (emails.length === 0) {
        return jsonError(
            "bad_request",
            invalid.length
                ? `No valid emails — bad format: ${invalid.slice(0, 3).join(", ")}`
                : "no emails provided",
            400,
        )
    }

    // upsert so re-pasting an existing email is a no-op rather than a
    // 409. ignoreDuplicates skips the conflicting rows entirely.
    const { data, error: dbErr } = await repoRead(() => ctx.sessionsAdmin.addInvites(id, emails))
    if (dbErr) return dbErr

    return Response.json({
        added: data,
        added_count: emails.length,
        invalid,
    })
}
