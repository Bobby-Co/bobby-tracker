// VCS module — the vendor-neutral DTOs shared by every provider port
// (VcsAppInstance, VcsUserInstance, WebhookVerifier). Kept in one place so the
// app-authority and user-authority ports speak the same nouns, and so a provider
// adapter has a single target to map its API onto.
//
// ports/ may name neutral DTOs but imports no SDK/client and no framework.

/** A VCS issue's binary lifecycle. Our richer tracker statuses map to this at the
 *  boundary (see the Issue aggregate's githubState()); a provider only has two. */
export type VcsIssueState = "open" | "closed"

/** The provider identifiers minted when an issue is created — the numeric id used
 *  by REST calls and the opaque node/global id some operations (e.g. GitHub's
 *  GraphQL delete) require. */
export interface VcsIssueRef {
    number: number
    nodeId: string
}

/** A user/bot reference as it appears on issues, PRs, comments and reviews. */
export interface VcsActor {
    login: string
    avatarUrl: string
}

/** The subset of a remote issue we read during backfill/import. */
export interface VcsIssue {
    number: number
    nodeId: string
    title: string
    body: string | null
    state: VcsIssueState
}

/** A conversation comment on an issue or PR (a PR is an issue for comments). */
export interface VcsComment {
    id: number
    body: string | null
    url: string
    author: VcsActor | null
    createdAt: string
    updatedAt: string
}

/** The subset of a remote pull request we mirror. `additions`/`deletions`/
 *  `changedFiles` are optional because the list endpoint omits them (only the
 *  single-PR read and webhook payloads carry them). */
export interface VcsPullRequest {
    number: number
    nodeId: string
    title: string
    body: string | null
    state: string
    draft: boolean
    mergedAt: string | null
    url: string
    author: VcsActor | null
    head: { ref: string; sha: string }
    base: { ref: string; sha: string }
    additions?: number
    deletions?: number
    changedFiles?: number
    comments?: number
    createdAt: string
    updatedAt: string
    closedAt: string | null
}

/** A single changed file on a PR (with its unified patch, when available). */
export interface VcsPullRequestFile {
    filename: string
    previousFilename?: string
    status: string
    patch?: string
    additions: number
    deletions: number
}

/** One commit in a compared range. `message` is the FULL commit message; the
 *  surfaces take the subject from it, because a provider that returns only a
 *  subject and one that returns the whole body should not produce two different
 *  round records. */
export interface VcsCommitSummary {
    sha: string
    message: string
    /** The author's provider login where the provider resolves one, else the
     *  name from the commit itself, else null. */
    author: string | null
    /** ISO-8601, or null when the provider omits it. */
    committedAt: string | null
}

/** How one ref relates to another, as the provider reports it.
 *
 *  `unknown` is a real answer, not a failure: some providers do not compute it,
 *  and a caller that needs the relationship PROVED must treat "unknown" the same
 *  way it treats "diverged" rather than assuming the convenient reading. */
export type VcsCompareStatus = "identical" | "ahead" | "behind" | "diverged" | "unknown"

/** The diff and the commits between two refs — `base…head`.
 *
 *  Distinct from listPullRequestFiles, which always compares the pull request's
 *  base against its head. This one compares whatever two commits you name, which
 *  is what makes "review the push, not the pull request" expressible at all. */
export interface VcsCompare {
    /** From the BASE's point of view: "ahead" means head is ahead of base, i.e.
     *  base IS an ancestor of head and nothing was rewritten. */
    status: VcsCompareStatus
    aheadBy: number
    behindBy: number
    files: VcsPullRequestFile[]
    commits: VcsCommitSummary[]
    /** The provider truncated the range (GitHub caps compare at 300 files / 250
     *  commits). A truncated file list is NOT a complete picture of the push, so
     *  a caller scoping a review to it must fall back. */
    truncated: boolean
}

/** A PR review summary. Only reviews with a non-empty body read as comments. */
export interface VcsReview {
    id: number
    body: string | null
    url: string
    author: VcsActor | null
    state: string
    submittedAt: string | null
}

/** Which merge strategies the repo permits (a provider 405s a disabled one). */
export interface VcsMergeMethods {
    mergeCommit: boolean
    squash: boolean
    rebase: boolean
}

/** The provider's live mergeability signal for one PR. `mergeable` is null while
 *  the provider is still computing it — treat null as "unknown", not "no". */
export interface VcsMergeability {
    mergeable: boolean | null
    mergeableState: string | null
    headSha: string | null
    draft: boolean
    state: string
    merged: boolean
}

/** How to merge a PR. `sha`, when set, makes the provider reject the merge if the
 *  head has moved since the caller last saw it. */
export interface VcsMergeInput {
    method: "merge" | "squash" | "rebase"
    sha?: string
    commitTitle?: string
    commitMessage?: string
}

export interface VcsMergeResult {
    merged: boolean
    sha: string | null
    message: string
}

/** A merge the provider refused, carrying the provider's HTTP status so callers
 *  can map the well-known ones (405 not-mergeable, 409 head-moved, 403 no-write)
 *  to specific messages. Provider-neutral so the merge route never imports a
 *  GitHub-specific error type. */
export class VcsMergeError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message)
        this.name = "VcsMergeError"
    }
}

/** The caller's VCS credential is missing / insufficient / rejected. Routes turn
 *  this into a `*_reauth_required` 401 so the UI can prompt a reconnect. Neutral
 *  so the comment routes don't import a GitHub-specific error. */
export class VcsReauthError extends Error {
    constructor(message = "vcs reauth required") {
        super(message)
        this.name = "VcsReauthError"
    }
}

/** One branch in the remote repository.
 *
 *  Listed so tracking a branch for indexing is a CHOICE rather than a typed
 *  string: the name becomes a graph key and an exact-match lookup, so a typo is
 *  a branch that indexes nothing or refuses to index at all. */
export interface VcsBranch {
    name: string
    /** Head commit sha where the provider supplies one. */
    sha: string | null
    /** The repository's default branch, which is already indexed as the
     *  project's own graph and so must not be offered as an extra one. */
    isDefault: boolean
    /** Protected by the provider's branch rules. Used as the SUGGESTED set to
     *  index: a protected branch is one a team has said matters, which is a
     *  better default than "none" and a far better one than "all". */
    isProtected: boolean
}
