import { jsonError, requireUser } from "@/lib/api"
import { AnalyserError, composeIssue, embedText, routingEmbeddingText } from "@/lib/analyser"
import type { ProjectGroup } from "@/lib/supabase/types"

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

    // Step 2: embed the single query vector. routingEmbeddingText
    // folds the routing_summary + layer + features into a phrase
    // that lives in the same embedding space as the project's
    // contextualised tag pool entries.
    let queryVec: number[]
    try {
        const embed = await embedText(routingEmbeddingText(proposal))
        queryVec = embed.vector
    } catch (e) {
        if (e instanceof AnalyserError) return jsonError(e.code, e.message, 502)
        return jsonError("ai_failed", e instanceof Error ? e.message : String(e), 502)
    }

    // Step 3: weighted similarity. Defaults match migration 0023:
    // main 70% + max(layer,feature) 30%.
    interface RankRow {
        project_id:  string
        similarity:  number
        main_sim:    number | null
        layer_sim:   number | null
        feature_sim: number | null
        tag_sim:     number | null
    }
    const { data: ranked, error: rpcErr } = await supabase
        .rpc("find_similar_projects", {
            p_query_embedding: queryVec,
            p_project_ids:     projectIds,
            p_limit:           projectIds.length,
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

    return Response.json({ proposal, ranking })
}
