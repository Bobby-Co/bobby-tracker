import { jsonError, requireUser } from "@/lib/api"

// GET /api/issues/[id]/similar
//
// Returns up to 5 owner-visible issues whose stored embedding is
// nearest (cosine) to this one's. The lookup happens entirely in
// Postgres via tracker.find_similar_to_issue — we never round-trip
// the vector through the tracker. RLS enforces ownership: the RPC
// is security-invoker and joins through tracker.issues, so any row
// the caller can't see is silently filtered.
//
// The "pending" flag tells the client whether the issue's own
// embedding row exists yet. Newly-created issues get embedded
// fire-and-forget; the client polls this endpoint with backoff
// until either similar issues land or pending stays false.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const [{ data: similar, error: rpcErr }, { data: emb }] = await Promise.all([
        supabase.rpc("find_similar_to_issue", { p_issue_id: id, p_limit: 5 }),
        supabase
            .from("issue_embeddings")
            .select("issue_id")
            .eq("issue_id", id)
            .maybeSingle<{ issue_id: string }>(),
    ])
    if (rpcErr) return jsonError("db_error", rpcErr.message, 500)

    return Response.json({
        similar: similar ?? [],
        pending: !emb,
    })
}
