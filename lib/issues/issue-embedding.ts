// Best-effort embedding fill for issues, so every issue — wherever it came
// from — is indexed for similarity search.
//
// "Wherever it came from" was aspirational until now: only the two hand-created
// paths (POST /api/issues, POST /api/public-issues) called this. Both GitHub
// paths — the `issues` webhook and the bulk importer in lib/github-sync.ts —
// inserted rows and never embedded them, so on a synced repo the similarity
// corpus was mostly empty. That's invisible rather than merely degraded:
// find_similar_to_issue (0015/0034) INNER JOINs issue_embeddings, so an
// unembedded issue can neither find matches nor BE found as one, and the user
// still gets a confident "no similar issues" computed over whatever subset
// happens to have vectors.
//
// Always uses the service-role client because:
//   1. The cookie-bound client may be torn down before the
//      fire-and-forget await resolves.
//   2. Public submissions have no auth cookie at all (link mode).
// RLS isn't a concern: the service-role client bypasses it, and the
// route handler has already done the relevant ownership / token
// checks before calling here.

import { createServiceClient } from "@/lib/supabase/server"
import { getAnalyser, type EmbedResult } from "@/modules/analysis"
import { issueEmbeddingText } from "@/modules/issues"

// tracker.issue_embeddings is PARTITIONED BY project_id (done for scale; the
// partitioned definition lives outside supabase/migrations, which still shows
// the older single-table shape from 0015 — don't trust that file for this
// table's real schema).
//
// Two consequences, and both are why every embed silently failed until now:
//   1. project_id is NOT NULL and is the partition key, so a row without it has
//      no partition to land in and is rejected outright.
//   2. A unique constraint on a partitioned table must include every partition
//      key column, so the only one that can exist here — and the one that does —
//      is (project_id, issue_id). Upserting `onConflict: "issue_id"` therefore
//      failed with `42P10: there is no unique or exclusion constraint matching
//      the ON CONFLICT specification`, which this module's own catch swallowed.
// Hence: always carry project_id, and always conflict on both columns.
const CONFLICT_TARGET = "project_id,issue_id"

interface MinimalIssue {
    id: string
    /** Partition key — see CONFLICT_TARGET above. Not optional: without it the
     *  write cannot be routed to a partition. */
    project_id: string
    title: string
    body: string
}

// PostgREST spelling of "issues with no embedding row": LEFT JOIN the embedding
// and keep the misses. `!left` forces the outer join (the default embed would
// inner-join and return exactly the rows we don't want), and `is null` on the
// embedded resource is how PostgREST filters on its absence.
const MISSING_EMBEDDING_SELECT = "id,project_id,title,body,issue_embeddings!left(issue_id)"

export async function embedIssueAsync(issue: MinimalIssue): Promise<void> {
    try {
        const result: EmbedResult = await getAnalyser().embed(issueEmbeddingText(issue))
        const svc = createServiceClient()
        const { error } = await svc
            .from("issue_embeddings")
            .upsert(
                {
                    issue_id: issue.id,
                    project_id: issue.project_id,
                    embedding: result.vector,
                    model: result.model,
                },
                { onConflict: CONFLICT_TARGET },
            )
        if (error) throw error
    } catch (err) {
        // Embedding failure shouldn't break issue creation — the row stays
        // unembedded until ensureIssueEmbeddings() below picks it up on a later
        // sweep. (That sweep is new: this comment used to promise "a future edit
        // / sweep" would fix it, but neither existed — PATCH still doesn't
        // re-embed, and there was no sweep at all, so a miss was permanent.)
        //
        // Log it, and note this catch has form: it hid a 100%-reproducible
        // 42P10 on every single write for weeks, so "similarity is unavailable"
        // looked like an analyser problem rather than a broken upsert. If
        // embeddings ever look absent again, read `wrangler tail` here FIRST.
        console.error(`[embedIssueAsync] failed to embed issue ${issue.id}:`, err)
    }
}

/** How many of this project's issues still have no embedding. Drives the
 *  "Embedding N issues…" chip, and tells the caller whether a sweep is worth
 *  scheduling at all. */
export async function countUnembeddedIssues(projectId: string): Promise<number> {
    const svc = createServiceClient()
    const { count, error } = await svc
        .from("issues")
        .select(MISSING_EMBEDDING_SELECT, { count: "exact", head: true })
        .eq("project_id", projectId)
        .is("issue_embeddings", null)
    if (error) {
        console.error(`[countUnembeddedIssues] ${projectId}:`, error)
        return 0
    }
    return count ?? 0
}

/** Embed up to `limit` of a project's unembedded issues, oldest first.
 *
 *  The repair path for issues that entered outside the two hand-created routes
 *  — chiefly the bulk importer, which can land hundreds of rows at once —
 *  plus any embed that failed silently.
 *
 *  BOUNDED, and re-entrant by necessity: there is no cron in this stack (the
 *  OpenNext worker has no scheduled handler), so nothing can drain a backlog on
 *  a timer. Instead each GET /api/projects/[id]/activity schedules one batch via
 *  after(), which drains the queue a little on every visit while the chip shows
 *  the remaining count going down. Two tabs open means two overlapping sweeps
 *  picking the same oldest rows; the upsert makes that harmless (idempotent, a
 *  few wasted embed calls at ~$0.00002 each), which is why this takes no lock.
 *
 *  Sequential on purpose — a repo's whole backlog fanned out at once would
 *  hammer the analyser's /embeddings endpoint for no latency benefit here. */
export async function ensureIssueEmbeddings(projectId: string, limit = 10): Promise<number> {
    const svc = createServiceClient()
    const { data, error } = await svc
        .from("issues")
        .select(MISSING_EMBEDDING_SELECT)
        .eq("project_id", projectId)
        // Oldest first so a large import drains in a stable order rather than
        // re-picking a shifting window between sweeps.
        .order("created_at", { ascending: true })
        .is("issue_embeddings", null)
        .limit(limit)
        .returns<MinimalIssue[]>()
    if (error) {
        console.error(`[ensureIssueEmbeddings] ${projectId}:`, error)
        return 0
    }
    if (!data?.length) return 0

    let filled = 0
    for (const issue of data) {
        // embedIssueAsync never throws — a row that fails stays in the backlog
        // and is retried on the next sweep. A permanently-failing issue would
        // therefore keep the chip pinned above zero rather than silently
        // vanishing, which is the honest failure mode of the two.
        await embedIssueAsync({
            id: issue.id,
            project_id: issue.project_id,
            title: issue.title ?? "",
            body: issue.body ?? "",
        })
        filled++
    }
    return filled
}
