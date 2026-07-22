import { ApiContext, jsonError } from "@/lib/server/http/api"
import { Supabase } from "@/lib/server/supabase"
import { githubAppClient } from "@/modules/vcs"
import { RepoRef } from "@/modules/vcs"
import type { Project } from "@/lib/shared/types"

// POST /api/projects/[id]/github-sync/link — link an ALREADY-installed GitHub
// App to this project without the install redirect. Resolves the installation
// that covers the project's repo (GET /repos/{owner}/{repo}/installation, app
// JWT), records it, sets github_installation_id + numeric github_repo_id, and
// flips sync on. Returns {installed:false} when the app isn't on the repo yet
// so the client can send the user to the install flow instead.
//
// More robust (and safer) than trusting the callback's installation_id: the
// installation is derived from the project's own repo, not a user-supplied id.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, user, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    try {
    // RLS-scoped: caller must own the project.
    const { data: project } = await supabase
        .from("projects")
        .select("id,repo_url,repo_full_name")
        .eq("id", id)
        .single<Pick<Project, "id" | "repo_url" | "repo_full_name">>()
    if (!project) return jsonError("not_found", "project not found", 404)

    const full = RepoRef.of(project).fullName()
    if (!full) return jsonError("bad_request", "project has no GitHub repo", 400)
    const [owner, repo] = full.split("/")

    // Which installation covers this repo? 404 → app not installed on it yet.
    const instRes = await githubAppClient.jwtFetch(`/repos/${owner}/${repo}/installation`)
    if (instRes.status === 404) {
        return Response.json({ installed: false })
    }
    if (!instRes.ok) {
        const detail = await instRes.text().catch(() => "")
        return jsonError("github_error", `resolve installation failed (${instRes.status}): ${detail.slice(0, 200)}`, 502)
    }
    const inst = (await instRes.json().catch(() => null)) as {
        id?: number
        account?: { login?: string; type?: string; id?: number }
    } | null
    const installationId = inst?.id
    if (!installationId) return jsonError("github_error", "installation id missing", 502)

    // Record the installation, bound to this user (service-role: writes to
    // github_installations are service-role only).
    const svc = Supabase.service()
    const { error: instErr } = await svc.from("github_installations").upsert(
        {
            installation_id: installationId,
            user_id: user.id,
            account_login: inst?.account?.login ?? null,
            account_type: inst?.account?.type ?? null,
            account_id: inst?.account?.id ?? null,
            suspended_at: null,
            deleted_at: null,
        },
        { onConflict: "installation_id" },
    )
    if (instErr) return jsonError("db_error", instErr.message, 500)

    // Resolve the repo's stable numeric id (the inbound-webhook join key).
    const repoRes = await githubAppClient.fetch(installationId, `/repos/${owner}/${repo}`)
    if (!repoRes.ok) return jsonError("github_error", `resolve repo failed (${repoRes.status})`, 502)
    const repoObj = (await repoRes.json().catch(() => null)) as { id?: number } | null
    if (!repoObj?.id) return jsonError("github_error", "repo id missing", 502)

    // Link + enable sync (cookie client → RLS confirms ownership).
    const { data: updated, error: upErr } = await supabase
        .from("projects")
        .update({
            github_installation_id: installationId,
            github_repo_id: repoObj.id,
            github_sync_enabled: true,
        })
        .eq("id", id)
        .select("id,github_installation_id,github_repo_id,github_sync_enabled")
        .single<Pick<Project, "id" | "github_installation_id" | "github_repo_id" | "github_sync_enabled">>()
    if (upErr) return jsonError("db_error", upErr.message, 500)

    return Response.json({ installed: true, linked: true, project: updated })
    } catch (err) {
        // Surface the real cause (e.g. a bad GITHUB_APP_PRIVATE_KEY throwing a
        // Web Crypto DOMException — which is not always instanceof Error) as
        // clean JSON instead of a 500 crash. Reading .message is safe even when
        // it's a getter; only *setting* it throws.
        const e = err as { name?: string; message?: string }
        const msg = e?.message ? `${e.name ?? "Error"}: ${e.message}` : String(err)
        return jsonError("link_failed", msg, 500)
    }
}
