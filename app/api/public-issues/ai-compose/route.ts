import { jsonError } from "@/lib/api"
import { createServiceClient } from "@/lib/supabase/server"
import { AnalyserError, composeIssue, embedText, routingEmbeddingText } from "@/lib/analyser"
import { requireInviteAccess, resolvePublicSession } from "@/lib/public-session"

// POST /api/public-issues/ai-compose
//
// Body: { token, paragraph, images?: string[], project_id? }
//
// Two flavours, picked by the session shape:
//
//   - Manual-list session (group_id is null, project_id required):
//     compose the draft for the picked project and return
//     `{ proposal }` only. No routing — the user already chose a
//     target.
//
//   - Group-backed session (group_id set, project_id optional and
//     ignored): compose, embed the draft, and call
//     find_similar_projects across the group's members. Return
//     `{ proposal, ranking }` so the public form can show a routing
//     panel exactly like the auth-side group flow.
//
// All AI inference happens in bobby-analyser. The tracker enforces
// session resolution + invite-mode access before paying for any
// upstream call so a stranger can't burn quota.
export async function POST(request: Request) {
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const token = String(body?.token ?? "").trim()
    const project_id = String(body?.project_id ?? "").trim()
    const paragraph = typeof body?.paragraph === "string" ? body.paragraph : ""
    const rawImages = Array.isArray(body?.images) ? body.images : []
    const images = rawImages
        .filter((x: unknown): x is string => typeof x === "string" && x.startsWith("data:image/"))
        .slice(0, 6)

    if (!paragraph.trim() && images.length === 0) {
        return jsonError("bad_request", "Provide a paragraph or at least one image.", 400)
    }

    const svc = createServiceClient()
    const sess = await resolvePublicSession(svc, token, { requireOpen: true })
    if (sess.error) return sess.error

    const inviteErr = await requireInviteAccess(sess.session)
    if (inviteErr) return inviteErr

    const isGroupBacked = !!sess.session.group_id
    if (!isGroupBacked) {
        // Manual mode: same shape as before — caller must pick a
        // project, we forward to compose, no routing.
        if (!project_id) return jsonError("bad_request", "project_id required", 400)
        if (!sess.session.project_ids.includes(project_id)) {
            return jsonError("bad_request", "this project isn't part of the session", 400)
        }
        try {
            const proposal = await composeIssue({ paragraph, images })
            return Response.json({ proposal, ranking: null })
        } catch (e) {
            if (e instanceof AnalyserError) return jsonError(e.code, e.message, 502)
            return jsonError("ai_failed", e instanceof Error ? e.message : String(e), 502)
        }
    }

    // Group-backed mode: compose first, then embed + rank against
    // the group's members. project_id is ignored even when supplied
    // — the routing UI is the source of truth on the client.
    const projectIds = sess.session.project_ids
    if (projectIds.length === 0) {
        return jsonError("bad_request", "this session's group has no eligible projects", 400)
    }

    let proposal
    try {
        proposal = await composeIssue({ paragraph, images })
    } catch (e) {
        if (e instanceof AnalyserError) return jsonError(e.code, e.message, 502)
        return jsonError("ai_failed", e instanceof Error ? e.message : String(e), 502)
    }

    const routingQuery = routingEmbeddingText(proposal)
    let queryVec: number[]
    try {
        const embed = await embedText(routingQuery)
        queryVec = embed.vector
    } catch (e) {
        if (e instanceof AnalyserError) return jsonError(e.code, e.message, 502)
        return jsonError("ai_failed", e instanceof Error ? e.message : String(e), 502)
    }

    interface RankRow {
        project_id:  string
        similarity:  number
        main_sim:    number | null
        layer_sim:   number | null
        feature_sim: number | null
        tag_sim:     number | null
    }
    const { data: ranked, error: rpcErr } = await svc
        .rpc("find_similar_projects", {
            p_query_embedding: queryVec,
            p_project_ids:     projectIds,
            p_limit:           projectIds.length,
        })
    if (rpcErr) return jsonError("db_error", rpcErr.message, 500)

    // Hydrate project names + analyser readiness so the public form
    // can render a routing panel without a second round-trip. Only
    // pulls fields we'd surface anyway — service-role here mirrors
    // what resolvePublicSession already trusts.
    type ProjectMeta = {
        id: string
        name: string
        project_analyser?: { status?: string; enabled?: boolean; graph_id?: string | null } | { status?: string; enabled?: boolean; graph_id?: string | null }[] | null
    }
    const { data: projectMeta } = await svc
        .from("projects")
        .select("id,name,project_analyser(status,enabled,graph_id)")
        .in("id", projectIds)
        .returns<ProjectMeta[]>()
    const metaById = new Map<string, { name: string; analyser_ready: boolean }>()
    for (const m of projectMeta ?? []) {
        const a = Array.isArray(m.project_analyser) ? m.project_analyser[0] : m.project_analyser
        const ready = !!a && a.enabled === true && a.status === "ready" && !!a.graph_id
        metaById.set(m.id, { name: m.name, analyser_ready: ready })
    }
    const rankByProject = new Map<string, RankRow>()
    for (const r of (ranked as RankRow[] | null) ?? []) {
        rankByProject.set(r.project_id, r)
    }
    const ranking = projectIds
        .map((id) => {
            const meta = metaById.get(id)
            const score = rankByProject.get(id)
            const hasAnyDimension = !!score && (
                (score.main_sim ?? 0) > 0 ||
                (score.layer_sim ?? 0) > 0 ||
                (score.feature_sim ?? 0) > 0
            )
            return {
                project_id:     id,
                project_name:   meta?.name ?? "",
                analyser_ready: meta?.analyser_ready ?? false,
                has_summary:    hasAnyDimension,
                similarity:     score?.similarity ?? 0,
                breakdown: score ? {
                    main:    score.main_sim,
                    layer:   score.layer_sim,
                    feature: score.feature_sim,
                } : null,
            }
        })
        .filter((r) => r.project_name)
        .sort((a, b) => {
            if (a.has_summary !== b.has_summary) return a.has_summary ? -1 : 1
            return b.similarity - a.similarity
        })

    return Response.json({ proposal, ranking, routing_query: routingQuery })
}
