// Issues module — PUBLIC CONTRACT (see modules/README.md). Other code imports
// the issue-text shapers from here, never the module internals (domain/)
// directly. Grows as issue logic migrates in from lib/issues/ and the analyser
// client. IssueComposeProposal is re-exported (type-only) from lib/analyser for
// callers that pair it with routingEmbeddingText.

export { issueEmbeddingText, routingEmbeddingText } from "./domain/embedding-text"
