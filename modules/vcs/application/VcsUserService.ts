// VCS application — VcsUserService: the provider-agnostic orchestrator for
// actions taken AS THE SIGNED-IN USER (their personal token). Routes on the
// issue/PR comment tabs talk to this, never to a VcsUserInstance directly, so the
// user-authored-comment use cases have one home to grow in (e.g. later: post to
// the remote AND record locally). Today it is a thin pass-through over the port.
//
// Pure application: depends only on the VcsUserInstance port. Acquiring the
// user's token + resolving the repo is the gate/composition's job — the bound
// instance is injected in.

import type { VcsComment } from "../ports/VcsTypes"
import type { VcsUserInstance } from "../ports/VcsUserInstance"

export class VcsUserService {
    constructor(private readonly vcs: VcsUserInstance) {}

    /** Post a comment as the user on an issue/PR. */
    createComment(issueNumber: number, body: string): Promise<VcsComment> {
        return this.vcs.createComment(issueNumber, body)
    }

    /** Edit the user's own comment in place. `issueNumber` scopes it (GitLab). */
    updateComment(issueNumber: number, commentId: number, body: string): Promise<VcsComment> {
        return this.vcs.updateComment(issueNumber, commentId, body)
    }

    /** Delete the user's own comment (idempotent). `issueNumber` scopes it. */
    deleteComment(issueNumber: number, commentId: number): Promise<void> {
        return this.vcs.deleteComment(issueNumber, commentId)
    }
}
