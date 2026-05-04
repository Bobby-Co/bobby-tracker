import { jsonError, requireUser } from "@/lib/api"
import { AnalyserError, composeIssue, embedText, routingEmbeddingText } from "@/lib/analyser"
import type { ProjectGroup } from "@/lib/supabase/types"

// POST /api/groups/[id]/ai-compose
//
// Body: { paragraph, images?: string[] }
//
// Two-step flow folded into one round-trip so the client gets back
// everything it needs to render the routing UI:
//
//   1. Forward the paragraph + images to bobby-analyser /issues/compose
//      to get a structured draft (title / body / priority / labels).
//   2. Embed the draft (title + body) via bobby-analyser /embeddings.
//   3. Run tracker.find_similar_projects(embedding, group_member_ids,
//      …) with the default per-facet weights from migration 0018
//      (overview 25%, features 20%, stack 15%, modules 40%).
//
// Returns the proposal alongside a ranking[]: each entry carries the
// project id + name + the per-facet similarity breakdown so the
// compose UI can both pre-select the best target and explain *why*.
//
// Nothing is persisted here — the user picks one or more target
// projects in the UI and the issue gets created via the regular
// POST /api/issues (per project) on confirm. That keeps the
// analyser-readiness check + duplicate index fill in one place.
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

    // Step 2: embed the draft so we can score it against each project.
    let queryVec: number[]
    try {
        const embed = await embedText(routingEmbeddingText(proposal))
        queryVec = embed.vector
    } catch (e) {
        if (e instanceof AnalyserError) return jsonError(e.code, e.message, 502)
        return jsonError("ai_failed", e instanceof Error ? e.message : String(e), 502)
    }

    // Step 3: weighted facet similarity. Defaults match migration 0018:
    // modules 40%, overview 25%, features 20%, stack 15%.
    interface RankRow {
        project_id: string
        similarity: number
        overview_sim: number | null
        features_sim: number | null
        stack_sim:    number | null
        modules_sim:  number | null
    }
    const { data: ranked, error: rpcErr } = await supabase
        .rpc("find_similar_projects", {
            p_embedding:   queryVec,
            p_project_ids: projectIds,
            p_limit:       projectIds.length,
        })
    if (rpcErr) return jsonError("db_error", rpcErr.message, 500)

    const rankByProject = new Map<string, RankRow>()
    for (const r of (ranked as RankRow[] | null) ?? []) {
        rankByProject.set(r.project_id, r)
    }
    // Project order: ranked first, then any unranked (no summary yet)
    // appended in alphabetical order so they're still selectable.
    const ranking = members
        .map((m) => {
            const score = rankByProject.get(m.id)
            return {
                project_id:     m.id,
                project_name:   m.name,
                analyser_ready: m.analyser_ready,
                has_summary:    !!score,
                similarity:     score?.similarity ?? 0,
                breakdown: score ? {
                    overview: score.overview_sim,
                    features: score.features_sim,
                    stack:    score.stack_sim,
                    modules:  score.modules_sim,
                } : null,
            }
        })
        .sort((a, b) => {
            if (a.has_summary !== b.has_summary) return a.has_summary ? -1 : 1
            return b.similarity - a.similarity
        })

    return Response.json({ proposal, ranking })
}
