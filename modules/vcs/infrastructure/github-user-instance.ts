// VCS module — the GitHub adapter for the VCSUserInstance port (user authority).
// Bound to one repo + the signed-in user's personal token, it posts/edits/deletes
// comments AS THE USER. The user-token fetch + comment DTO mapping are private
// methods; an auth failure surfaces as the neutral VcsReauthError so callers
// never see a GitHub-specific error.
//
// Comments go to /repos/{o}/{r}/issues/{n}/comments, which serves both issues and
// PRs (a PR is an issue for the comments API). Workers' fetch omits User-Agent
// and GitHub 403s without one, so we set it on every call.

import type { VCSUserInstance } from "../ports/vcs-user-instance"
import { VcsReauthError, type VcsComment } from "../ports/vcs-types"

const GITHUB_API = "https://api.github.com"
const USER_AGENT = "ucelot-tracker"

/** The GitHub VCSUserInstance — bound to one repo + the user's token. Construct
 *  via the composition root (resolveVcsUserInstance); callers depend on the port. */
export class GithubUserInstance implements VCSUserInstance {
    constructor(
        private readonly token: string,
        private readonly owner: string,
        private readonly repo: string,
    ) {}

    async createComment(issueNumber: number, body: string): Promise<VcsComment> {
        const res = await this.fetch(`/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`, {
            method: "POST",
            body: JSON.stringify({ body }),
        })
        return this.readComment(res, "create comment")
    }

    async updateComment(commentId: number, body: string): Promise<VcsComment> {
        const res = await this.fetch(`/repos/${this.owner}/${this.repo}/issues/comments/${commentId}`, {
            method: "PATCH",
            body: JSON.stringify({ body }),
        })
        return this.readComment(res, "update comment")
    }

    async deleteComment(commentId: number): Promise<void> {
        const res = await this.fetch(`/repos/${this.owner}/${this.repo}/issues/comments/${commentId}`, { method: "DELETE" })
        if (res.status === 401 || res.status === 403) throw new VcsReauthError()
        // 404 = already deleted on GitHub — idempotent success.
        if (!res.ok && res.status !== 404) {
            const detail = await res.text().catch(() => "")
            throw new Error(`github: delete comment failed (${res.status}): ${detail.slice(0, 300)}`)
        }
    }

    private fetch(path: string, init: RequestInit = {}): Promise<Response> {
        return fetch(path.startsWith("http") ? path : `${GITHUB_API}${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${this.token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": USER_AGENT,
                ...(init.headers as Record<string, string>),
            },
            cache: "no-store",
        })
    }

    // Parse a comment response into the neutral VcsComment. A 401/403 means the
    // user's token is missing/insufficient/rejected → VcsReauthError.
    private async readComment(res: Response, action: string): Promise<VcsComment> {
        if (res.status === 401 || res.status === 403) throw new VcsReauthError()
        if (!res.ok) {
            const detail = await res.text().catch(() => "")
            throw new Error(`github: ${action} failed (${res.status}): ${detail.slice(0, 300)}`)
        }
        const b = (await res.json()) as {
            id: number
            html_url: string
            body?: string | null
            created_at: string
            updated_at: string
            user?: { login: string; avatar_url: string } | null
        }
        return {
            id: b.id,
            body: b.body ?? "",
            url: b.html_url,
            author: b.user ? { login: b.user.login, avatarUrl: b.user.avatar_url } : null,
            createdAt: b.created_at,
            updatedAt: b.updated_at,
        }
    }
}
