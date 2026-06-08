import { jsonError, requireUser } from "@/lib/api"
import type { GithubRepoSummary, GithubToken } from "@/lib/supabase/types"

// GET /api/github/repos
//
// Returns the signed-in user's accessible GitHub repositories (owner +
// collaborator + org member, public + private), most-recently-updated
// first. Used by the add-project picker.
//
// The token comes from tracker.github_tokens, which is populated by the
// OAuth callback the first time the user grants the `repo` scope. If
// no row exists (user signed in before we added the scope) or GitHub
// rejects the token (revoked / scope downgraded), we return 401 with a
// dedicated `github_reauth_required` code so the UI can prompt for
// re-consent instead of treating it as a generic auth failure.
//
// We page through GitHub's response up to a soft cap (5 pages × 100 =
// 500 repos) — enough for almost every individual contributor without
// risking long server stalls for users in 50+ orgs.
const PER_PAGE = 100
const MAX_PAGES = 5

interface RawGithubRepo {
    full_name: string
    name: string
    private: boolean
    description: string | null
    default_branch: string | null
    clone_url: string
    html_url: string
    updated_at: string
}

export async function GET() {
    const { supabase, user, error } = await requireUser()
    if (error) return error

    const { data: tokenRow, error: tokErr } = await supabase
        .from("github_tokens")
        .select("access_token,scopes")
        .eq("user_id", user.id)
        .maybeSingle<Pick<GithubToken, "access_token" | "scopes">>()
    if (tokErr) return jsonError("db_error", tokErr.message, 500)
    if (!tokenRow) {
        return jsonError(
            "github_reauth_required",
            "Connect GitHub to list your repositories.",
            401,
        )
    }
    if (tokenRow.scopes && !tokenRow.scopes.split(/[,\s]+/).includes("repo")) {
        return jsonError(
            "github_reauth_required",
            "Re-connect GitHub to grant private-repository access.",
            401,
        )
    }

    const repos: GithubRepoSummary[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
        const url = new URL("https://api.github.com/user/repos")
        url.searchParams.set("per_page", String(PER_PAGE))
        url.searchParams.set("page", String(page))
        url.searchParams.set("sort", "updated")
        url.searchParams.set("affiliation", "owner,collaborator,organization_member")

        const resp = await fetch(url, {
            headers: {
                Authorization: `Bearer ${tokenRow.access_token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            // Don't let Next.js cache repo lists across users.
            cache: "no-store",
        })
        if (resp.status === 401 || resp.status === 403) {
            return jsonError(
                "github_reauth_required",
                "GitHub rejected the stored token. Reconnect to continue.",
                401,
            )
        }
        if (!resp.ok) {
            const detail = await resp.text().catch(() => "")
            return jsonError("github_error", `GitHub ${resp.status}: ${detail.slice(0, 200)}`, 502)
        }
        const page_repos = (await resp.json()) as RawGithubRepo[]
        for (const r of page_repos) {
            repos.push({
                full_name: r.full_name,
                name: r.name,
                private: r.private,
                description: r.description,
                default_branch: r.default_branch ?? "main",
                clone_url: r.clone_url,
                html_url: r.html_url,
                updated_at: r.updated_at,
            })
        }
        if (page_repos.length < PER_PAGE) break
    }

    return Response.json({ repos, truncated: repos.length >= MAX_PAGES * PER_PAGE })
}
