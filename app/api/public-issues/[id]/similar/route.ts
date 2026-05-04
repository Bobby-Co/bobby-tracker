import { createServiceClient } from "@/lib/supabase/server"
import { fetchPublicIssue, requireInviteAccess, requireOwnVisibility, resolvePublicSession } from "@/lib/public-session"
import type { Issue, IssueEmbedding } from "@/lib/supabase/types"

interface SimilarRow {
    id: string
    issue_number: number
    title: string
    status: string
    similarity: number
}

// GET /api/public-issues/[id]/similar?token=<session_token>
//
// Read-only counterpart to the authenticated endpoint. Returns up to
// 5 nearest neighbors, but ONLY among issues that are themselves
// public-session submissions on a project this session covers — we
// don't want to leak the maintainer's internal issues into the
// public similarity panel.
//
// Auth + visibility checks are the same gauntlet the public detail
// page already runs: token-resolves, invite-mode access (if any),
// own-visibility (if any). Reuses the resolvePublicSession +
// fetchPublicIssue + requireInviteAccess + requireOwnVisibility
// chain so we can't drift from the page-level rules.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const url = new URL(request.url)
    const token = (url.searchParams.get("token") || "").trim()

    const svc = createServiceClient()
    const sess = await resolvePublicSession(svc, token, { requireOpen: false })
    if (sess.error) return sess.error

    const inviteErr = await requireInviteAccess(sess.session)
    if (inviteErr) return inviteErr

    const visErr = await requireOwnVisibility(svc, sess.session, id)
    if (visErr) return visErr

    const found = await fetchPublicIssue(svc, id, sess.session.project_ids)
    if (found.error) return found.error
    const issue = found.issue

    const { data: emb } = await svc
        .from("issue_embeddings")
        .select("embedding")
        .eq("issue_id", id)
        .maybeSingle<Pick<IssueEmbedding, "embedding">>()
    if (!emb) {
        // Pending vs missing — same age cutoff as the auth-side
        // route. Old issues never embedded should short-circuit
        // to "missing" so the client doesn't sit on a spinner
        // for nothing.
        const PENDING_WINDOW_MS = 30_000
        const ageMs = Date.now() - Date.parse(issue.created_at)
        const stillPending = Number.isFinite(ageMs) && ageMs < PENDING_WINDOW_MS
        return Response.json({
            similar: [],
            pending: stillPending,
            missing: !stillPending,
        })
    }

    // Service-role client bypasses RLS, so we have to scope the
    // similarity scan ourselves: same project, public-session-
    // labelled issues only, exclude the source. This is a tight
    // mirror of the page-level fetchPublicIssue gate but for many
    // rows at once.
    type ProbeIssue = Pick<Issue, "id" | "issue_number" | "title" | "status" | "labels" | "duplicate_of_issue_id">
    const { data: pool } = await svc
        .from("issues")
        .select("id,issue_number,title,status,labels,duplicate_of_issue_id")
        .eq("project_id", issue.project_id)
        .neq("id", id)
        .is("duplicate_of_issue_id", null)
        .contains("labels", ["public-session"])
        .returns<ProbeIssue[]>()
    const candidateIds = (pool ?? []).map((p) => p.id)
    if (candidateIds.length === 0) {
        return Response.json({ similar: [], pending: false, missing: false })
    }

    // pgvector ordering on the candidate set. We keep this scan
    // narrow (public-session subset, single project) so the brute-
    // force cosine on the JS side stays well below 200 rows in
    // realistic deployments. If/when this gets large we can swap
    // to an RPC that takes (project_id, exclude_id, labels[],
    // embedding) and uses the HNSW index.
    const { data: vectors } = await svc
        .from("issue_embeddings")
        .select("issue_id,embedding")
        .in("issue_id", candidateIds)
        .returns<{ issue_id: string; embedding: number[] }[]>()
    if (!vectors || vectors.length === 0) {
        return Response.json({ similar: [], pending: false, missing: false })
    }

    const target = emb.embedding
    const ranked: SimilarRow[] = []
    for (const v of vectors) {
        const meta = (pool ?? []).find((p) => p.id === v.issue_id)
        if (!meta) continue
        ranked.push({
            id: meta.id,
            issue_number: meta.issue_number,
            title: meta.title,
            status: meta.status,
            similarity: cosineSimilarity(target, v.embedding),
        })
    }
    ranked.sort((a, b) => b.similarity - a.similarity)
    const top = ranked.slice(0, 5)

    return Response.json({ similar: top, pending: false, missing: false })
}

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0
    let dot = 0
    let aMag = 0
    let bMag = 0
    for (let i = 0; i < a.length; i++) {
        const av = a[i]
        const bv = b[i]
        dot += av * bv
        aMag += av * av
        bMag += bv * bv
    }
    const denom = Math.sqrt(aMag) * Math.sqrt(bMag)
    return denom === 0 ? 0 : dot / denom
}
