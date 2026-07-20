// Issues module — PUBLIC CONTRACT (see modules/README.md). Other code imports
// the issue-text shapers from here, never the module internals (domain/)
// directly. Grows as issue logic migrates in from lib/issues/ and the analyser
// client. IssueComposeProposal is re-exported (type-only) from lib/analyser for
// callers that pair it with routingEmbeddingText.

export { issueEmbeddingText, routingEmbeddingText } from "./domain/embedding-text"

// ─── issues repository (Phase 1: inline .from("issues") → repository) ────────
export type { IssuesRepository } from "./ports/issues-repository"
export { createSupabaseIssuesRepository } from "./infrastructure/supabase-issues-repository"

// ─── issue-comment mirror store (tracker's copy of GitHub issue comments) ────
export type { IssueCommentUpsert } from "./infrastructure/issue-store"
export { upsertIssueComment, deleteIssueComment } from "./infrastructure/issue-store"
