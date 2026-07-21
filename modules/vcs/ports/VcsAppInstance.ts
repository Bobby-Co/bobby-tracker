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
    /** Edit an existing bot comment in place by id. */
    updateIssueComment(commentId: number, body: string): Promise<void>
    /** The conversation-thread comments on an issue/PR, oldest first. */
    listIssueComments(issueNumber: number): Promise<VcsComment[]>

    // ─── pull requests ──────────────────────────────────────────────────────
    listPullRequests(opts?: { state?: "open" | "closed" | "all" }): Promise<VcsPullRequest[]>
    listPullRequestFiles(number: number): Promise<VcsPullRequestFile[]>
    listPullRequestReviews(number: number): Promise<VcsReview[]>
    getMergeMethods(): Promise<VcsMergeMethods>
    getMergeability(number: number): Promise<VcsMergeability>
    mergePullRequest(number: number, input: VcsMergeInput): Promise<VcsMergeResult>
}
