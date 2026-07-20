// Post/edit/delete GitHub comments AS THE SIGNED-IN USER (not the Bobby App).
// Reuses the personal OAuth token captured at sign-in (tracker.github_tokens,
// migration 0031) — the same token + `repo`-scope gate that /api/github/repos
// uses. Comments go to /repos/{o}/{r}/issues/{n}/comments, which serves both
// issues and PRs (a PR is an issue for the comments API).
//
// Workers' fetch omits User-Agent and GitHub 403s without one, so we set it on
// every call (see the workers-fetch-user-agent memory).

import type { createClient } from "@/lib/supabase/server"
import type { GithubToken } from "@/lib/supabase/types"

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

const GITHUB_API = "https://api.github.com"
const USER_AGENT = "ucelot-tracker"

// Thrown when the user's token is missing/insufficient/rejected — the route
// turns this into a `github_reauth_required` 401 so the UI can prompt reconnect.
export class GithubReauthError extends Error {
    constructor() {
        super("github reauth required")
        this.name = "GithubReauthError"
    }
}

export type UserGithub = { token: string; login: string | null }

// getUserGithubToken returns the user's personal token + login, or null when they
// haven't connected GitHub with the `repo` scope (same policy as the repos route).
export async function getUserGithubToken(
    supabase: SupabaseServer,
    userId: string,
): Promise<UserGithub | null> {
    const { data } = await supabase
        .from("github_tokens")
        .select("access_token,scopes,provider_login")
        .eq("user_id", userId)
        .maybeSingle<Pick<GithubToken, "access_token" | "scopes" | "provider_login">>()
    if (!data?.access_token) return null
    if (data.scopes && !data.scopes.split(/[,\s]+/).includes("repo")) return null
    return { token: data.access_token, login: data.provider_login ?? null }
}

async function githubUserFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(path.startsWith("http") ? path : `${GITHUB_API}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": USER_AGENT,
            ...(init.headers as Record<string, string>),
        },
        cache: "no-store",
    })
}

export type GithubUserComment = {
    id: number
    html_url: string
    body: string
    created_at: string
    updated_at: string
    user: { login: string; avatar_url: string } | null
}

async function readComment(res: Response, action: string): Promise<GithubUserComment> {
    if (res.status === 401 || res.status === 403) throw new GithubReauthError()
    if (!res.ok) {
        const detail = await res.text().catch(() => "")
        throw new Error(`github: ${action} failed (${res.status}): ${detail.slice(0, 300)}`)
    }
    const b = (await res.json()) as {
        id: number
        html_url: string
        body?: string
        created_at: string
        updated_at: string
        user?: { login: string; avatar_url: string } | null
    }
    return {
        id: b.id,
        html_url: b.html_url,
        body: b.body ?? "",
        created_at: b.created_at,
        updated_at: b.updated_at,
        user: b.user ? { login: b.user.login, avatar_url: b.user.avatar_url } : null,
    }
}

export async function createUserIssueComment(
    token: string,
    owner: string,
    repo: string,
    number: number,
    body: string,
): Promise<GithubUserComment> {
    const res = await githubUserFetch(token, `/repos/${owner}/${repo}/issues/${number}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
    })
    return readComment(res, "create comment")
}

export async function updateUserIssueComment(
    token: string,
    owner: string,
    repo: string,
    commentId: number,
    body: string,
): Promise<GithubUserComment> {
    const res = await githubUserFetch(token, `/repos/${owner}/${repo}/issues/comments/${commentId}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
    })
    return readComment(res, "update comment")
}

export async function deleteUserIssueComment(
    token: string,
    owner: string,
    repo: string,
    commentId: number,
): Promise<void> {
    const res = await githubUserFetch(token, `/repos/${owner}/${repo}/issues/comments/${commentId}`, {
        method: "DELETE",
    })
    if (res.status === 401 || res.status === 403) throw new GithubReauthError()
    // 404 = already deleted on GitHub — idempotent success.
    if (!res.ok && res.status !== 404) {
        const detail = await res.text().catch(() => "")
        throw new Error(`github: delete comment failed (${res.status}): ${detail.slice(0, 300)}`)
    }
}
