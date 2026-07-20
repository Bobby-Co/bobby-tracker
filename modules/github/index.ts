// GitHub bounded context — PUBLIC CONTRACT (see modules/README.md).
//
// Anti-corruption layer over the GitHub App / REST / GraphQL APIs plus the
// tracker⇄GitHub issue-sync orchestration. Explicit exports only: the crypto
// helpers, the low-level REST DTOs, and the comment-body renderers are module
// INTERNALS and are intentionally NOT part of this contract.

// domain
export type { RepoRef } from "./domain/repo-ref"
export { repoFullName, blobUrl } from "./domain/repo-ref"

// App auth / webhook
export { githubAppFetch, githubJwtFetch, verifyWebhookSignature } from "./infrastructure/github-app"

// REST helpers used by callers outside the module
export { GithubMergeError } from "./infrastructure/github-app-rest"
export type { GithubPullRequest } from "./infrastructure/github-app-rest"
export {
    createIssueComment,
    updateIssueComment,
    listPullRequestFiles,
    listPullRequests,
    listIssueComments,
    listPullRequestReviews,
    getRepoMergeMethods,
    getPullMergeability,
    mergePullRequest,
} from "./infrastructure/github-app-rest"

// User-token GitHub actions
export { GithubReauthError } from "./infrastructure/github-user"
export {
    getUserGithubToken,
    createUserIssueComment,
    updateUserIssueComment,
    deleteUserIssueComment,
} from "./infrastructure/github-user"

// Issue-sync orchestration
export {
    allowsInbound,
    syncHash,
    stateToStatus,
    pushIssueToGithub,
    updateGithubIssueFromTracker,
    deleteGithubIssueFromTracker,
    ensureAnalysis,
    applyAnalysisResult,
    cancelAnalysis,
    importExistingIssues,
} from "./infrastructure/github-sync"

// Comment-authoring gate for the PR/issue comment routes
export { resolveCommentContext } from "./infrastructure/comment-actions"
