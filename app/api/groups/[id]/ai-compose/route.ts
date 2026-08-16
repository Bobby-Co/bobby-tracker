import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import { AnalyserError, getAnalyser, ProjectAnalyser } from "@/modules/analysis"
import { EmbeddingText } from "@/modules/issues"

// POST /api/groups/[id]/ai-compose
//
// Body: { paragraph, images?: string[] }
//
// Compose + route in one round-trip:
//
//   1. Forward paragraph + images to bobby-analyser /issues/compose
//      → structured draft (title/body/priority/labels/layer/features
//      /action/scope/routing_summary).
//   2. Embed ONE query vector from routing_summary + the proposal's
//      layer + feature tags joined into a maintainer-voice phrase.
//   3. tracker.find_similar_projects(query, group_member_ids):
//        main_sim (cosine vs project_main_embedding)  — 70%
//        tag_sim  (max cosine vs project tag pools)   — 30%
//      → final = 0.7 * main_sim + 0.3 * tag_sim
//
// The main embedding carries "what is this project" globally; the
// tag pool refinement boosts projects that contain a specific match
// for the issue's layer or feature. Returns proposal + ranking[].
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    // Collection authorization. Was requireUser, relying on RLS to null out
    // findSummary for a non-member — the same backstop the issues feed leaned on.
    // This reads every member project's name and ranks them, so an unguarded call
    // discloses another team's project list.
    const { ctx, error } = await new ApiContext().requireCollectionAccess(id)
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const paragraph = typeof body?.paragraph === "string" ? body.paragraph : ""
    const rawImages = Array.isArray(body?.images) ? body.images : []
    const images = rawImages
        .filter((x: unknown): x is string => typeof x === "string" && x.startsWith("data:image/"))
        .slice(0, 6)
    if (!paragraph.trim() && images.length === 0) {
        return jsonError("bad_request", "Provide a paragraph or at least one image.", 400)
    }

    // Confirm group exists + is owned by the caller (RLS does the
    // owner-only filter; not-found means either missing or not theirs).
    const group = await tryOrNull(() => ctx.collections.findSummary(id))
    if (!group) return jsonError("not_found", "group not found", 404)

    // Membership lookup — same shape as the detail handler so the
    // routing UI can render names + ready-state without a second
    // round-trip.
    const members = (await ctx.collections.listMembers(id)).map((m) => ({
        id: m.id,
        name: m.name,
        analyser_ready: ProjectAnalyser.from({ status: m.status, enabled: m.enabled, graph_id: m.graph_id }).isReady(),
    }))
    const projectIds = members.map((m) => m.id)
    if (projectIds.length === 0) {
        return jsonError("bad_request", "this group has no projects yet", 400)
    }

    // Step 1: compose the draft.
    let proposal
    try {
        proposal = await getAnalyser().compose({ paragraph, images })
    } catch (e) {
        if (e instanceof AnalyserError) return jsonError(e.code, e.message, 502)
        return jsonError("ai_failed", e instanceof Error ? e.message : String(e), 502)
    }

    // Step 2: embed the single query vector. routingEmbeddingText
    // folds the routing_summary + layer + features into a phrase
    // that lives in the same embedding space as the project's
    // contextualised tag pool entries. We surface the same string
    // in the response so the UI can show "this is what we matched
    // against" for debugging routing decisions.
    const routingQuery = new EmbeddingText().forRouting(proposal)
    let queryVec: number[]
    try {
        const embed = await getAnalyser().embed(routingQuery)
        queryVec = embed.vector
    } catch (e) {
        if (e instanceof AnalyserError) return jsonError(e.code, e.message, 502)
        return jsonError("ai_failed", e instanceof Error ? e.message : String(e), 502)
    }

    // Step 3: weighted similarity. Defaults match migration 0025:
    // main 40% + layer 30% + feature 30%, additive.
    const { data: ranked, error: rpcErr } = await repoRead(() =>
        ctx.projects.findSimilarProjects(queryVec, projectIds, projectIds.length),
    )
    if (rpcErr) return rpcErr

    const rankByProject = new Map(ranked.map((r) => [r.project_id, r]))
    const ranking = members
        .map((m) => {
            const score = rankByProject.get(m.id)
            const hasAnyDimension = !!score && (
                (score.main_sim ?? 0) > 0 ||
                (score.layer_sim ?? 0) > 0 ||
                (score.feature_sim ?? 0) > 0
            )
            return {
                project_id:     m.id,
                project_name:   m.name,
                analyser_ready: m.analyser_ready,
                has_summary:    hasAnyDimension,
                similarity:     score?.similarity ?? 0,
                breakdown: score ? {
                    main:    score.main_sim,
                    layer:   score.layer_sim,
                    feature: score.feature_sim,
                } : null,
            }
        })
        .sort((a, b) => {
            if (a.has_summary !== b.has_summary) return a.has_summary ? -1 : 1
            return b.similarity - a.similarity
        })

    return Response.json({ proposal, ranking, routing_query: routingQuery })
}
