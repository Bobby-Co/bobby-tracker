import { jsonError, requireUser } from "@/lib/api"
import type { Issue } from "@/lib/supabase/types"

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

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const [{ data: similar, error: rpcErr }, { data: emb }, { data: issue }] = await Promise.all([
        supabase.rpc("find_similar_to_issue", { p_issue_id: id, p_limit: 5 }),
        supabase
            .from("issue_embeddings")
            .select("issue_id")
            .eq("issue_id", id)
            .maybeSingle<{ issue_id: string }>(),
        supabase
            .from("issues")
            .select("created_at")
            .eq("id", id)
            .maybeSingle<Pick<Issue, "created_at">>(),
    ])
    if (rpcErr) return jsonError("db_error", rpcErr.message, 500)

    if (emb) {
        return Response.json({ similar: similar ?? [], pending: false, missing: false })
    }
    // No embedding row. Decide pending vs missing based on age.
    // Treat unknown issue (RLS dropped it) as missing too — the
    // client doesn't need to keep polling on a 404-equivalent.
    const ageMs = issue?.created_at
        ? Date.now() - Date.parse(issue.created_at)
        : Number.POSITIVE_INFINITY
    const stillPending = Number.isFinite(ageMs) && ageMs < PENDING_WINDOW_MS
    return Response.json({
        similar: [],
        pending: stillPending,
        missing: !stillPending,
    })
}
