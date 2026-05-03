import { randomBytes } from "node:crypto"
import { jsonError, requireUser } from "@/lib/api"
import type { PublicSession } from "@/lib/supabase/types"

// GET    — list sessions owned by the current user (newest first)
// POST   — create a new session, optionally with an initial project list

function newToken() {
    return randomBytes(24).toString("base64url")
}

function parseWindow(v: unknown): string | null | undefined {
    if (v === undefined) return undefined
    if (v === null || v === "") return null
    if (typeof v !== "string") return undefined
    const t = Date.parse(v)
    if (Number.isNaN(t)) return undefined
    return new Date(t).toISOString()
}

export async function GET() {
    const { supabase, error } = await requireUser()
    if (error) return error
    const { data, error: dbErr } = await supabase
        .from("public_sessions")
        .select("*")
        .order("updated_at", { ascending: false })
        .returns<PublicSession[]>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ sessions: data ?? [] })
}

export async function POST(request: Request) {
    const { supabase, user, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* allow empty */ }

    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) return jsonError("bad_request", "name required", 400)

    const title = typeof body.title === "string" ? body.title.trim() || null : null
    const description = typeof body.description === "string" ? body.description.trim() || null : null
    const start_at = parseWindow(body.start_at) ?? null
    const end_at = parseWindow(body.end_at) ?? null
    if (start_at && end_at && Date.parse(start_at) >= Date.parse(end_at)) {
        return jsonError("bad_request", "start_at must be before end_at", 400)
    }

    const access_mode = body.access_mode === "invite" ? "invite" : "link"
    const submissions_visibility = body.submissions_visibility === "own" ? "own" : "all"

    const projectIdsIn = Array.isArray(body.project_ids)
        ? body.project_ids.filter((x: unknown): x is string => typeof x === "string")
        : []

    const { data: session, error: insErr } = await supabase
        .from("public_sessions")
        .insert({
            user_id: user.id,
            token: newToken(),
            enabled: true,
            access_mode,
            submissions_visibility,
            name, title, description, start_at, end_at,
        })
        .select("*")
        .single<PublicSession>()
    if (insErr) return jsonError("db_error", insErr.message, 500)

    if (projectIdsIn.length > 0) {
        const { error: linkErr } = await supabase
            .from("public_session_projects")
            .insert(projectIdsIn.map((project_id) => ({ session_id: session.id, project_id })))
        if (linkErr) {
            // Trigger raises 23514 if any project doesn't have the
            // integration enabled. Surface that distinctly so the UI
            // can route the user to enable it.
            if (linkErr.code === "23514") {
                return jsonError(
                    "integration_disabled",
                    "Enable the public submissions integration on each selected project first.",
                    409,
                )
            }
            return jsonError("db_error", linkErr.message, 500)
        }
    }

    return Response.json({ session })
}
