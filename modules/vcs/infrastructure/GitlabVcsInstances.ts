// VCS module — the GitLab adapters (issues + MRs + notes) behind the same
// VcsAppInstance / VcsUserInstance ports as GitHub. GitLab has no "app
// installation": the bot credential is a Project Access Token (or the connecting
// user's token) provisioned per project into tracker.gitlab_project_links, which
// this adapter reads by project id. Everything maps GitLab's REST API v4 onto the
// vendor-neutral DTOs.
//
// Known GitLab⇄port impedance (flagged for follow-up, not blockers for issue sync):
//   • updateIssueComment(commentId) can't run — GitLab note edits need the parent
//     issue iid, which the port doesn't pass; it no-ops with a warning.
//   • Merge-request "reviews" have no GitHub analog → listPullRequestReviews = [].

import { Supabase } from "@/lib/server/supabase"
import type { VcsAppInstance } from "../ports/VcsAppInstance"
import type { VcsUserInstance } from "../ports/VcsUserInstance"
import {
    VcsMergeError,
    VcsReauthError,
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

const USER_AGENT = "ucelot-tracker"

// ── GitLab wire shapes (subset) ──────────────────────────────────────────────
interface GlUser {
    username: string
    avatar_url: string | null
}
interface GlIssue {
    iid: number
    id: number
    title: string
    description: string | null
    state: string // opened | closed
    updated_at?: string
}
interface GlNote {
    id: number
    body: string | null
    author: GlUser | null
    created_at: string
    updated_at: string
}
interface GlMr {
    iid: number
    id: number
    title: string
    description: string | null
    state: string // opened | closed | merged | locked
    draft?: boolean
    work_in_progress?: boolean
    merged_at: string | null
    web_url: string
    author: GlUser | null
    source_branch: string
    target_branch: string
    sha: string | null
    created_at: string
    updated_at: string
    closed_at: string | null
}

function toActor(u: GlUser | null) {
    return u ? { login: u.username, avatarUrl: u.avatar_url ?? "" } : null
}
function issueState(s: string): "open" | "closed" {
    return s === "closed" ? "closed" : "open"
}

/** GitLab REST transport for one instance + bearer token. */
export class GitlabClient {
    constructor(
        private readonly apiBase: string,
        private readonly token: string,
    ) {}

    async fetch(path: string, init: RequestInit = {}): Promise<Response> {
        const url = path.startsWith("http") ? path : `${this.apiBase}${path}`
        return fetch(url, {
            ...init,
            headers: {
                Authorization: `Bearer ${this.token}`,
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
                ...(init.headers as Record<string, string>),
            },
            cache: "no-store",
        })
    }

    async paginate<T>(path: string, maxPages: number): Promise<T[]> {
        const joiner = path.includes("?") ? "&" : "?"
        const out: T[] = []
        for (let page = 1; page <= maxPages; page++) {
            const res = await this.fetch(`${path}${joiner}per_page=100&page=${page}`)
            if (!res.ok) await fail(res, `list ${path}`)
            const items = (await res.json().catch(() => [])) as T[]
            if (!Array.isArray(items) || items.length === 0) break
            out.push(...items)
            if (items.length < 100) break
        }
        return out
    }
}

async function fail(res: Response, action: string): Promise<never> {
    if (res.status === 401 || res.status === 403) throw new VcsReauthError()
    const detail = await res.text().catch(() => "")
    throw new Error(`gitlab: ${action} failed (${res.status}): ${detail.slice(0, 300)}`)
}

/** The provisioned bot link for a project (gitlab_project_links). */
interface GitlabLink {
    apiBase: string
    projectId: number
    token: string
}

async function loadLink(projectUuid: string): Promise<GitlabLink | null> {
    const svc = Supabase.service()
    const { data } = await svc
        .from("gitlab_project_links")
        .select("gitlab_project_id,access_token,api_base")
        .eq("project_id", projectUuid)
        .maybeSingle<{ gitlab_project_id: number; access_token: string | null; api_base: string | null }>()
    if (!data?.access_token) return null
    return {
        apiBase: data.api_base ?? "https://gitlab.com/api/v4",
        projectId: data.gitlab_project_id,
        token: data.access_token,
    }
}

/** GitLab VcsAppInstance — bound to a tracker project; reads its bot credential
 *  + numeric project id from gitlab_project_links (memoized per instance). */
export class GitlabVcsAppInstance implements VcsAppInstance {
    private linkPromise: Promise<GitlabLink> | null = null

    constructor(private readonly projectUuid: string) {}

    private link(): Promise<GitlabLink> {
        if (!this.linkPromise) {
            this.linkPromise = loadLink(this.projectUuid).then((l) => {
                if (!l) throw new VcsReauthError("gitlab project not provisioned")
                return l
            })
        }
        return this.linkPromise
    }

    private async client(): Promise<{ c: GitlabClient; pid: number }> {
        const l = await this.link()
        return { c: new GitlabClient(l.apiBase, l.token), pid: l.projectId }
    }

    // ── issues ───────────────────────────────────────────────────────────────
    async createIssue(input: { title: string; body?: string }): Promise<{ number: number; nodeId: string }> {
        const { c, pid } = await this.client()
        const res = await c.fetch(`/projects/${pid}/issues`, {
            method: "POST",
            body: JSON.stringify({ title: input.title, description: input.body ?? "" }),
        })
        if (!res.ok) await fail(res, "create issue")
        const b = (await res.json()) as GlIssue
        return { number: b.iid, nodeId: String(b.id) }
    }

    async updateIssue(
        number: number,
        patch: { title?: string; body?: string; state?: "open" | "closed" },
    ): Promise<void> {
        const { c, pid } = await this.client()
        const body: Record<string, unknown> = {}
        if (patch.title != null) body.title = patch.title
        if (patch.body != null) body.description = patch.body
        if (patch.state) body.state_event = patch.state === "closed" ? "close" : "reopen"
        const res = await c.fetch(`/projects/${pid}/issues/${number}`, { method: "PUT", body: JSON.stringify(body) })
        if (!res.ok) await fail(res, "update issue")
    }

    async deleteIssue(ref: { number: number | null; nodeId: string | null }): Promise<void> {
        if (ref.number == null) return
        const { c, pid } = await this.client()
        // GitLab hard-deletes issues for owners; otherwise fall back to closing.
        const res = await c.fetch(`/projects/${pid}/issues/${ref.number}`, { method: "DELETE" })
        if (!res.ok) await this.updateIssue(ref.number, { state: "closed" }).catch(() => {})
    }

    async listIssues(opts?: { state?: "open" | "closed" | "all" }): Promise<VcsIssue[]> {
        const { c, pid } = await this.client()
        const scope = opts?.state === "open" ? "opened" : opts?.state === "closed" ? "closed" : "all"
        const rows = await c.paginate<GlIssue>(`/projects/${pid}/issues?scope=all&state=${scope}`, 10)
        return rows.map((i) => ({
            number: i.iid,
            nodeId: String(i.id),
            title: i.title,
            body: i.description,
            state: issueState(i.state),
        }))
    }

    // ── comments (notes) ─────────────────────────────────────────────────────
    async createIssueComment(issueNumber: number, body: string): Promise<{ id: number }> {
        const { c, pid } = await this.client()
        const res = await c.fetch(`/projects/${pid}/issues/${issueNumber}/notes`, {
            method: "POST",
            body: JSON.stringify({ body }),
        })
        if (!res.ok) await fail(res, "create note")
        return { id: ((await res.json()) as GlNote).id }
    }

    async updateIssueComment(issueNumber: number, commentId: number, body: string): Promise<void> {
        const { c, pid } = await this.client()
        const res = await c.fetch(`/projects/${pid}/issues/${issueNumber}/notes/${commentId}`, {
            method: "PUT",
            body: JSON.stringify({ body }),
        })
        if (!res.ok) await fail(res, "update note")
    }

    async listIssueComments(issueNumber: number): Promise<VcsComment[]> {
        const { c, pid } = await this.client()
        const rows = await c.paginate<GlNote>(`/projects/${pid}/issues/${issueNumber}/notes?sort=asc`, 5)
        return rows.map((n) => ({
            id: n.id,
            body: n.body,
            url: "",
            author: toActor(n.author),
            createdAt: n.created_at,
            updatedAt: n.updated_at,
        }))
    }

    // ── MR comments (GitLab's note endpoint is per-noteable: merge_requests) ──
    async createPullRequestComment(prNumber: number, body: string): Promise<{ id: number }> {
        const { c, pid } = await this.client()
        const res = await c.fetch(`/projects/${pid}/merge_requests/${prNumber}/notes`, {
            method: "POST",
            body: JSON.stringify({ body }),
        })
        if (!res.ok) await fail(res, "create MR note")
        return { id: ((await res.json()) as GlNote).id }
    }

    async updatePullRequestComment(prNumber: number, commentId: number, body: string): Promise<void> {
        const { c, pid } = await this.client()
        const res = await c.fetch(`/projects/${pid}/merge_requests/${prNumber}/notes/${commentId}`, {
            method: "PUT",
            body: JSON.stringify({ body }),
        })
        if (!res.ok) await fail(res, "update MR note")
    }

    async listPullRequestComments(prNumber: number): Promise<VcsComment[]> {
        const { c, pid } = await this.client()
        const rows = await c.paginate<GlNote>(`/projects/${pid}/merge_requests/${prNumber}/notes?sort=asc`, 5)
        return rows.map((n) => ({
            id: n.id,
            body: n.body,
            url: "",
            author: toActor(n.author),
            createdAt: n.created_at,
            updatedAt: n.updated_at,
        }))
    }

    // ── merge requests ───────────────────────────────────────────────────────
    // GitLab sorts branches by name; `default` comes back on each row, so
    // unlike GitHub this needs no second call to learn it.
    async listBranches(): Promise<VcsBranch[]> {
        const { c, pid } = await this.client()
        const rows = await c.paginate<{
            name: string
            default?: boolean
            protected?: boolean
            commit?: { id?: string }
        }>(`/projects/${pid}/repository/branches`, 5)
        return rows.map((b) => ({
            name: b.name,
            sha: b.commit?.id ?? null,
            isDefault: b.default === true,
            isProtected: b.protected === true,
        }))
    }

    async listPullRequests(opts?: { state?: "open" | "closed" | "all" }): Promise<VcsPullRequest[]> {
        const { c, pid } = await this.client()
        const state = opts?.state === "open" ? "opened" : opts?.state === "closed" ? "closed" : "all"
        const rows = await c.paginate<GlMr>(
            `/projects/${pid}/merge_requests?state=${state}&order_by=updated_at&sort=desc`,
            5,
        )
        return rows.map((m) => this.toPr(m))
    }

    async listPullRequestFiles(number: number): Promise<VcsPullRequestFile[]> {
        const { c, pid } = await this.client()
        const res = await c.fetch(`/projects/${pid}/merge_requests/${number}/changes`)
        if (!res.ok) await fail(res, "list MR changes")
        const b = (await res.json()) as {
            changes?: { old_path: string; new_path: string; diff: string; new_file: boolean; deleted_file: boolean; renamed_file: boolean }[]
        }
        return (b.changes ?? []).map((f) => ({
            filename: f.new_path,
            previousFilename: f.renamed_file ? f.old_path : undefined,
            status: f.new_file ? "added" : f.deleted_file ? "removed" : f.renamed_file ? "renamed" : "modified",
            patch: f.diff,
            additions: 0,
            deletions: 0,
        }))
    }

    async compareCommits(base: string, head: string): Promise<VcsCompare> {
        const { c, pid } = await this.client()

        // straight=true is base..head — the literal range. Without it GitLab
        // compares against the merge base, which silently answers a DIFFERENT
        // question than the one an incremental review asks ("what did this push
        // change") the moment the branch has been updated from its target.
        const q = `from=${encodeURIComponent(base)}&to=${encodeURIComponent(head)}&straight=true`
        const res = await c.fetch(`/projects/${pid}/repository/compare?${q}`)
        if (!res.ok) await fail(res, "compare commits")
        const b = (await res.json()) as {
            commits?: { id: string; message?: string; title?: string; author_name?: string; committed_date?: string }[]
            diffs?: { old_path: string; new_path: string; diff?: string; new_file?: boolean; deleted_file?: boolean; renamed_file?: boolean }[]
            compare_timeout?: boolean
        }

        const commits: VcsCommitSummary[] = (b.commits ?? []).map((x) => ({
            sha: x.id,
            message: x.message ?? x.title ?? "",
            author: x.author_name ?? null,
            committedAt: x.committed_date ?? null,
        }))
        const files = (b.diffs ?? []).map((f) => ({
            filename: f.new_path,
            previousFilename: f.renamed_file ? f.old_path : undefined,
            status: f.new_file ? "added" : f.deleted_file ? "removed" : f.renamed_file ? "renamed" : "modified",
            patch: f.diff,
            // GitLab's compare payload carries no per-file line counts. Zeroes
            // rather than a guess: the numbers are cosmetic here, and an invented
            // one would be indistinguishable from a real one downstream.
            additions: 0,
            deletions: 0,
        }))

        return {
            status: await this.ancestry(base, head),
            aheadBy: commits.length,
            behindBy: 0,
            files,
            commits,
            // GitLab gives up on a big diff rather than truncating to a cap, and
            // says so. A timed-out compare is not a complete picture of the push.
            truncated: b.compare_timeout === true,
        }
    }

    /** Where `base` sits relative to `head`, via the merge base.
     *
     *  GitLab's compare payload has no `status` field, so this is a second call.
     *  Worth it: the answer is what decides whether a force-push may carry
     *  findings forward, and the alternative — assuming the convenient reading —
     *  is the exact fail-open the caller reads this to avoid. Any failure
     *  answers "unknown", which the caller treats as "prove nothing, carry
     *  nothing". */
    private async ancestry(base: string, head: string): Promise<VcsCompareStatus> {
        if (base === head) return "identical"
        try {
            const { c, pid } = await this.client()
            const q = `refs[]=${encodeURIComponent(base)}&refs[]=${encodeURIComponent(head)}`
            const res = await c.fetch(`/projects/${pid}/repository/merge_base?${q}`)
            if (!res.ok) return "unknown"
            const mb = (await res.json()) as { id?: string }
            if (!mb.id) return "unknown"
            if (mb.id === base) return "ahead"
            if (mb.id === head) return "behind"
            return "diverged"
        } catch {
            return "unknown"
        }
    }

    async listPullRequestReviews(_number: number): Promise<VcsReview[]> {
        return [] // GitLab has no GitHub-style review summaries.
    }

    async getMergeMethods(): Promise<VcsMergeMethods> {
        // GitLab's merge strategy is a project-level setting; expose all so the UI
        // offers them and GitLab rejects an unsupported one at merge time.
        return { mergeCommit: true, squash: true, rebase: true }
    }

    async getMergeability(number: number): Promise<VcsMergeability> {
        const { c, pid } = await this.client()
        const res = await c.fetch(`/projects/${pid}/merge_requests/${number}`)
        if (!res.ok) await fail(res, "get MR")
        const b = (await res.json()) as GlMr & { merge_status?: string; merged?: boolean }
        return {
            mergeable: b.merge_status === "can_be_merged" ? true : b.merge_status === "cannot_be_merged" ? false : null,
            mergeableState: b.merge_status ?? null,
            headSha: b.sha,
            draft: b.draft ?? b.work_in_progress ?? false,
            state: issueState(b.state),
            merged: b.state === "merged",
        }
    }

    async mergePullRequest(number: number, input: VcsMergeInput): Promise<VcsMergeResult> {
        const { c, pid } = await this.client()
        const res = await c.fetch(`/projects/${pid}/merge_requests/${number}/merge`, {
            method: "PUT",
            body: JSON.stringify({ squash: input.method === "squash" }),
        })
        if (res.ok) {
            const b = (await res.json()) as { merge_commit_sha?: string; sha?: string }
            return { merged: true, sha: b.merge_commit_sha ?? b.sha ?? null, message: "" }
        }
        const detail = await res.text().catch(() => "")
        let message = ""
        try {
            message = (JSON.parse(detail) as { message?: string }).message ?? ""
        } catch {
            message = detail.slice(0, 200)
        }
        throw new VcsMergeError(res.status, message || `merge failed (HTTP ${res.status})`)
    }

    private toPr(m: GlMr): VcsPullRequest {
        return {
            number: m.iid,
            nodeId: String(m.id),
            title: m.title,
            body: m.description,
            state: m.state === "merged" || m.state === "closed" ? "closed" : "open",
            draft: m.draft ?? m.work_in_progress ?? false,
            mergedAt: m.merged_at,
            url: m.web_url,
            author: toActor(m.author),
            head: { ref: m.source_branch, sha: m.sha ?? "" },
            base: { ref: m.target_branch, sha: "" },
            createdAt: m.created_at,
            updatedAt: m.updated_at,
            closedAt: m.closed_at,
        }
    }
}

/** GitLab VcsUserInstance — posts notes as the signed-in user. Bound to the user's
 *  token + the instance api base + numeric project id. */
export class GitlabVcsUserInstance implements VcsUserInstance {
    private readonly c: GitlabClient
    constructor(
        token: string,
        apiBase: string,
        private readonly projectId: number,
    ) {
        this.c = new GitlabClient(apiBase, token)
    }

    async createComment(issueNumber: number, body: string): Promise<VcsComment> {
        const res = await this.c.fetch(`/projects/${this.projectId}/issues/${issueNumber}/notes`, {
            method: "POST",
            body: JSON.stringify({ body }),
        })
        if (!res.ok) await fail(res, "create note")
        const n = (await res.json()) as GlNote
        return { id: n.id, body: n.body, url: "", author: toActor(n.author), createdAt: n.created_at, updatedAt: n.updated_at }
    }

    async updateComment(issueNumber: number, commentId: number, body: string): Promise<VcsComment> {
        const res = await this.c.fetch(`/projects/${this.projectId}/issues/${issueNumber}/notes/${commentId}`, {
            method: "PUT",
            body: JSON.stringify({ body }),
        })
        if (!res.ok) await fail(res, "update note")
        const n = (await res.json()) as GlNote
        return { id: n.id, body: n.body, url: "", author: toActor(n.author), createdAt: n.created_at, updatedAt: n.updated_at }
    }

    async deleteComment(issueNumber: number, commentId: number): Promise<void> {
        const res = await this.c.fetch(`/projects/${this.projectId}/issues/${issueNumber}/notes/${commentId}`, {
            method: "DELETE",
        })
        // 404 = already gone → idempotent success.
        if (!res.ok && res.status !== 404) await fail(res, "delete note")
    }
}

// ── clone auth (for the analyser's server-side git clone) ────────────────────

/** The clone credential the analyser needs for a PRIVATE GitLab repo, as the
 *  job contract's git_auth shape. GitLab accepts basic auth with username
 *  "oauth2" + the token as password (works for OAuth tokens and PATs). Reads the
 *  project's provisioned bot token (gitlab_project_links). Null for a GitHub /
 *  unprovisioned project — the caller then falls back to the user_id path. Public
 *  repos don't need this at all. */
export async function getGitlabCloneAuth(
    projectUuid: string,
): Promise<{ token: string; username: string; scheme: "basic" } | null> {
    const svc = Supabase.service()
    const { data } = await svc
        .from("gitlab_project_links")
        .select("access_token")
        .eq("project_id", projectUuid)
        .maybeSingle<{ access_token: string | null }>()
    if (!data?.access_token) return null
    return { token: data.access_token, username: "oauth2", scheme: "basic" }
}

// ── provisioning ─────────────────────────────────────────────────────────────

/** Constant-time compare for the X-Gitlab-Token webhook secret. */
export function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

export interface ProvisionInput {
    projectUuid: string
    gitlabProjectId: number
    apiBase: string
    userToken: string
    webhookUrl: string
}

/** Provision the bot credential + webhook for a GitLab project, using the
 *  connecting user's token. Tries to mint a dedicated Project Access Token; if the
 *  instance/tier forbids it, falls back to the user's own token as the bot
 *  credential. Registers a project webhook with a fresh secret. Writes it all to
 *  gitlab_project_links (service-role). Returns the outcome for the caller to
 *  surface. */
export async function provisionGitlabProject(
    input: ProvisionInput,
): Promise<{ ok: boolean; botKind: "project_token" | "user_token"; warning?: string }> {
    const { projectUuid, gitlabProjectId, apiBase, userToken, webhookUrl } = input
    const userClient = new GitlabClient(apiBase, userToken)

    // 1. Bot credential — prefer a Project Access Token (durable, user-independent).
    let botToken = userToken
    let botKind: "project_token" | "user_token" = "user_token"
    let tokenExpiresAt: string | null = null
    let warning: string | undefined
    const expDate = new Date(Date.now() + 364 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    try {
        const res = await userClient.fetch(`/projects/${gitlabProjectId}/access_tokens`, {
            method: "POST",
            body: JSON.stringify({ name: "bobby-tracker", scopes: ["api"], access_level: 40, expires_at: expDate }),
        })
        if (res.ok) {
            const b = (await res.json()) as { token: string; expires_at?: string }
            botToken = b.token
            botKind = "project_token"
            tokenExpiresAt = b.expires_at ?? `${expDate}T00:00:00Z`
        } else {
            warning = `Project Access Token unavailable (HTTP ${res.status}); using your token as the bot credential.`
        }
    } catch (e) {
        warning = `Project Access Token error (${(e as Error).message}); using your token as the bot credential.`
    }

    // 2. Webhook with a fresh per-project secret (X-Gitlab-Token).
    const secret = crypto.randomUUID()
    let webhookId: number | null = null
    const hookRes = await userClient.fetch(`/projects/${gitlabProjectId}/hooks`, {
        method: "POST",
        body: JSON.stringify({
            url: webhookUrl,
            token: secret,
            issues_events: true,
            merge_requests_events: true,
            note_events: true,
            push_events: true,
            enable_ssl_verification: true,
        }),
    })
    if (hookRes.ok) {
        webhookId = ((await hookRes.json()) as { id: number }).id
    } else {
        // Non-fatal: keep the bot credential so outbound sync + reads still work.
        // Inbound (GitLab → tracker) needs this hook — commonly blocked when the
        // app URL isn't publicly reachable (GitLab rejects webhooks to
        // localhost/private hosts). Surface it; the link is still persisted below.
        const detail = await hookRes.text().catch(() => "")
        const w = `Webhook not registered (HTTP ${hookRes.status}: ${detail.slice(0, 140)}). Inbound GitLab→tracker sync needs a publicly reachable URL; outbound still works.`
        warning = warning ? `${warning} ${w}` : w
    }

    // 3. Persist (service-role; secrets never exposed to the client).
    const svc = Supabase.service()
    const { error } = await svc.from("gitlab_project_links").upsert(
        {
            project_id: projectUuid,
            gitlab_project_id: gitlabProjectId,
            access_token: botToken,
            token_expires_at: tokenExpiresAt,
            webhook_id: webhookId,
            webhook_secret: secret,
            api_base: apiBase,
        },
        { onConflict: "project_id" },
    )
    if (error) throw new Error(`gitlab: persist link failed: ${error.message}`)

    return { ok: true, botKind, warning }
}
