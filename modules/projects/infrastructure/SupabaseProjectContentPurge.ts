// Projects module — Supabase adapter for ProjectContentPurge. Bound to the DATA
// plane client, because everything it deletes is regional.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { ProjectContentPurge, PurgeResult } from "../ports/ProjectContentPurge"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

/** Regional tables keyed directly by `project_id` whose FK to `projects` was
 *  dropped when the planes split. `issues` is handled separately — its ids are
 *  needed afterwards, and deleting it cascades to the tables that still point at
 *  it (issue_embeddings, public_issue_reporters) via intra-regional keys that
 *  survive. */
const BY_PROJECT_ID = [
    "issue_comments",
    "pr_comments",
    "pull_requests",
    "pull_request_analyses",
    "mind_context",
    "issue_embeddings",
] as const

export class SupabaseProjectContentPurge implements ProjectContentPurge {
    constructor(private readonly db: AnyDb) {}

    async purgeProject(projectId: string): Promise<PurgeResult> {
        // Collect the issue ids BEFORE deleting anything. Once the rows are gone
        // there is no way to find the central suggestions that pointed at them,
        // and those would be orphaned in a database this purge cannot even see.
        const { data: issues, error: readErr } = await this.db
            .from("issues")
            .select("id")
            .eq("project_id", projectId)
            .returns<{ id: string }[]>()
        if (readErr) {
            throw new RepositoryError(`purge: listing issues failed: ${readErr.message}`, { cause: readErr })
        }
        const issueIds = (issues ?? []).map((i) => i.id)

        // issue_embeddings is listed explicitly rather than left to cascade from
        // `issues`. It is HASH-partitioned on project_id, so a project-scoped
        // delete prunes to one partition — far cheaper than letting the cascade
        // chase each row by issue_id across all sixteen.
        for (const table of BY_PROJECT_ID) {
            const { error } = await this.db.from(table).delete().eq("project_id", projectId)
            if (error) {
                // Fail loudly and stop. Continuing would delete some tables and
                // report success, and the caller's next act is to remove the
                // project row — after which nothing can locate what was missed.
                throw new RepositoryError(`purge: clearing ${table} failed: ${error.message}`, { cause: error })
            }
        }

        // Last, because the tables above reference it and because its own cascade
        // is what removes public_issue_reporters.
        const { error: issuesErr } = await this.db.from("issues").delete().eq("project_id", projectId)
        if (issuesErr) {
            throw new RepositoryError(`purge: clearing issues failed: ${issuesErr.message}`, { cause: issuesErr })
        }

        return { issueIds }
    }
}

/** Composition seam — callers depend on the port, never on this class. */
export function createSupabaseProjectContentPurge(db: AnyDb): ProjectContentPurge {
    return new SupabaseProjectContentPurge(db)
}
