import { jsonError, requireUser } from "@/lib/api"
import type { Project } from "@/lib/supabase/types"

// GET — list the current user's projects, newest first. Backs the app
// sidebar and the /projects grid. RLS scopes rows to the signed-in user.
export async function GET() {
    const { supabase, error } = await requireUser()
    if (error) return error
    const { data, error: dbErr } = await supabase
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false })
        .returns<Project[]>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ projects: data ?? [] })
}

export async function POST(request: Request) {
    const { supabase, user, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const name = String(body?.name ?? "").trim()
    const repo_url = String(body?.repo_url ?? "").trim()
    const description = body?.description ? String(body.description) : null
    const repo_full_name_from_client =
        typeof body?.repo_full_name === "string" && body.repo_full_name
            ? String(body.repo_full_name).trim()
            : null

    if (!name) return jsonError("bad_request", "name is required", 400)
    if (!/^https?:\/\//.test(repo_url)) return jsonError("bad_request", "repo_url must be https://", 400)

    // Trust the picker's owner/repo when it sent one (saves a re-parse
    // and works for repo URLs that the regex below doesn't match, like
    // GitHub Enterprise hosts); otherwise fall back to URL inference.
    const repo_full_name = repo_full_name_from_client ?? inferGithubFullName(repo_url)

    const { data: project, error: dbErr } = await supabase
        .from("projects")
        .insert({ user_id: user.id, name, repo_url, repo_full_name, description })
        .select("*")
        .single<Project>()
    if (dbErr) {
        if (dbErr.code === "23505") return jsonError("conflict", "you already have a project with this repo URL", 409)
        return jsonError("db_error", dbErr.message, 500)
    }
    return Response.json({ project })
}

function inferGithubFullName(url: string): string | null {
    const m = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^\/]+\/[^\/]+?)(?:\.git)?\/?$/)
    return m ? m[1] : null
}
