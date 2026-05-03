import { jsonError } from "@/lib/api"
import { createServiceClient } from "@/lib/supabase/server"
import { ISSUE_PRIORITIES, type Issue, type IssuePriority, type Project } from "@/lib/supabase/types"
import { PUBLIC_ISSUE_LABEL, resolvePublicSession } from "@/lib/public-session"

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
    if (!title) return jsonError("bad_request", "title required", 400)

    const svc = createServiceClient()
    const { session, error } = await resolvePublicSession(svc, token, { requireOpen: true })
    if (error) return error

    const { data: project } = await svc
        .from("projects")
        .select("id,user_id")
        .eq("id", session.project_id)
        .maybeSingle<Pick<Project, "id" | "user_id">>()
    if (!project) return jsonError("not_found", "project missing", 404)

    const rawPriority = typeof body?.priority === "string" ? body.priority : ""
    const priority: IssuePriority = (ISSUE_PRIORITIES as readonly string[]).includes(rawPriority)
        ? (rawPriority as IssuePriority)
        : "medium"

    const reporter = typeof body?.reporter === "string" ? body.reporter.trim().slice(0, 80) : ""
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

    // Best-effort counter bump (fetch-then-write race is fine here — this
    // is a display-only stat, not a uniqueness constraint).
    const { data: cur } = await svc
        .from("project_public_sessions")
        .select("submission_count")
        .eq("project_id", project.id)
        .maybeSingle<{ submission_count: number }>()
    if (cur) {
        await svc
            .from("project_public_sessions")
            .update({ submission_count: cur.submission_count + 1 })
            .eq("project_id", project.id)
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
