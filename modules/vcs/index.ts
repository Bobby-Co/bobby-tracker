// VCS bounded context — PUBLIC CONTRACT (see modules/README.md).
//
// The provider-agnostic VCS aggregate: the app/user instance ports + their
// GitHub adapters, the app-level webhook verifier, the app/user services, and the
// Issue-sync + Pull-Request domains that can't exist without a VCS. Explicit
// exports only: the crypto helpers, low-level REST DTOs, and comment-body
// renderers are module INTERNALS and are NOT part of this contract.

// domain
export type { RepoRefFields } from "./domain/RepoRef"
export { RepoRef } from "./domain/RepoRef"

// ─── Pull Requests (moved in: a PR can't exist without a VCS) ────────────────
// finding-state is a SHARED pure classifier re-exported for callers that reach
// for it via the VCS contract.
export type { FindingState } from "@/lib/shared/rendering/finding-state"
export { findingState } from "@/lib/shared/rendering/finding-state"
// PullRequest aggregate + merge policy (domain)
export type { PullRequestState, PullRequestLifecycle } from "./domain/PullRequest"
export { PullRequest } from "./domain/PullRequest"
export type { MergeMethod, MergeMethods, MergeGate, MergeBlock, MergeBlockCode } from "./domain/MergeGate"
export { MergePolicy, MERGE_METHOD_LABEL } from "./domain/MergeGate"
// PR mirror — repository port + service (backfill runs through VcsAppInstance).
// The PR-analysis flow now lives in modules/analysis.
export type { PullRequestStore, PrUpsert, PrCommentUpsert, PrCommentSource } from "./ports/PullRequestStore"
export { createServicePullRequestStore } from "./infrastructure/SupabasePullRequestStore"

// RLS-scoped read side of the PR mirror (the PR tab routes)
export type { PullRequestReadRepository, CommentOwnership } from "./ports/PullRequestReadRepository"
export { createSupabasePullRequestReadRepository } from "./infrastructure/SupabasePullRequestReadRepository"
export { PullRequestService } from "./application/PullRequestService"

// ─── VCS provider abstraction (provider-agnostic; GitHub is one adapter) ─────
// Ports split by AUTHORITY: VcsAppInstance (installed-app/bot) and VcsUserInstance
// (signed-in user's personal token) are different principals, plus the app-level
// WebhookVerifier. Callers depend on these ports + the shared neutral DTOs and
// obtain implementations via the composition resolvers — never constructing an
// adapter directly.
export type { VcsAppInstance } from "./ports/VcsAppInstance"
export type { VcsUserInstance } from "./ports/VcsUserInstance"
export type { WebhookVerifier } from "./ports/WebhookVerifier"
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
} from "./ports/VcsTypes"
export { VcsMergeError, VcsReauthError } from "./ports/VcsTypes"
export type { VcsProviderBinding, VcsRepoCoords } from "./Composition"
export {
    resolveVcsAppInstance,
    resolveVcsUserInstance,
    getWebhookVerifier,
    getVcsAppService,
    getVcsUserService,
    getPullRequestService,
    getPullRequestServiceForProject,
    importExistingIssues,
} from "./Composition"

// ─── application services (provider-agnostic orchestration) ──────────────────
export { VcsAppService } from "./application/VcsAppService"
export type { SyncIssueInput, IssueChangeSet, ImportContext } from "./application/VcsAppService"
export { VcsUserService } from "./application/VcsUserService"

// domain
export { SyncHash } from "./domain/SyncHash"

// The GitHub App HTTP transport (a class), exposed as a shared singleton for the
// install/link flow (callback + github-sync/link routes) — GitHub-App-installation
// ops that predate a repo binding. Everything else reaches GitHub via the
// VcsAppInstance adapter + the WebhookVerifier port, not this client.
export { githubAppClient } from "./infrastructure/GithubVcsAppInstance"

// The signed-in user's GitHub token read (a repository). The comment CRUD is
// encapsulated behind the VcsUserInstance/VcsUserService; only the token read
// stays public (the /github/connection route + the comment gate use it).
export type { GithubTokenRepository, UserGithub } from "./infrastructure/GithubTokenRepository"
export { createGithubTokenRepository } from "./infrastructure/GithubTokenRepository"

// The signed-in user's per-provider OAuth token (provider_tokens, migration
// 0055) — the multi-provider sibling of github_tokens. GitLab lives here; the
// connections route + repo-listing read it, the OAuth callback writes it.
export type {
    ProviderTokenRepository,
    ProviderAuthKind,
    GitlabConnection,
    UserProviderToken,
    ProviderTokenUpsert,
} from "./infrastructure/ProviderTokenRepository"
export { createProviderTokenRepository } from "./infrastructure/ProviderTokenRepository"

// Comment-authoring gate for the PR/issue comment routes
export { CommentActions } from "./infrastructure/CommentActions"
