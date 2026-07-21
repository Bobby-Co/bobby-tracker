// Issues module — PUBLIC CONTRACT (see modules/README.md). Other code imports
// the issue-text shapers from here, never the module internals (domain/)
// directly. Grows as issue logic migrates in from lib/issues/ and the analyser
// client. IssueComposeProposal is re-exported (type-only) from lib/analyser for
// callers that pair it with routingEmbeddingText.

export { issueEmbeddingText, routingEmbeddingText } from "./domain/EmbeddingText"

// ─── Issue aggregate — status lifecycle + GitHub-state mapping ───────────────
export type { IssueStatusValue, IssueState } from "./domain/Issue"
export { Issue } from "./domain/Issue"

// ─── issues repository (Phase 1: inline .from("issues") → repository) ────────
export type {
    IssuesRepository,
    NewIssue,
    IssuePatch,
    IssueSuggestContext,
    IssueDuplicateGuardRow,
    NewIssueSuggestion,
    SimilarIssue,
    IssueSimilarityState,
} from "./ports/IssuesRepository"
export { createSupabaseIssuesRepository } from "./infrastructure/SupabaseIssuesRepository"

// ─── issue embedding (semantic index maintenance) ────────────────────────────
// The EmbeddingIndex PORT + its service-role adapter, and the IssueEmbedder
// application service that owns embed-one / sweep / count. Callers obtain the
// embedder via createIssueEmbedder().
export type { EmbeddingIndex, EmbeddingUpsert, UnembeddedIssue } from "./ports/EmbeddingIndex"
export { createServiceEmbeddingIndex } from "./infrastructure/SupabaseEmbeddingIndex"
export type { EmbeddableIssue } from "./application/IssueEmbedder"
export { IssueEmbedder, createIssueEmbedder } from "./application/IssueEmbedder"

// ─── issue fix-prompt composer (renders a coding-agent prompt from an issue) ──
export type { IssuePromptInput } from "./infrastructure/IssuePrompt"
export { composeIssueFixPrompt } from "./infrastructure/IssuePrompt"

// ─── service-role issues store (GitHub-sync / analysis, incl. the issue-comment
//     mirror) — the IssueSyncStore PORT + its service-backed factory. Cross-module
//     orchestrators depend on the port so their application layer stays SDK-free.
export type {
    IssueAnalysisRow,
    IssueSyncPatch,
    ImportedIssueInsert,
    IssueSuggestionInsert,
    IssueCommentUpsert,
    IssueSyncStore,
} from "./infrastructure/IssueSyncStore"
export { createServiceIssueSyncStore } from "./infrastructure/IssueSyncStore"
