import { ApiContext, jsonError } from "@/lib/server/http/api"

// GET /api/gitlab/repos
//
// The signed-in user's GitLab projects across EVERY connected instance
// (gitlab.com via OAuth + any self-managed instances via PAT — provider_tokens,
// migration 0055). Backs the unified add-project picker alongside
// /api/github/repos. Per-instance failures (an expired OAuth token, an
// unreachable host) don't fail the whole call — they come back in `errors` so
// the picker can still show the sources that worked.

const USER_AGENT = "ucelot-tracker"
const PER_PAGE = 100
const MAX_PAGES = 5

export interface GitlabRepoSummary {
    provider: "gitlab"
    host: string
    external_id: number
    full_name: string
    name: string
    description: string | null
    private: boolean
    html_url: string
    clone_url: string
    default_branch: string
}

interface RawGitlabProject {
    id: number
    name: string
    path: string
    path_with_namespace: string
    description: string | null
    visibility: string
    web_url: string
    http_url_to_repo: string
    default_branch: string | null
}

export async function GET() {
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    let conns
    try {
        conns = await ctx.providerTokens.all(user.id)
    } catch (e) {
        return jsonError("db_error", (e as Error).message, 500)
    }

    const repos: GitlabRepoSummary[] = []
    const errors: { host: string; reason: string }[] = []

    for (const c of conns) {
        const apiBase = c.apiBase ?? `https://${c.host}/api/v4`
        try {
            for (let page = 1; page <= MAX_PAGES; page++) {
                const url = new URL(`${apiBase}/projects`)
                url.searchParams.set("membership", "true")
                url.searchParams.set("order_by", "last_activity_at")
                url.searchParams.set("per_page", String(PER_PAGE))
                url.searchParams.set("page", String(page))

                const res = await fetch(url, {
                    headers: { Authorization: `Bearer ${c.accessToken}`, "User-Agent": USER_AGENT },
                    cache: "no-store",
                })
                if (res.status === 401 || res.status === 403) {
                    // Expired OAuth token (gitlab.com can't be refreshed here — the
                    // OAuth secret lives in Supabase) or a revoked PAT: prompt reconnect.
                    errors.push({ host: c.host, reason: "reauth" })
                    break
                }
                if (!res.ok) {
                    errors.push({ host: c.host, reason: `http_${res.status}` })
                    break
                }
                const items = (await res.json().catch(() => [])) as RawGitlabProject[]
                if (!Array.isArray(items) || items.length === 0) break
                for (const p of items) {
                    repos.push({
                        provider: "gitlab",
                        host: c.host,
                        external_id: p.id,
                        full_name: p.path_with_namespace,
                        name: p.path ?? p.name,
                        description: p.description,
                        private: p.visibility !== "public",
                        html_url: p.web_url,
                        clone_url: p.http_url_to_repo,
                        default_branch: p.default_branch ?? "main",
                    })
                }
                if (items.length < PER_PAGE) break
            }
        } catch (e) {
            errors.push({ host: c.host, reason: (e as Error).message })
        }
    }

    return Response.json({ repos, errors })
}
