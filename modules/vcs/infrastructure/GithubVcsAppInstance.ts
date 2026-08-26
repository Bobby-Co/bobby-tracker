// VCS module — the GitHub adapters for the app/bot authority. Two classes, no
// module-level functions:
//   • GithubAppClient   — the GitHub App HTTP transport: JWT minting, installation
//                         -token cache, the choke-point fetch. Shared singleton;
//                         also used by the install/link flow.
//   • GithubVcsAppInstance — implements VcsAppInstance for one bound repo. Its REST/
//                         GraphQL calls + GitHub⇄neutral mapping are private
//                         methods over the client. Construct via the composition
//                         root (resolveVcsAppInstance); callers depend on the port.

import { Supabase } from "@/lib/server/supabase"
import type { VcsAppInstance } from "../ports/VcsAppInstance"
import {
    VcsMergeError,
    type VcsActor,
    type VcsComment,
    type VcsIssue,
    type VcsMergeInput,
    type VcsMergeMethods,
    type VcsMergeResult,
    type VcsMergeability,
    type VcsPullRequest,
    type VcsPullRequestFile,
    type VcsCompare,
    type VcsCommitSummary,
    type VcsCompareStatus,
    type VcsReview,
    type VcsBranch,
} from "../ports/VcsTypes"

const GITHUB_API = "https://api.github.com"
const USER_AGENT = "ucelot-tracker"

// ── private GitHub wire shapes (types only) ──────────────────────────────────
interface GithubActor {
    login: string
    avatar_url: string
}
interface GithubPullRequest {
    number: number
    node_id: string
    title: string
    body: string | null
    state: string
    draft?: boolean
    merged_at: string | null
    html_url: string
    user: GithubActor | null
    head: { ref: string; sha: string }
    base: { ref: string; sha: string }
    additions?: number
    deletions?: number
    changed_files?: number
    comments?: number
    created_at: string
    updated_at: string
    closed_at: string | null
}
interface GithubComment {
    id: number
    body: string | null
    html_url: string
    user: GithubActor | null
    created_at: string
    updated_at: string
}
interface GithubReview {
    id: number
    body: string | null
    html_url: string
    user: GithubActor | null
    state: string
    submitted_at: string | null
}

/** The GitHub App HTTP transport. `fetch` attaches an installation token (cached
 *  in tracker.github_installations, re-minted once on a 401); `jwtFetch` uses the
 *  app JWT for pre-installation calls. All JWT/token/crypto work is private. */
export class GithubAppClient {
    private appKeyPromise: Promise<CryptoKey> | null = null
    private readonly inflightTokens = new Map<number, Promise<string>>()

    /** Installation-scoped REST/GraphQL call (attaches the installation token). */
    async fetch(installationId: number, path: string, init: RequestInit = {}): Promise<Response> {
        const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`
        const send = (token: string): Promise<Response> =>
            fetch(url, { ...init, headers: { ...this.headers(token), ...(init.headers as Record<string, string>) }, cache: "no-store" })
        let res = await send(await this.getInstallationToken(installationId))
        if (res.status === 401) {
            await this.evictInstallationToken(installationId)
            res = await send(await this.getInstallationToken(installationId))
        }
        return res
    }

    /** An APP-level call authenticated with the app JWT (no installation token) —
     *  used to resolve which installation covers a repo. */
    async jwtFetch(path: string, init: RequestInit = {}): Promise<Response> {
        const jwt = await this.mintAppJwt()
        const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`
        return fetch(url, {
            ...init,
            headers: {
                Authorization: `Bearer ${jwt}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": USER_AGENT,
                ...(init.headers as Record<string, string>),
            },
            cache: "no-store",
        })
    }

    private headers(token: string): Record<string, string> {
        return {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": USER_AGENT,
        }
    }

    // Cached in tracker.github_installations with a 5-min safety margin.
    private async getInstallationToken(installationId: number): Promise<string> {
        const existing = this.inflightTokens.get(installationId)
        if (existing) return existing
        const p = (async () => {
            const svc = Supabase.service()
            const { data: row } = await svc
                .from("github_installations")
                .select("cached_token,token_expires_at")
                .eq("installation_id", installationId)
                .maybeSingle<{ cached_token: string | null; token_expires_at: string | null }>()
            const marginMs = 5 * 60 * 1000
            if (row?.cached_token && row.token_expires_at) {
                const expMs = Date.parse(row.token_expires_at)
                if (Number.isFinite(expMs) && expMs - Date.now() > marginMs) return row.cached_token
            }
            const { token, expiresAt } = await this.mintInstallationToken(installationId)
            await svc
                .from("github_installations")
                .update({ cached_token: token, token_expires_at: expiresAt })
                .eq("installation_id", installationId)
            return token
        })()
        this.inflightTokens.set(installationId, p)
        try {
            return await p
        } finally {
            this.inflightTokens.delete(installationId)
        }
    }

    private async mintInstallationToken(installationId: number): Promise<{ token: string; expiresAt: string }> {
        const jwt = await this.mintAppJwt()
        const res = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${jwt}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": USER_AGENT,
            },
        })
        if (!res.ok) {
            const detail = await res.text().catch(() => "")
            throw new Error(`github: mint installation token failed (${res.status}): ${detail.slice(0, 300)}`)
        }
        const body = (await res.json()) as { token: string; expires_at: string }
        return { token: body.token, expiresAt: body.expires_at }
    }

    private async evictInstallationToken(installationId: number): Promise<void> {
        this.inflightTokens.delete(installationId)
        const svc = Supabase.service()
        await svc
            .from("github_installations")
            .update({ cached_token: null, token_expires_at: null })
            .eq("installation_id", installationId)
    }

    // Short-lived RS256 app JWT (GitHub caps exp at 10 min; iat backdated 60s).
    private async mintAppJwt(): Promise<string> {
        const appId = process.env.GITHUB_APP_ID
        if (!appId) throw new Error("GITHUB_APP_ID is not set")
        const now = Math.floor(Date.now() / 1000)
        const header = { alg: "RS256", typ: "JWT" }
        const claims = { iat: now - 60, exp: now + 600, iss: appId }
        const signingInput = `${this.b64url(JSON.stringify(header))}.${this.b64url(JSON.stringify(claims))}`
        const key = await this.importAppPrivateKey()
        const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)))
        return `${signingInput}.${this.bytesToB64url(sig)}`
    }

    private importAppPrivateKey(): Promise<CryptoKey> {
        if (this.appKeyPromise) return this.appKeyPromise
        this.appKeyPromise = (async () => {
            const raw = process.env.GITHUB_APP_PRIVATE_KEY
            if (!raw) throw new Error("GITHUB_APP_PRIVATE_KEY is not set")
            const pem = raw.includes("BEGIN") ? raw : new TextDecoder().decode(this.b64ToBytes(raw.trim()))
            const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(pem)
            const der = this.b64ToBytes(
                pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, ""),
            )
            const keyData = isPkcs1 ? this.pkcs1ToPkcs8(der) : der
            return crypto.subtle.importKey("pkcs8", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"])
        })().catch((e) => {
            this.appKeyPromise = null
            throw e
        })
        return this.appKeyPromise
    }

    // ── crypto/encoding helpers ──
    private b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
        const bin = atob(b64)
        const out = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
        return out
    }
    private bytesToB64url(bytes: Uint8Array): string {
        let bin = ""
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    }
    private b64url(s: string): string {
        return this.bytesToB64url(new TextEncoder().encode(s))
    }
    private derLen(n: number): number[] {
        if (n < 0x80) return [n]
        const out: number[] = []
        let v = n
        while (v > 0) {
            out.unshift(v & 0xff)
            v >>= 8
        }
        return [0x80 | out.length, ...out]
    }
    // GitHub App keys ship PKCS#1 ("BEGIN RSA PRIVATE KEY"); Web Crypto needs PKCS#8.
    private pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
        const rsaAlgId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
        const version = [0x02, 0x01, 0x00]
        const pk = Array.from(pkcs1)
        const octet = [0x04, ...this.derLen(pk.length), ...pk]
        const body = [...version, ...rsaAlgId, ...octet]
        return new Uint8Array([0x30, ...this.derLen(body.length), ...body])
    }
}

/** Shared transport singleton — the token/JWT caches are per-instance, so one
 *  instance keeps the whole app on one cache. */
export const githubAppClient = new GithubAppClient()

/** The GitHub VcsAppInstance — bound to one repo + installation. Every REST/
 *  GraphQL call and GitHub⇄neutral mapping is a private method over the client. */
export class GithubVcsAppInstance implements VcsAppInstance {
    constructor(
        private readonly installationId: number,
        private readonly owner: string,
        private readonly repo: string,
        private readonly client: GithubAppClient = githubAppClient,
    ) {}

    // ── port: issues ─────────────────────────────────────────────────────────
    async createIssue(input: { title: string; body?: string }): Promise<{ number: number; nodeId: string }> {
        const res = await this.client.fetch(this.installationId, this.path("/issues"), {
            method: "POST",
            body: JSON.stringify({ title: input.title, body: input.body ?? "" }),
        })
        if (!res.ok) return this.fail(res, "create issue")
        const b = (await res.json()) as { number: number; node_id: string }
        return { number: b.number, nodeId: b.node_id }
    }

    async updateIssue(number: number, patch: { title?: string; body?: string; state?: "open" | "closed" }): Promise<void> {
        const res = await this.client.fetch(this.installationId, this.path(`/issues/${number}`), {
            method: "PATCH",
            body: JSON.stringify(patch),
        })
        if (!res.ok) await this.fail(res, "update issue")
    }

    async deleteIssue(ref: { number: number | null; nodeId: string | null }): Promise<void> {
        // GitHub can't hard-delete over REST. Prefer GraphQL deleteIssue (needs the
        // node id); if the org/app can't hard-delete, fall back to closing.
        if (ref.nodeId && (await this.graphqlDeleteIssue(ref.nodeId))) return
        if (ref.number != null) await this.updateIssue(ref.number, { state: "closed" }).catch(() => {})
    }

    async listIssues(opts?: { state?: "open" | "closed" | "all" }): Promise<VcsIssue[]> {
        const state = opts?.state ?? "all"
        const out: VcsIssue[] = []
        for (let page = 1; page <= 10; page++) {
            const res = await this.client.fetch(this.installationId, this.path(`/issues?state=${state}&per_page=100&page=${page}`))
            if (!res.ok) return this.fail(res, "list issues")
            const items = (await res.json().catch(() => [])) as Array<GithubPullRequest & { pull_request?: unknown }>
            if (!Array.isArray(items) || items.length === 0) break
            for (const it of items) {
                if (it.pull_request) continue // the issues endpoint also returns PRs
                out.push({ number: it.number, nodeId: it.node_id, title: it.title, body: it.body, state: it.state === "closed" ? "closed" : "open" })
            }
            if (items.length < 100) break
        }
        return out
    }

    // ── port: comments ───────────────────────────────────────────────────────
    async createIssueComment(issueNumber: number, body: string): Promise<{ id: number }> {
        const res = await this.client.fetch(this.installationId, this.path(`/issues/${issueNumber}/comments`), {
            method: "POST",
            body: JSON.stringify({ body }),
        })
        if (!res.ok) return this.fail(res, "create comment")
        return { id: ((await res.json()) as { id: number }).id }
    }

    async updateIssueComment(_issueNumber: number, commentId: number, body: string): Promise<void> {
        // GitHub edits by global comment id; issueNumber is unused here (GitLab needs it).
        const res = await this.client.fetch(this.installationId, this.path(`/issues/comments/${commentId}`), {
            method: "PATCH",
            body: JSON.stringify({ body }),
        })
        if (!res.ok) await this.fail(res, "update comment")
    }

    async listIssueComments(issueNumber: number): Promise<VcsComment[]> {
        const rows = await this.paginate<GithubComment>(`/issues/${issueNumber}/comments`, 5, "list PR comments")
        return rows.map((c) => this.toComment(c))
    }

    // GitHub serves PR comments from the same /issues/{n}/comments endpoint (a PR
    // is an issue), so these delegate to the issue-comment impl.
    createPullRequestComment(prNumber: number, body: string): Promise<{ id: number }> {
        return this.createIssueComment(prNumber, body)
    }
    updatePullRequestComment(prNumber: number, commentId: number, body: string): Promise<void> {
        return this.updateIssueComment(prNumber, commentId, body)
    }
    listPullRequestComments(prNumber: number): Promise<VcsComment[]> {
        return this.listIssueComments(prNumber)
    }

    // ── port: pull requests ──────────────────────────────────────────────────
    // GitHub's /branches has no sort parameter, so this is repository order.
    // Five pages of 100 is 500 branches — past that a dropdown is the wrong
    // control anyway, and the free-text fallback still accepts anything.
    async listBranches(): Promise<VcsBranch[]> {
        const rows = await this.paginate<{ name: string; commit?: { sha?: string }; protected?: boolean }>(
            "/branches",
            5,
            "list branches",
        )
        const def = await this.defaultBranch()
        return rows.map((b) => ({
            name: b.name,
            sha: b.commit?.sha ?? null,
            isDefault: def != null && b.name === def,
            isProtected: b.protected === true,
        }))
    }

    /** The repository's default branch, so the picker can leave it out — it is
     *  already indexed as the project's own graph.
     *
     *  Best-effort: failing to learn it costs the caller a redundant entry in a
     *  dropdown, which is not worth failing the whole listing over. */
    private async defaultBranch(): Promise<string | null> {
        try {
            const res = await this.client.fetch(this.installationId, this.path(""))
            if (!res.ok) return null
            const repo = (await res.json()) as { default_branch?: string }
            return repo?.default_branch ?? null
        } catch {
            return null
        }
    }

    async listPullRequests(opts?: { state?: "open" | "closed" | "all" }): Promise<VcsPullRequest[]> {
        const state = opts?.state ?? "all"
        const rows = await this.paginate<GithubPullRequest>(
            `/pulls?state=${state}&sort=updated&direction=desc`,
            5,
            "list PRs",
        )
        return rows.map((pr) => this.toPullRequest(pr))
    }

    async listPullRequestFiles(number: number): Promise<VcsPullRequestFile[]> {
        const rows = await this.paginate<{
            filename: string
            previous_filename?: string
            status: string
            patch?: string
            additions: number
            deletions: number
        }>(`/pulls/${number}/files`, 5, "list PR files")
        return rows.map((f) => ({
            filename: f.filename,
            previousFilename: f.previous_filename,
            status: f.status,
            patch: f.patch,
            additions: f.additions,
            deletions: f.deletions,
        }))
    }

    async compareCommits(base: string, head: string): Promise<VcsCompare> {
        // One page, deliberately. GitHub caps `compare` at 300 files and 250
        // commits and paginating past that does not lift the cap — it returns the
        // same truncated diff with more commits attached. A range that big is not
        // a push anyone wants scoped-reviewed anyway, so the honest move is to
        // report the truncation and let the caller fall back to a full review.
        const res = await this.client.fetch(
            this.installationId,
            this.path(`/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=250`),
        )
        if (!res.ok) return this.fail(res, "compare commits")
        const b = (await res.json()) as {
            status?: string
            ahead_by?: number
            behind_by?: number
            total_commits?: number
            files?: {
                filename: string
                previous_filename?: string
                status: string
                patch?: string
                additions: number
                deletions: number
            }[]
            commits?: {
                sha: string
                commit: { message: string; author?: { name?: string; date?: string } }
                author?: GithubActor | null
            }[]
        }

        const commits: VcsCommitSummary[] = (b.commits ?? []).map((c) => ({
            sha: c.sha,
            message: c.commit?.message ?? "",
            author: c.author?.login ?? c.commit?.author?.name ?? null,
            committedAt: c.commit?.author?.date ?? null,
        }))
        const files = (b.files ?? []).map((f) => ({
            filename: f.filename,
            previousFilename: f.previous_filename,
            status: f.status,
            patch: f.patch,
            additions: f.additions,
            deletions: f.deletions,
        }))

        return {
            status: compareStatus(b.status),
            aheadBy: b.ahead_by ?? commits.length,
            behindBy: b.behind_by ?? 0,
            files,
            commits,
            // 300/250 are GitHub's own ceilings; hitting either means the range
            // we were handed is not the range we got back.
            truncated: files.length >= 300 || (b.total_commits ?? commits.length) > commits.length,
        }
    }

    async listPullRequestReviews(number: number): Promise<VcsReview[]> {
        const rows = await this.paginate<GithubReview>(`/pulls/${number}/reviews`, 3, "list PR reviews")
        return rows.map((r) => this.toReview(r))
    }

    async getMergeMethods(): Promise<VcsMergeMethods> {
        const res = await this.client.fetch(this.installationId, this.path(""))
        if (!res.ok) return this.fail(res, "get repo")
        const b = (await res.json()) as {
            allow_merge_commit?: boolean
            allow_squash_merge?: boolean
            allow_rebase_merge?: boolean
        }
        return { mergeCommit: b.allow_merge_commit ?? true, squash: b.allow_squash_merge ?? true, rebase: b.allow_rebase_merge ?? true }
    }

    async getMergeability(number: number): Promise<VcsMergeability> {
        const res = await this.client.fetch(this.installationId, this.path(`/pulls/${number}`))
        if (!res.ok) return this.fail(res, "get PR")
        const b = (await res.json()) as {
            mergeable?: boolean | null
            mergeable_state?: string | null
            head?: { sha?: string }
            draft?: boolean
            state?: string
            merged?: boolean
        }
        return {
            mergeable: b.mergeable ?? null,
            mergeableState: b.mergeable_state ?? null,
            headSha: b.head?.sha ?? null,
            draft: b.draft ?? false,
            state: b.state ?? "open",
            merged: b.merged ?? false,
        }
    }

    async mergePullRequest(number: number, input: VcsMergeInput): Promise<VcsMergeResult> {
        const res = await this.client.fetch(this.installationId, this.path(`/pulls/${number}/merge`), {
            method: "PUT",
            body: JSON.stringify({
                merge_method: input.method,
                ...(input.sha ? { sha: input.sha } : {}),
                ...(input.commitTitle ? { commit_title: input.commitTitle } : {}),
                ...(input.commitMessage ? { commit_message: input.commitMessage } : {}),
            }),
        })
        if (res.ok) {
            const b = (await res.json()) as { merged?: boolean; sha?: string; message?: string }
            return { merged: b.merged ?? true, sha: b.sha ?? null, message: b.message ?? "" }
        }
        // Map the provider's refusal to the neutral error (status preserved) so
        // callers depend on the port, not the GitHub adapter.
        const detail = await res.text().catch(() => "")
        let message = ""
        try {
            message = (JSON.parse(detail) as { message?: string }).message ?? ""
        } catch {
            message = detail.slice(0, 200)
        }
        throw new VcsMergeError(res.status, message || `merge failed (HTTP ${res.status})`)
    }

    // ── private helpers ──────────────────────────────────────────────────────
    /** `/repos/{owner}/{repo}` + a sub-path. */
    private path(sub: string): string {
        return `/repos/${this.owner}/${this.repo}${sub}`
    }

    /** Paginate a repo sub-path (×100, bounded by maxPages). */
    private async paginate<T>(sub: string, maxPages: number, action: string): Promise<T[]> {
        const joiner = sub.includes("?") ? "&" : "?"
        const out: T[] = []
        for (let page = 1; page <= maxPages; page++) {
            const res = await this.client.fetch(this.installationId, this.path(`${sub}${joiner}per_page=100&page=${page}`))
            if (!res.ok) return this.fail(res, action)
            const items = (await res.json().catch(() => [])) as T[]
            if (!Array.isArray(items) || items.length === 0) break
            out.push(...items)
            if (items.length < 100) break
        }
        return out
    }

    /** GraphQL hard-delete; true on success, false when refused (caller closes). */
    private async graphqlDeleteIssue(nodeId: string): Promise<boolean> {
        try {
            const res = await this.client.fetch(this.installationId, `${GITHUB_API}/graphql`, {
                method: "POST",
                body: JSON.stringify({
                    query: "mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }",
                    variables: { id: nodeId },
                }),
            })
            if (!res.ok) return false
            const b = (await res.json().catch(() => null)) as { errors?: unknown[] } | null
            return !!b && !(Array.isArray(b.errors) && b.errors.length > 0)
        } catch {
            return false
        }
    }

    private async fail(res: Response, action: string): Promise<never> {
        const detail = await res.text().catch(() => "")
        throw new Error(`github: ${action} failed (${res.status}): ${detail.slice(0, 300)}`)
    }

    private toActor(a: GithubActor | null): VcsActor | null {
        return a ? { login: a.login, avatarUrl: a.avatar_url } : null
    }
    private toPullRequest(pr: GithubPullRequest): VcsPullRequest {
        return {
            number: pr.number,
            nodeId: pr.node_id,
            title: pr.title,
            body: pr.body,
            state: pr.state,
            draft: pr.draft ?? false,
            mergedAt: pr.merged_at,
            url: pr.html_url,
            author: this.toActor(pr.user),
            head: pr.head,
            base: pr.base,
            additions: pr.additions,
            deletions: pr.deletions,
            changedFiles: pr.changed_files,
            comments: pr.comments,
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
            closedAt: pr.closed_at,
        }
    }
    private toComment(c: GithubComment): VcsComment {
        return { id: c.id, body: c.body, url: c.html_url, author: this.toActor(c.user), createdAt: c.created_at, updatedAt: c.updated_at }
    }
    private toReview(r: GithubReview): VcsReview {
        return { id: r.id, body: r.body, url: r.html_url, author: this.toActor(r.user), state: r.state, submittedAt: r.submitted_at }
    }
}

/** GitHub's compare `status` onto the neutral one. An unrecognised value maps to
 *  "unknown" rather than to a guess: the whole reason a caller reads this field
 *  is to refuse to carry findings across a rewritten history, and a wrong guess
 *  there is precisely the failure it exists to prevent. */
function compareStatus(raw: string | undefined): VcsCompareStatus {
    switch (raw) {
        case "identical":
            return "identical"
        case "ahead":
            return "ahead"
        case "behind":
            return "behind"
        case "diverged":
            return "diverged"
        default:
            return "unknown"
    }
}
