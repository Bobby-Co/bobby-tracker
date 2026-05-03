import { jsonError } from "@/lib/api"
import { createServiceClient } from "@/lib/supabase/server"
import { ISSUE_PRIORITIES } from "@/lib/supabase/types"
import type { Issue, IssuePriority, Project, ProjectPublicSession } from "@/lib/supabase/types"

// Anonymous issue submission. The caller proves authority with the
// session token (no Supabase auth). We resolve the token through the
// service role, then insert the issue under the project owner's
// user_id so existing owner-only RLS keeps reads locked to the owner.
//
// We deliberately skip the analyser-readiness gate that POST /api/issues
// enforces: a public submitter has no way to bootstrap the graph and we
// don't want their report dropped on the floor. The owner can always
// triage it later once the graph is ready.
export async function POST(request: Request) {
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const token = String(body?.token ?? "").trim()
    const title = String(body?.title ?? "").trim()
    if (!token) return jsonError("bad_request", "token required", 400)
    if (!title) return jsonError("bad_request", "title required", 400)

    const svc = createServiceClient()

    const { data: session } = await svc
        .from("project_public_sessions")
        .select("project_id,enabled")
        .eq("token", token)
        .maybeSingle<Pick<ProjectPublicSession, "project_id" | "enabled">>()
    if (!session || !session.enabled) {
        return jsonError("not_found", "this submission link is inactive or invalid", 404)
    }

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
    // Stamp who submitted it (best-effort — purely informational, the
    // value is whatever the submitter typed). The owner sees this as
    // a quoted prefix on the issue body.
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
            labels: ["public-session"],
        })
        .select("id,issue_number")
        .single<Pick<Issue, "id" | "issue_number">>()
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

    return Response.json({ ok: true, issue_number: issue.issue_number })
}
