// VCS bounded context — PUBLIC CONTRACT (see modules/README.md).
//
// The provider-agnostic VCS aggregate: the VCSApp/User instance ports + their
// GitHub adapters, the app-level webhook verifier, the app/user services, and the
// Issue-sync + Pull-Request domains that can't exist without a VCS. Explicit
// exports only: the crypto helpers, low-level REST DTOs, and comment-body
// renderers are module INTERNALS and are NOT part of this contract.

// domain
export type { RepoRef } from "./domain/repo-ref"
export { repoFullName, blobUrl } from "./domain/repo-ref"

// ─── Pull Requests (moved in: a PR can't exist without a VCS) ────────────────
// finding-state is a SHARED pure classifier re-exported for callers that reach
// for it via the VCS contract.
export type { FindingState } from "@/lib/rendering/finding-state"
export { findingState } from "@/lib/rendering/finding-state"
// PullRequest aggregate + merge policy (domain)
export type { PullRequestState, PullRequestLifecycle } from "./domain/pull-request"
export { PullRequest } from "./domain/pull-request"
export type { MergeMethod, MergeMethods, MergeGate, MergeBlock, MergeBlockCode } from "./domain/merge-gate"
export { mergeGate, criticalFindingCount, defaultMergeMethod, MERGE_METHOD_LABEL } from "./domain/merge-gate"
// PR mirror — repository port + service (backfill runs through VCSAppInstance).
// The PR-analysis flow now lives in modules/analysis.
export type { PullRequestStore, PRUpsert, PRCommentUpsert, PRCommentSource } from "./ports/pull-request-store"
export { createServicePullRequestStore } from "./infrastructure/supabase-pull-request-store"
export { PullRequestService } from "./application/pull-request-service"

// ─── VCS provider abstraction (provider-agnostic; GitHub is one adapter) ─────
// Ports split by AUTHORITY: VCSAppInstance (installed-app/bot) and VCSUserInstance
// (signed-in user's personal token) are different principals, plus the app-level
// WebhookVerifier. Callers depend on these ports + the shared neutral DTOs and
// obtain implementations via the composition resolvers — never constructing an
// adapter directly.
export type { VCSAppInstance } from "./ports/vcs-app-instance"
export type { VCSUserInstance } from "./ports/vcs-user-instance"
export type { WebhookVerifier } from "./ports/webhook-verifier"
export type {
    VcsIssueState,
    VcsIssueRef,
    VcsActor,
    VcsIssue,
    VcsComment,
    VcsPullRequest,
    VcsPullRequestFile,
    VcsReview,
    VcsMergeMethods,
    VcsMergeability,
    VcsMergeInput,
    VcsMergeResult,
} from "./ports/vcs-types"
export { VcsMergeError, VcsReauthError } from "./ports/vcs-types"
export type { VcsProviderBinding, VcsRepoCoords } from "./composition"
export {
    resolveVcsAppInstance,
    resolveVcsUserInstance,
    getWebhookVerifier,
    getVcsAppService,
    getVcsUserService,
    getPullRequestService,
    getPullRequestServiceForProject,
    importExistingIssues,
} from "./composition"

// ─── application services (provider-agnostic orchestration) ──────────────────
export { VCSAppService } from "./application/vcs-app-service"
export type { SyncIssueInput, IssueChangeSet, ImportContext } from "./application/vcs-app-service"
export { VCSUserService } from "./application/vcs-user-service"

// domain
export { syncHash } from "./domain/sync-hash"

// The GitHub App HTTP transport (a class), exposed as a shared singleton for the
// install/link flow (callback + github-sync/link routes) — GitHub-App-installation
// ops that predate a repo binding. Everything else reaches GitHub via the
// VCSAppInstance adapter + the WebhookVerifier port, not this client.
export { githubAppClient } from "./infrastructure/github-app-instance"

// The signed-in user's GitHub token read (a repository). The comment CRUD is
// encapsulated behind the VCSUserInstance/VCSUserService; only the token read
// stays public (the /github/connection route + the comment gate use it).
export type { GithubTokenRepository, UserGithub } from "./infrastructure/user-token"
export { createGithubTokenRepository } from "./infrastructure/user-token"

// Comment-authoring gate for the PR/issue comment routes
export { resolveCommentContext } from "./infrastructure/comment-actions"
