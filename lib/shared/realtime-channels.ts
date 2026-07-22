// Shared channel-name helpers so the server emitter and the client
// subscriber can't drift apart. Channel names are part of the public
// API surface of the realtime stream — keep them stable.

/** Broadcast channel that carries newly-inserted issue_suggestions
 *  rows for public issue viewers. Emitted by the server inside
 *  /api/public-issues/[id]/suggest after a successful insert.
 *  Subscribed to by components/public-issue-view.tsx. */
export function publicIssueSuggestionChannel(issueId: string): string {
    return `public-issue-suggestion:${issueId}`
}
