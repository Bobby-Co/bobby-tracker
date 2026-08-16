import { ApiContext, repoRead } from "@/lib/server/http/api"
import { duplicateThreshold } from "@/modules/issues"
import { tryOrNull } from "@/lib/shared/kernel"

// GET /api/issues/[id]/similar
//
// Returns up to 5 owner-visible issues whose stored embedding is
// nearest (cosine) to this one's. The lookup happens entirely in
// Postgres via tracker.find_similar_to_issue — we never round-trip
// the vector through the tracker. RLS enforces ownership: the RPC
// is security-invoker and joins through tracker.issues, so any row
// the caller can't see is silently filtered.
//
// Three response states for the client:
//   - similar non-empty + neither flag → render the matches
//   - similar empty, pending=true       → poll again, embedder still
//                                          working on a new issue
//   - similar empty, missing=true       → no embedding will ever
//                                          come (issue created before
//                                          the embedding pipeline, or
//                                          the embedder failed
//                                          silently long enough ago
//                                          that retrying is futile)
//
// The pending → missing cutoff is age-based. The embedder fires
// inline on POST /api/issues; if the row hasn't appeared after
// PENDING_WINDOW_MS the call almost certainly failed (network /
// rate-limit / no API key) and won't retry on its own.
const PENDING_WINDOW_MS = 30_000

// Drop matches below this cosine similarity. text-embedding-3-small
// pulls everything in the same project tightly together, so the
// nearest-neighbor search will *always* return rows — sometimes at
// 5–20% similarity, which the UI honestly reports as "match" and
// confuses the user. 0.40 is the empirical floor where matches
// start to be genuinely related rather than just same-domain.
const MIN_SIMILARITY = 0.40

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, projectId, error } = await new ApiContext().requireIssueAccess(id)
    if (error) return error

    const issues = ctx.issues
    const { data: state, error: dbErr } = await repoRead(() => issues.findSimilarityState(id, 5))
    if (dbErr) return dbErr

    if (state.hasEmbedding) {
        // Two different bars, deliberately. MIN_SIMILARITY decides what is worth
        // SHOWING as related at all; the project's duplicate sensitivity decides
        // which of those we are willing to call a likely DUPLICATE. Collapsing
        // them would mean a project that wants fewer duplicate flags also loses
        // its related-issues list, which is not what anyone asked for.
        const project = await tryOrNull(() => ctx.projects.findFull(projectId))
        const dupThreshold = duplicateThreshold(project?.duplicate_sensitivity)
        // Filtered on the SERVER, not in the card. The card used to do this,
        // which meant every response carried issues it was about to hide — waste
        // here, and on the public twin of this route, titles handed to an
        // anonymous submitter that the project had said were not close enough to
        // show them. A visibility rule decided by a component is not a rule.
        //
        // MIN_SIMILARITY stays as the floor beneath every level: it is what stops
        // the top-K RPC (which has no threshold of its own) from returning
        // same-domain noise if a level is ever tuned below it.
        const bar = Math.max(MIN_SIMILARITY, dupThreshold)
        const filtered = state.similar
            .filter((r) => r.similarity >= bar)
            .map((r) => ({ ...r, isDuplicate: true }))
        return Response.json({
            similar: filtered,
            pending: false,
            missing: false,
            duplicateThreshold: dupThreshold,
        })
    }
    // No embedding row. Decide pending vs missing based on age.
    // Treat unknown issue (RLS dropped it) as missing too — the
    // client doesn't need to keep polling on a 404-equivalent.
    const ageMs = state.createdAt
        ? Date.now() - Date.parse(state.createdAt)
        : Number.POSITIVE_INFINITY
    const stillPending = Number.isFinite(ageMs) && ageMs < PENDING_WINDOW_MS
    return Response.json({
        similar: [],
        pending: stillPending,
        missing: !stillPending,
    })
}