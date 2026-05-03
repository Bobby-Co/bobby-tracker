import { jsonError } from "@/lib/api"
import { createServiceClient } from "@/lib/supabase/server"
import { ISSUE_PRIORITIES, type Issue, type IssuePriority, type Project } from "@/lib/supabase/types"
import { PUBLIC_ISSUE_LABEL, requireInviteAccess, resolvePublicSession } from "@/lib/public-session"

// Anonymous issue submission. The caller proves authority with the
// session token (no Supabase auth). We resolve the token through the
// service role, then insert the issue under the project owner's
// user_id so existing owner-only RLS keeps reads locked to the owner.
//
// We deliberately skip the analyser-readiness gate that POST /api/issues
// enforces: a public submitter has no way to bootstrap the graph and we
// don't want their report dropped on the floor. The owner can always
// triage it later once the graph is ready. Inference itself is
// triggered separately via /api/public-issues/[id]/suggest, which the
// public detail page auto-fires on mount.
export async function POST(request: Request) {
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const token = String(body?.token ?? "").trim()
    const title = String(body?.title ?? "").trim()
    const project_id = String(body?.project_id ?? "").trim()
    if (!title) return jsonError("bad_request", "title required", 400)
    if (!project_id) return jsonError("bad_request", "project_id required", 400)

    const svc = createServiceClient()
    const { session, error } = await resolvePublicSession(svc, token, { requireOpen: true })
    if (error) return error

    const inviteErr = await requireInviteAccess(session)
    if (inviteErr) return inviteErr

    if (!session.project_ids.includes(project_id)) {
        return jsonError("bad_request", "this project isn't part of the session", 400)
    }

    const { data: project } = await svc
        .from("projects")
        .select("id,user_id")
        .eq("id", project_id)
        .maybeSingle<Pick<Project, "id" | "user_id">>()
    if (!project) return jsonError("not_found", "project missing", 404)

    const rawPriority = typeof body?.priority === "string" ? body.priority : ""
    const priority: IssuePriority = (ISSUE_PRIORITIES as readonly string[]).includes(rawPriority)
        ? (rawPriority as IssuePriority)
        : "medium"

    const reporter = typeof body?.reporter === "string" ? body.reporter.trim().slice(0, 80) : ""
    const reporterId = typeof body?.reporter_id === "string" ? body.reporter_id.trim().slice(0, 64) : ""
    const userBody = typeof body?.body === "string" ? body.body : ""
    const stamp = reporter
        ? `> Submitted via public link by **${reporter.replace(/[\r\n]+/g, " ")}**\n\n`
        : `> Submitted via public link\n\n`
    const finalBody = stamp + userBody

    const { data: issue, error: dbErr } = await svc
        .from("issues")
        .insert({
            project_id: project.id,
            user_id: project.user_id,
            title,
            body: finalBody,
            priority,
            labels: [PUBLIC_ISSUE_LABEL],
        })
        .select("id,issue_number,title,created_at")
        .single<Pick<Issue, "id" | "issue_number" | "title" | "created_at">>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    // Reporter identity goes into its own table so the issues row
    // stays clean. Best-effort — failure here doesn't undo the issue
    // (the markdown body still carries the attribution stamp).
    if (reporterId || reporter) {
        await svc
            .from("public_issue_reporters")
            .insert({
                issue_id: issue.id,
                reporter_id: reporterId || null,
                reporter_name: reporter || null,
                session_id: session.id,
            })
    }

    // Best-effort counter bump (fetch-then-write race is fine here — this
    // is a display-only stat, not a uniqueness constraint).
    const { data: cur } = await svc
        .from("public_sessions")
        .select("submission_count")
        .eq("id", session.id)
        .maybeSingle<{ submission_count: number }>()
    if (cur) {
        await svc
            .from("public_sessions")
            .update({ submission_count: cur.submission_count + 1 })
            .eq("id", session.id)
    }

    return Response.json({
        ok: true,
        issue: {
            id: issue.id,
            issue_number: issue.issue_number,
            title: issue.title,
            created_at: issue.created_at,
        },
    })
}
