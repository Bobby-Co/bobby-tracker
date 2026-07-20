// Issues module — repository PORT for tracker.issues. Part of the modular-DDD
// Phase 1 work (see modules/README.md): moving inline .from("issues") behind a
// repository, one cohesive method at a time.
//
// ports/ may TYPE-reference the shared DB row type (no SDK/client here); the
// Supabase implementation lives in ../infrastructure.

import type { Issue } from "@/lib/supabase/types"

export interface IssuesRepository {
    /** The project an issue belongs to — the datum the /api/issues/[id]/** authz
     *  gate needs. Null when the issue is absent/invisible (the injected client
     *  carries the caller's RLS scope). Throws {@link RepositoryError} on a query
     *  failure — a fail-safe caller folds that to null with `tryOrNull`. */
    findProjectId(issueId: string): Promise<string | null>

    /** The full issue row by id, or null when absent. Throws on query failure. */
    findById(issueId: string): Promise<Issue | null>

    /** Delete an issue by id. Throws {@link RepositoryError} on failure. */
    deleteById(issueId: string): Promise<void>
}
