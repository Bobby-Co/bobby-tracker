// Issues module — PUBLIC CONTRACT (see modules/README.md). Other code imports
// the issue-text shapers from here, never the module internals (domain/)
// directly. Grows as issue logic migrates in from lib/issues/ and the analyser
// client. IssueComposeProposal is re-exported (type-only) from lib/analyser for
// callers that pair it with routingEmbeddingText.

export { issueEmbeddingText, routingEmbeddingText } from "./domain/embedding-text"

// ─── Issue aggregate — status lifecycle + GitHub-state mapping ───────────────
export type { IssueStatusValue, IssueState } from "./domain/issue"
export { Issue } from "./domain/issue"

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
} from "./ports/issues-repository"
export { createSupabaseIssuesRepository } from "./infrastructure/supabase-issues-repository"

// ─── issue-comment mirror store (tracker's copy of GitHub issue comments) ────
export type { IssueCommentUpsert } from "./infrastructure/issue-store"
export { upsertIssueComment, deleteIssueComment } from "./infrastructure/issue-store"

// ─── issue embedding (semantic index maintenance) ────────────────────────────
export { embedIssueAsync, countUnembeddedIssues, ensureIssueEmbeddings } from "./infrastructure/issue-embedding"

// ─── issue fix-prompt composer (renders a coding-agent prompt from an issue) ──
export type { IssuePromptInput } from "./infrastructure/issue-prompt"
export { composeIssueFixPrompt } from "./infrastructure/issue-prompt"

// ─── service-role issue ops for the GitHub-sync / analysis flow ──────────────
// The IssueSyncStore PORT + its service-backed factory are the shape cross-module
// orchestrators (vcs, analysis) depend on so their application layer stays
// SDK-free; the free functions remain for the existing infrastructure callers.
export type { IssueAnalysisRow, IssueSyncPatch, ImportedIssueInsert, IssueSuggestionInsert, IssueSyncStore } from "./infrastructure/issue-sync-store"
export {
    findIssueAnalysisRow,
    listLinkedGithubNumbers,
    updateIssueSyncFields,
    insertImportedIssue,
    countIssueSuggestions,
    insertIssueSuggestion,
    createServiceIssueSyncStore,
} from "./infrastructure/issue-sync-store"
