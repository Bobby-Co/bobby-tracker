// Projects module — the ProjectContentPurge PORT.
//
// Deleting a project used to be one statement: remove the row, and the database
// cascaded everything hanging off it. That held while every table shared one
// database. It does not survive the regional split — `projects` is control-plane
// and `issues`, their comments, the PR mirror, embeddings and chat context are
// regional, so those foreign keys had to be dropped (regional-node-setup.sql).
//
// Nothing replaced them. A project delete therefore removes the row centrally and
// leaves its regional content behind: rows nobody can reach, nobody is counting,
// and no error mentions. This port is what replaces the cascade.
//
// It deliberately reaches across module boundaries — issues, comments, pull
// requests, chat context. modules/README prefers events for cross-module
// reactions, and that is right for reactions. Deletion is not a reaction: it has
// to be complete before the caller is told it succeeded, and an at-least-once
// event that lands twice-or-never is the wrong shape for "make sure this is gone".

/** What a purge removed. Returned rather than discarded so a caller can log it —
 *  a delete that silently removed nothing looks identical to one that worked. */
export interface PurgeResult {
    /** Issue ids that were removed. The caller needs these to clear the CENTRAL
     *  `issue_suggestions` rows pointing at them (0068 dropped that FK). */
    issueIds: string[]
}

export interface ProjectContentPurge {
    /** Delete every REGIONAL row belonging to a project, and report the issue ids
     *  it removed.
     *
     *  Intra-regional foreign keys still hold, so deleting `issues` takes
     *  `issue_embeddings` and `public_issue_reporters` with it. What this has to
     *  name explicitly is everything that pointed at `projects`, since those keys
     *  are gone.
     *
     *  THROWS on failure. A partial purge must not be reported as success — the
     *  caller is about to delete the project row, and once that is gone there is
     *  nothing left to find the orphans by. */
    purgeProject(projectId: string): Promise<PurgeResult>
}
