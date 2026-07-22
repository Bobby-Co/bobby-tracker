// The Project domain object — the projects context's aggregate.
//
// It concentrates the GitHub-sync INVARIANTS that were, before this, re-derived
// as ad-hoc predicates scattered across other modules: `syncReady` in
// github-sync, an identical `prReady` in pr-sync (and inline again in
// pr-backfill), plus `allowsInbound`/`allowsOutbound` and a bare
// `github_sync_deletes` read. Those are all rules ABOUT a project — so they
// belong to the project, in one place, expressed as behaviour.
//
// Pure domain: no I/O, no framework, no SDK. `SyncDirection` is kept local (not
// imported from @/lib/shared/types) so the aggregate carries no persistence
// dependency; a drift guard in ../infrastructure keeps it aligned with the DB.

export type SyncDirection = "inbound" | "outbound" | "both"

/** The persisted project state the invariants read. Every field is optional so
 *  the aggregate can be built from any of the projections the repository returns
 *  (some carry the direction, some only the sync-readiness fields); each method
 *  reads just what it needs and is robust to the rest being absent. */
export interface ProjectSyncState {
    github_sync_enabled?: boolean
    github_installation_id?: number | null
    github_repo_id?: number | null
    github_sync_direction?: SyncDirection
    github_sync_deletes?: boolean
}

export class Project {
    private constructor(private readonly state: ProjectSyncState) {}

    /** Build the aggregate from a persisted project's sync state. */
    static of(state: ProjectSyncState): Project {
        return new Project(state)
    }

    /** Sync is fully wired: toggled on AND linked to a GitHub App installation
     *  AND a repo id. The precondition for any push / pull / analysis-comment
     *  work — a project missing any of the three is a silent no-op. */
    isSyncReady(): boolean {
        return (
            this.state.github_sync_enabled === true &&
            this.state.github_installation_id != null &&
            this.state.github_repo_id != null
        )
    }

    /** Issues may flow GitHub → tracker (webhook ingest). */
    allowsInbound(): boolean {
        const d = this.state.github_sync_direction
        return d === "inbound" || d === "both"
    }

    /** Issues may flow tracker → GitHub (outbound push). */
    allowsOutbound(): boolean {
        const d = this.state.github_sync_direction
        return d === "outbound" || d === "both"
    }

    /** A delete/close on one side mirrors to the other (destructive; default off). */
    propagatesDeletes(): boolean {
        return this.state.github_sync_deletes === true
    }
}
