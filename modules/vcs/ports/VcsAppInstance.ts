// VCS module — the APP-AUTHORITY provider port. `VcsAppInstance` is the vendor-
// neutral interface for operations performed as the INSTALLED APP / bot (GitHub
// App installation token today): opening/patching/deleting issues, posting bot
// comments, and reading/merging pull requests. Its sibling `VcsUserInstance`
// covers the other principal — actions taken as the signed-in USER (personal
// token). They are split because they are DIFFERENT identities with different
// credentials, rate limits, and authorization; one interface would conflate them.
//
// An instance is ALREADY BOUND to one repository + its app credentials, so the
// methods speak only in neutral nouns — no installation id, owner/repo, or the
// REST/GraphQL split leaks through. The composition root (composition.ts) is the
// one place that maps a project row → the right bound adapter.

import type {
    VcsBranch,
    VcsComment,
    VcsIssue,
    VcsIssueRef,
    VcsIssueState,
    VcsMergeInput,
    VcsMergeMethods,
    VcsMergeResult,
    VcsMergeability,
    VcsPullRequest,
    VcsPullRequestFile,
    VcsCompare,
    VcsReview,
} from "./VcsTypes"

/** The app/bot-authority operations `VcsAppService` orchestrates. An
 *  implementation is bound to a single repo + its app credentials; nothing here
 *  mentions tokens, installation ids, owner/repo, or the REST/GraphQL split. */
export interface VcsAppInstance {
    // ─── issues ─────────────────────────────────────────────────────────────
    /** Open an issue; returns the provider ids to store back on our row. */
    createIssue(input: { title: string; body?: string }): Promise<VcsIssueRef>
    /** Patch an issue's title/body/state (send only what changed). */
    updateIssue(number: number, patch: { title?: string; body?: string; state?: VcsIssueState }): Promise<void>
    /** Delete the issue, transparently falling back to closing it when the
     *  provider can't hard-delete. Accepts whichever ids we hold; no-op when
     *  neither is present. */
    deleteIssue(ref: { number: number | null; nodeId: string | null }): Promise<void>
    /** All of the repo's issues (state=all by default), for import/backfill. */
    listIssues(opts?: { state?: "open" | "closed" | "all" }): Promise<VcsIssue[]>

    // ─── issue/PR comments (as the app/bot) ─────────────────────────────────
    /** Post a bot comment on an issue or PR; returns its id so a later edit can
     *  swap it in place (e.g. the "analysing…" placeholder → result). */
    createIssueComment(issueNumber: number, body: string): Promise<{ id: number }>
    /** Edit an existing bot comment in place. `issueNumber` is the issue/PR the
     *  comment lives on — GitHub ignores it (it edits by global comment id);
     *  GitLab needs it (note edits are scoped to the issue). */
    updateIssueComment(issueNumber: number, commentId: number, body: string): Promise<void>
    /** The conversation-thread comments on an ISSUE, oldest first. */
    listIssueComments(issueNumber: number): Promise<VcsComment[]>

    // ─── PR/MR conversation comments (as the app/bot) ───────────────────────
    // Separate from the issue-comment methods because GitLab has DISTINCT note
    // endpoints for issues vs merge requests (GitHub serves both from one). GitHub
    // adapters delegate to the issue-comment impl; GitLab uses /merge_requests/.
    /** Post a bot comment on a PR/MR; returns its id for a later in-place edit. */
    createPullRequestComment(prNumber: number, body: string): Promise<{ id: number }>
    /** Edit a bot comment on a PR/MR in place. */
    updatePullRequestComment(prNumber: number, commentId: number, body: string): Promise<void>
    /** The conversation-thread comments on a PR/MR, oldest first. */
    listPullRequestComments(prNumber: number): Promise<VcsComment[]>

    // ─── branches ───────────────────────────────────────────────────────────
    /** Every branch in the repository, so a caller can OFFER them rather than
     *  ask someone to type one. Newest-activity first where the provider
     *  supports it; capped by the adapter's own pagination bound, because a
     *  repository with thousands of branches should not become a thousand-row
     *  dropdown. */
    listBranches(): Promise<VcsBranch[]>

    // ─── pull requests ──────────────────────────────────────────────────────
    listPullRequests(opts?: { state?: "open" | "closed" | "all" }): Promise<VcsPullRequest[]>
    listPullRequestFiles(number: number): Promise<VcsPullRequestFile[]>
    /** The diff and commits between two arbitrary refs, `base…head`.
     *
     *  listPullRequestFiles answers "what does this pull request change"; this
     *  answers "what did this PUSH change", which is a different question and
     *  the only one an incremental review can be scoped to. It also reports the
     *  ANCESTRY of the two refs, which is what lets a caller refuse to carry
     *  anything across a force-push. */
    compareCommits(base: string, head: string): Promise<VcsCompare>
    listPullRequestReviews(number: number): Promise<VcsReview[]>
    getMergeMethods(): Promise<VcsMergeMethods>
    getMergeability(number: number): Promise<VcsMergeability>
    mergePullRequest(number: number, input: VcsMergeInput): Promise<VcsMergeResult>
}
