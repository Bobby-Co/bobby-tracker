import { jsonError, requireUser } from "@/lib/api"
import { canonicalRepoUrl, validateRepoUrl } from "@/lib/integrations/repo-url"
import type { Project, ProjectInsight, ProjectWithInsight } from "@/lib/supabase/types"

// GET — list the current user's projects, newest first. Backs the app
// sidebar and the /projects grid. RLS scopes rows to the signed-in user.
//
// ?stats=1 embeds each project's insight row (0047) so the grid can render its
// tile footers from the same round-trip. The sidebar calls the plain form and
// pays nothing for stats it never shows.
export async function GET(request: Request) {
    const { supabase, error } = await requireUser()
    if (error) return error

    const withStats = new URL(request.url).searchParams.get("stats") === "1"

    const { data, error: dbErr } = await supabase
        .from("projects")
        .select(withStats ? "*, project_insight(*)" : "*")
        .order("updated_at", { ascending: false })
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    if (!withStats) {
        return Response.json({ projects: (data ?? []) as unknown as Project[] })
    }

    // PostgREST returns a one-to-one embed as an object (project_insight.project_id
    // is both PK and FK), but falls back to an array when it can't prove
    // uniqueness — normalise both, same defensive unwrap as app/api/groups/route.ts.
    const projects: ProjectWithInsight[] = (data ?? []).map((row) => {
        const { project_insight, ...project } = row as unknown as Project & {
            project_insight: ProjectInsight | ProjectInsight[] | null
        }
        const insight = Array.isArray(project_insight) ? project_insight[0] ?? null : project_insight ?? null
        return { ...project, insight }
    })
    return Response.json({ projects })
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
    // repo_url is cloned server-side by the analyser — validate against SSRF
    // (internal/loopback hosts) and non-https transports before storing it.
    const repoCheck = validateRepoUrl(repo_url)
    if (!repoCheck.ok) return jsonError("bad_request", repoCheck.message, 400)

    // Trust the picker's owner/repo when it sent one (saves a re-parse
    // and works for repo URLs that the regex below doesn't match, like
    // GitHub Enterprise hosts); otherwise fall back to URL inference.
    const repo_full_name = repo_full_name_from_client ?? inferGithubFullName(repo_url)

    // Canonicalise the URL so trivial variants (…/bar, …/bar.git, …/bar/,
    // www., host case) can't create "different" projects for the same repo.
    const canonical_url = canonicalRepoUrl(repo_url)

    // Reject a repo the user already has. The DB's unique(user_id, repo_url)
    // constraint only catches an EXACT string match, so we also compare by
    // canonical URL and by repo_full_name case-insensitively (a repo's real
    // identity). RLS scopes this select to the caller's own projects.
    const { data: mine } = await supabase.from("projects").select("repo_url,repo_full_name")
    const already = (mine ?? []).some((p) => {
        if (canonicalRepoUrl(p.repo_url).toLowerCase() === canonical_url.toLowerCase()) return true
        if (repo_full_name && p.repo_full_name && p.repo_full_name.toLowerCase() === repo_full_name.toLowerCase()) return true
        return false
    })
    if (already) {
        return jsonError("conflict", "You already have a project for this repository.", 409)
    }

    const { data: project, error: dbErr } = await supabase
        .from("projects")
        .insert({ user_id: user.id, name, repo_url: canonical_url, repo_full_name, description })
        .select("*")
        .single<Project>()
    if (dbErr) {
        // Backstop for the pre-check race — the unique(user_id, repo_url) index.
        if (dbErr.code === "23505") return jsonError("conflict", "You already have a project for this repository.", 409)
        return jsonError("db_error", dbErr.message, 500)
    }
    return Response.json({ project })
}

function inferGithubFullName(url: string): string | null {
    const m = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^\/]+\/[^\/]+?)(?:\.git)?\/?$/)
    return m ? m[1] : null
}
