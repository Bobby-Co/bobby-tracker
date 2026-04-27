import { jsonError, requireUser } from "@/lib/api"
import type { Project } from "@/lib/supabase/types"

export async function POST(request: Request) {
    const { supabase, user, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const name = String(body?.name ?? "").trim()
    const repo_url = String(body?.repo_url ?? "").trim()
    const description = body?.description ? String(body.description) : null

    if (!name) return jsonError("bad_request", "name is required", 400)
    if (!/^https?:\/\//.test(repo_url)) return jsonError("bad_request", "repo_url must be https://", 400)

    const repo_full_name = inferGithubFullName(repo_url)

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
