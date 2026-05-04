import { jsonError, requireUser } from "@/lib/api"
import {
    AnalyserError, composeIssue, embedText,
    routingEmbeddingText, layerEmbeddingText, featureEmbeddingText,
} from "@/lib/analyser"
import type { ProjectGroup } from "@/lib/supabase/types"

// POST /api/groups/[id]/ai-compose
//
// Body: { paragraph, images?: string[] }
//
// Compose + route in one round-trip:
//
//   1. Forward paragraph + images to bobby-analyser /issues/compose
//      → structured draft (title/body/priority/labels) plus the
//      routing fields the new tag system needs (layer, features,
//      action, scope, routing_summary).
//   2. Embed three query vectors in parallel:
//        - routing_summary  → overview/stack/modules sims
//        - layer text       → vs project_layer_tags pool
//        - features text    → vs project_feature_tags pool
//   3. tracker.find_similar_projects(routing, layer, feature,
//      group_member_ids) with weights — layer + feature dominate at
//      60% (30/30), modules 20%, overview/stack 10% each — so the
//      cross-repo routing the old prose-blend kept missing actually
//      lands.
//
// Returns proposal + ranking[]; each ranking row carries the per-
// dimension breakdown so the UI can show which signal moved the
// score.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
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
    const { data: group } = await supabase
        .from("project_groups")
        .select("id,name")
        .eq("id", id)
        .maybeSingle<Pick<ProjectGroup, "id" | "name">>()
    if (!group) return jsonError("not_found", "group not found", 404)

    // Membership lookup — same shape as the detail handler so the
    // routing UI can render names + ready-state without a second
    // round-trip.
    const { data: links } = await supabase
        .from("project_group_members")
        .select("project_id,projects(id,name,project_analyser(status,enabled,graph_id))")
        .eq("group_id", id)
    type Link = { project_id: string; projects: unknown }
    interface MemberInfo { id: string; name: string; analyser_ready: boolean }
    const members: MemberInfo[] = []
    for (const r of (links as Link[] | null) ?? []) {
        const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects
        if (!proj || typeof proj !== "object") continue
        const p = proj as { id: string; name: string; project_analyser?: unknown }
        const analyser = Array.isArray(p.project_analyser) ? p.project_analyser[0] : p.project_analyser
        const a = (analyser && typeof analyser === "object")
            ? analyser as { status?: string; enabled?: boolean; graph_id?: string | null }
            : null
        const ready = !!a && a.enabled === true && a.status === "ready" && !!a.graph_id
        members.push({ id: p.id, name: p.name, analyser_ready: ready })
    }
    const projectIds = members.map((m) => m.id)
    if (projectIds.length === 0) {
        return jsonError("bad_request", "this group has no projects yet", 400)
    }

    // Step 1: compose the draft.
    let proposal
    try {
        proposal = await composeIssue({ paragraph, images })
    } catch (e) {
        if (e instanceof AnalyserError) return jsonError(e.code, e.message, 502)
        return jsonError("ai_failed", e instanceof Error ? e.message : String(e), 502)
    }

    // Step 2: embed the three query vectors in parallel.
    let routingVec: number[]
    let layerVec: number[]
    let featureVec: number[]
    try {
        const [routing, layer, feature] = await Promise.all([
            embedText(routingEmbeddingText(proposal)),
            embedText(layerEmbeddingText(proposal)),
            embedText(featureEmbeddingText(proposal)),
        ])
        routingVec = routing.vector
        layerVec   = layer.vector
        featureVec = feature.vector
    } catch (e) {
        if (e instanceof AnalyserError) return jsonError(e.code, e.message, 502)
        return jsonError("ai_failed", e instanceof Error ? e.message : String(e), 502)
    }

    // Step 3: weighted similarity. Defaults match migration 0021:
    // layer 30%, feature 30%, modules 20%, overview 10%, stack 10%.
    interface RankRow {
        project_id:   string
        similarity:   number
        layer_sim:    number | null
        feature_sim:  number | null
        overview_sim: number | null
        stack_sim:    number | null
        modules_sim:  number | null
    }
    const { data: ranked, error: rpcErr } = await supabase
        .rpc("find_similar_projects", {
            p_routing_embedding: routingVec,
            p_layer_embedding:   layerVec,
            p_feature_embedding: featureVec,
            p_project_ids:       projectIds,
            p_limit:             projectIds.length,
        })
    if (rpcErr) return jsonError("db_error", rpcErr.message, 500)

    const rankByProject = new Map<string, RankRow>()
    for (const r of (ranked as RankRow[] | null) ?? []) {
        rankByProject.set(r.project_id, r)
    }
    const ranking = members
        .map((m) => {
            const score = rankByProject.get(m.id)
            const hasAnyDimension = !!score && (
                (score.layer_sim ?? 0) > 0 ||
                (score.feature_sim ?? 0) > 0 ||
                (score.overview_sim ?? 0) > 0 ||
                (score.stack_sim ?? 0) > 0 ||
                (score.modules_sim ?? 0) > 0
            )
            return {
                project_id:     m.id,
                project_name:   m.name,
                analyser_ready: m.analyser_ready,
                has_summary:    hasAnyDimension,
                similarity:     score?.similarity ?? 0,
                breakdown: score ? {
                    layer:    score.layer_sim,
                    feature:  score.feature_sim,
                    modules:  score.modules_sim,
                    overview: score.overview_sim,
                    stack:    score.stack_sim,
                } : null,
            }
        })
        .sort((a, b) => {
            if (a.has_summary !== b.has_summary) return a.has_summary ? -1 : 1
            return b.similarity - a.similarity
        })

    return Response.json({ proposal, ranking })
}
