// VCS module — the USER-AUTHORITY provider port. `VcsUserInstance` is the vendor-
// neutral interface for actions taken AS THE SIGNED-IN USER (their personal
// OAuth token), distinct from the app/bot principal (`VcsAppInstance`). The
// tracker uses this so comments on the issue/PR tabs are authored BY THE USER on
// the remote, not by the Bobby app.
//
// An instance is ALREADY BOUND to one repository + the user's credential, so the
// methods speak only in neutral nouns. Authentication failures surface as the
// neutral `VcsReauthError` (see vcs-types) so routes can prompt a reconnect
// without importing a GitHub-specific error.

import type { VcsComment } from "./VcsTypes"

/** The user-authority operations `VcsUserService` orchestrates. Bound to one repo
 *  + the signed-in user's credential; no tokens or owner/repo leak through. A PR
 *  is an issue for the comments API, so these serve both tabs. */
export interface VcsUserInstance {
    /** Post a comment as the user on an issue/PR; returns the created comment. */
    createComment(issueNumber: number, body: string): Promise<VcsComment>
    /** Edit the user's own comment in place; returns the updated comment. */
    updateComment(commentId: number, body: string): Promise<VcsComment>
    /** Delete the user's own comment. Idempotent — an already-deleted comment is
     *  treated as success. */
    deleteComment(commentId: number): Promise<void>
}
