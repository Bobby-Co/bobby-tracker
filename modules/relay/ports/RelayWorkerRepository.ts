// Relay module — the relay_workers persistence PORT. The signed-in user's
// analyser workers (RLS-scoped to the owner). The interface layer reads/writes
// them through this contract instead of querying the table directly.

/** The relay_workers row the workers UI reads (owner-scoped by RLS). */
export interface RelayWorkerRow {
    id: string
    user_id: string
    name: string
    endpoint: string | null
    /** jsonb; the caller narrows it to RelayModel[]. */
    models: unknown
    created_at: string
    last_seen_at: string | null
}

export interface RelayWorkerRepository {
    /** The caller's active (non-revoked) workers, newest first. THROWS
     *  RepositoryError on a query failure (the route surfaces a db_error 500). */
    listActive(): Promise<RelayWorkerRow[]>

    /** Rename a worker (RLS scopes the update to the owner, so a foreign id
     *  matches no rows). Throws on failure. */
    rename(id: string, name: string): Promise<void>

    /** Revoke a worker by stamping revoked_at now (RLS scopes to the owner).
     *  Throws on failure. */
    revoke(id: string): Promise<void>
}
