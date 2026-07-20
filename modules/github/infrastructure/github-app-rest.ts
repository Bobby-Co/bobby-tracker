// GitHub App REST helpers — the thin request/response wrappers over the GitHub
// REST + GraphQL APIs (issues, PRs, comments, reviews, merge). Split out of
// lib/github-app.ts so that file holds only the auth/JWT/token/webhook core; the
// two now compose through the single choke-point fetch (githubAppFetch).
//
// Server-only. Every helper goes through githubAppFetch, which attaches the
// installation token + mandatory headers and re-mints once on a 401. Pagination
// helpers are all bounded by a maxPages cap so a huge repo/PR can't run unbounded.

import { githubAppFetch } from "./github-app"

async function readError(res: Response, action: string): Promise<never> {
    const detail = await res.text().catch(() => "")
    throw new Error(`github: ${action} failed (${res.status}): ${detail.slice(0, 300)}`)
}

// createGithubIssue opens an issue and returns its number + node_id.
export async function createGithubIssue(
    installationId: number,
    owner: string,
    repo: string,
    data: { title: string; body?: string },
): Promise<{ number: number; node_id: string }> {
    const res = await githubAppFetch(installationId, `/repos/${owner}/${repo}/issues`, {
        method: "POST",
        body: JSON.stringify({ title: data.title, body: data.body ?? "" }),
    })
    if (!res.ok) return readError(res, "create issue")
    const body = (await res.json()) as { number: number; node_id: string }
    return { number: body.number, node_id: body.node_id }
}

// updateGithubIssue patches an existing issue's title/body/state.
export async function updateGithubIssue(
    installationId: number,
    owner: string,
    repo: string,
    num: number,
    patch: { title?: string; body?: string; state?: "open" | "closed" },
): Promise<void> {
    const res = await githubAppFetch(installationId, `/repos/${owner}/${repo}/issues/${num}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
    })
    if (!res.ok) return readError(res, "update issue")
}

// createIssueComment posts a comment (as the bot) on an issue and returns its
// id so the caller can later edit it in place (loading → result).
export async function createIssueComment(
    installationId: number,
    owner: string,
    repo: string,
    num: number,
    body: string,
): Promise<{ id: number }> {
    const res = await githubAppFetch(
        installationId,
        `/repos/${owner}/${repo}/issues/${num}/comments`,
        { method: "POST", body: JSON.stringify({ body }) },
    )
    if (!res.ok) return readError(res, "create comment")
    const b = (await res.json()) as { id: number }
    return { id: b.id }
}

// updateIssueComment edits an existing comment in place (by comment id) — used
// to swap the "analysing…" placeholder for the final result.
export async function updateIssueComment(
    installationId: number,
    owner: string,
    repo: string,
    commentId: number,
    body: string,
): Promise<void> {
    const res = await githubAppFetch(
        installationId,
        `/repos/${owner}/${repo}/issues/comments/${commentId}`,
        { method: "PATCH", body: JSON.stringify({ body }) },
    )
    if (!res.ok) return readError(res, "update comment")
}

// deleteIssueGraphQL hard-deletes an issue via the GraphQL deleteIssue mutation
// (the REST API can't delete issues). Needs the issue node id. Returns true on
// success; false (rather than throwing) when the org/app can't delete, so the
// caller can fall back to closing.
export async function deleteIssueGraphQL(installationId: number, issueNodeId: string): Promise<boolean> {
    const query = "mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }"
    const res = await githubAppFetch(installationId, "https://api.github.com/graphql", {
        method: "POST",
        body: JSON.stringify({ query, variables: { id: issueNodeId } }),
    })
    if (!res.ok) return false
    const body = (await res.json().catch(() => null)) as { errors?: unknown[] } | null
    return !!body && !(Array.isArray(body.errors) && body.errors.length > 0)
}

// GithubRepoIssue is the subset of a REST issue we care about for backfill.
export interface GithubRepoIssue {
    number: number
    node_id: string
    title: string
    body: string | null
    state: string // "open" | "closed"
}

// listRepoIssues paginates the repo's issues (state=all by default). The REST
// issues endpoint also returns PRs — those carry a `pull_request` field and are
// filtered out. Bounded by maxPages (×100) so a huge repo can't run unbounded.
export async function listRepoIssues(
    installationId: number,
    owner: string,
    repo: string,
    opts: { state?: "open" | "closed" | "all"; maxPages?: number } = {},
): Promise<GithubRepoIssue[]> {
    const state = opts.state ?? "all"
    const maxPages = opts.maxPages ?? 10 // up to 1000 issues
    const out: GithubRepoIssue[] = []
    for (let page = 1; page <= maxPages; page++) {
        const res = await githubAppFetch(
            installationId,
            `/repos/${owner}/${repo}/issues?state=${state}&per_page=100&page=${page}`,
        )
        if (!res.ok) return readError(res, "list issues")
        const items = (await res.json().catch(() => [])) as Array<
            GithubRepoIssue & { pull_request?: unknown }
        >
        if (!Array.isArray(items) || items.length === 0) break
        for (const it of items) {
            if (it.pull_request) continue // skip PRs
            out.push({ number: it.number, node_id: it.node_id, title: it.title, body: it.body ?? null, state: it.state })
        }
        if (items.length < 100) break
    }
    return out
}

// GithubPRFile is the subset of a PR's changed-file entry we send to the
// analyser (GET /repos/{o}/{r}/pulls/{n}/files).
export interface GithubPRFile {
    filename: string
    previous_filename?: string
    status: string // added | modified | removed | renamed | changed
    patch?: string // unified diff; absent for binary/oversized files
    additions: number
    deletions: number
}

// listPullRequestFiles fetches a PR's changed files (with per-file unified
// patches), paginated. Bounded by maxPages × 100 so a huge PR can't run
// unbounded.
export async function listPullRequestFiles(
    installationId: number,
    owner: string,
    repo: string,
    number: number,
    opts: { maxPages?: number } = {},
): Promise<GithubPRFile[]> {
    const maxPages = opts.maxPages ?? 5 // up to 500 files
    const out: GithubPRFile[] = []
    for (let page = 1; page <= maxPages; page++) {
        const res = await githubAppFetch(
            installationId,
            `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
        )
        if (!res.ok) return readError(res, "list PR files")
        const items = (await res.json().catch(() => [])) as GithubPRFile[]
        if (!Array.isArray(items) || items.length === 0) break
        out.push(...items)
        if (items.length < 100) break
    }
    return out
}

// ─── PR + comment mirror (Pull-requests tab) ────────────────────────────────

// A GitHub user reference as it appears on PRs/comments/reviews.
export interface GithubActor {
    login: string
    avatar_url: string
}

// GithubPullRequest is the subset of a REST PR (list or single) we mirror.
// Note: the list endpoint (/pulls) omits additions/deletions/changed_files —
// those only come on the single-PR GET and the webhook payload, so they're
// optional here.
export interface GithubPullRequest {
    number: number
    node_id: string
    title: string
    body: string | null
    state: string // "open" | "closed"
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

// listPullRequests paginates a repo's PRs (state=all by default), newest first.
// Bounded by maxPages (×100) so a huge repo can't run unbounded.
export async function listPullRequests(
    installationId: number,
    owner: string,
    repo: string,
    opts: { state?: "open" | "closed" | "all"; maxPages?: number } = {},
): Promise<GithubPullRequest[]> {
    const state = opts.state ?? "all"
    const maxPages = opts.maxPages ?? 5 // up to 500 PRs
    const out: GithubPullRequest[] = []
    for (let page = 1; page <= maxPages; page++) {
        const res = await githubAppFetch(
            installationId,
            `/repos/${owner}/${repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=100&page=${page}`,
        )
        if (!res.ok) return readError(res, "list PRs")
        const items = (await res.json().catch(() => [])) as GithubPullRequest[]
        if (!Array.isArray(items) || items.length === 0) break
        out.push(...items)
        if (items.length < 100) break
    }
    return out
}

// GithubComment is the subset of a PR conversation comment we mirror.
export interface GithubComment {
    id: number
    body: string | null
    html_url: string
    user: GithubActor | null
    created_at: string
    updated_at: string
}

// listIssueComments paginates a PR's conversation-thread comments (a PR is an
// issue for the comments endpoint), oldest first.
export async function listIssueComments(
    installationId: number,
    owner: string,
    repo: string,
    number: number,
    opts: { maxPages?: number } = {},
): Promise<GithubComment[]> {
    const maxPages = opts.maxPages ?? 5 // up to 500 comments
    const out: GithubComment[] = []
    for (let page = 1; page <= maxPages; page++) {
        const res = await githubAppFetch(
            installationId,
            `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100&page=${page}`,
        )
        if (!res.ok) return readError(res, "list PR comments")
        const items = (await res.json().catch(() => [])) as GithubComment[]
        if (!Array.isArray(items) || items.length === 0) break
        out.push(...items)
        if (items.length < 100) break
    }
    return out
}

// GithubReview is the subset of a PR review we mirror. Only reviews carrying a
// non-empty body are worth showing as a comment (approve/request-changes with
// no note are just status).
export interface GithubReview {
    id: number
    body: string | null
    html_url: string
    user: GithubActor | null
    state: string // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED
    submitted_at: string | null
}

// listPullRequestReviews paginates a PR's reviews (summary bodies), oldest
// first. The caller filters to reviews with a body.
export async function listPullRequestReviews(
    installationId: number,
    owner: string,
    repo: string,
    number: number,
    opts: { maxPages?: number } = {},
): Promise<GithubReview[]> {
    const maxPages = opts.maxPages ?? 3 // up to 300 reviews
    const out: GithubReview[] = []
    for (let page = 1; page <= maxPages; page++) {
        const res = await githubAppFetch(
            installationId,
            `/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100&page=${page}`,
        )
        if (!res.ok) return readError(res, "list PR reviews")
        const items = (await res.json().catch(() => [])) as GithubReview[]
        if (!Array.isArray(items) || items.length === 0) break
        out.push(...items)
        if (items.length < 100) break
    }
    return out
}

// ─── merge ──────────────────────────────────────────────────────────────────

// The three merge strategies a repo can enable. Which are allowed comes from the
// repo settings (getRepoMergeMethods); GitHub 405s a merge that uses a disabled
// one, so the tracker offers only the enabled set.
export interface RepoMergeMethods {
    allow_merge_commit: boolean
    allow_squash_merge: boolean
    allow_rebase_merge: boolean
}

// getRepoMergeMethods reads which merge strategies the repo permits. GitHub
// defaults an omitted flag to true (a brand-new repo allows all three), so we
// mirror that rather than defaulting to false and hiding every option.
export async function getRepoMergeMethods(
    installationId: number,
    owner: string,
    repo: string,
): Promise<RepoMergeMethods> {
    const res = await githubAppFetch(installationId, `/repos/${owner}/${repo}`)
    if (!res.ok) return readError(res, "get repo")
    const b = (await res.json()) as Partial<RepoMergeMethods>
    return {
        allow_merge_commit: b.allow_merge_commit ?? true,
        allow_squash_merge: b.allow_squash_merge ?? true,
        allow_rebase_merge: b.allow_rebase_merge ?? true,
    }
}

// GitHub's live mergeability for one PR. `mergeable` is null while GitHub is
// still computing the merge (a background job it kicks on demand) — the caller
// should treat null as "unknown", not "unmergeable". `mergeable_state` is the
// richer signal ("clean" | "dirty" (conflicts) | "blocked" (branch protection)
// | "behind" | "unstable" | "unknown" | …), surfaced so the UI can warn before
// the user commits to a merge that GitHub will reject.
export interface PullMergeability {
    mergeable: boolean | null
    mergeable_state: string | null
    head_sha: string | null
    draft: boolean
    state: string
    merged: boolean
}

export async function getPullMergeability(
    installationId: number,
    owner: string,
    repo: string,
    number: number,
): Promise<PullMergeability> {
    const res = await githubAppFetch(installationId, `/repos/${owner}/${repo}/pulls/${number}`)
    if (!res.ok) return readError(res, "get PR")
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
        mergeable_state: b.mergeable_state ?? null,
        head_sha: b.head?.sha ?? null,
        draft: b.draft ?? false,
        state: b.state ?? "open",
        merged: b.merged ?? false,
    }
}

// A merge that GitHub refused, carrying its HTTP status so the caller can map
// the well-known ones to specific messages instead of a generic 502:
//   405 — not mergeable (conflicts, failing required checks, branch protection)
//   409 — head SHA moved since the caller last saw it (`sha` guard, or a race)
//   403 — the installation lacks `contents: write` to push the merge
export class GithubMergeError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message)
        this.name = "GithubMergeError"
    }
}

export interface MergeResult {
    merged: boolean
    sha: string | null
    message: string
}

// mergePullRequest performs the merge. `sha`, when passed, makes GitHub reject
// the merge (409) if the PR head has moved since — the caller sends the head it
// showed the user, so a merge can't land on a commit they never saw.
export async function mergePullRequest(
    installationId: number,
    owner: string,
    repo: string,
    number: number,
    opts: {
        merge_method: "merge" | "squash" | "rebase"
        sha?: string
        commit_title?: string
        commit_message?: string
    },
): Promise<MergeResult> {
    const res = await githubAppFetch(installationId, `/repos/${owner}/${repo}/pulls/${number}/merge`, {
        method: "PUT",
        body: JSON.stringify({
            merge_method: opts.merge_method,
            ...(opts.sha ? { sha: opts.sha } : {}),
            ...(opts.commit_title ? { commit_title: opts.commit_title } : {}),
            ...(opts.commit_message ? { commit_message: opts.commit_message } : {}),
        }),
    })

    if (res.ok) {
        const b = (await res.json()) as { merged?: boolean; sha?: string; message?: string }
        return { merged: b.merged ?? true, sha: b.sha ?? null, message: b.message ?? "" }
    }

    // Pull GitHub's own message ("Pull Request is not mergeable", "Base branch
    // was modified…") so the caller can pass real detail to the user.
    const detail = await res.text().catch(() => "")
    let ghMessage = ""
    try {
        ghMessage = (JSON.parse(detail) as { message?: string }).message ?? ""
    } catch {
        ghMessage = detail.slice(0, 200)
    }
    throw new GithubMergeError(res.status, ghMessage || `merge failed (HTTP ${res.status})`)
}
