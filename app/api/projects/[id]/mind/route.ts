import { chatStream, AnalyserError, type ChatHistoryMsg } from "@/lib/analyser"
import { jsonError, requireUser } from "@/lib/api"
import type { Project, ProjectAnalyser } from "@/lib/supabase/types"

// POST /api/projects/[id]/mind
//
// Streaming knowledge chat over an indexed graph. Proxies the analyser's
// Server-Sent Events /chat endpoint (lib/analyser.ts:chatStream) straight
// through to the browser: progress `stage`/`activity` events while the
// retriever runs, then a terminal `answer` (or `error`) event. No history is
// persisted server-side — the client owns the conversation and sends it back.
//
// Body: { question: string, history?: {role,content}[], max_budget_usd?: number }
//
// 409 needs_indexing — when project_analyser isn't ready (matches the suggest
// route so the UI can prompt the user identically).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch {}
    const question = typeof body?.question === "string" ? body.question.trim() : ""
    if (!question) return jsonError("bad_request", "question is required", 400)
    if (question.length > 4000) return jsonError("bad_request", "question is too long (4000 char max)", 400)

    // TEMPORAL context: the last 3 turns of raw chat (6 messages). Durable
    // structured memory lives in the analyser's managed-context store instead
    // (ADR-0049), keyed by conversation_id below.
    const history: ChatHistoryMsg[] | undefined = Array.isArray(body?.history)
        ? (body.history as unknown[])
              .filter((m): m is ChatHistoryMsg =>
                  !!m && typeof m === "object" &&
                  (((m as ChatHistoryMsg).role === "user") || ((m as ChatHistoryMsg).role === "assistant")) &&
                  typeof (m as ChatHistoryMsg).content === "string")
              .slice(-6)
        : undefined

    const maxBudgetUsd =
        typeof body?.max_budget_usd === "number" && body.max_budget_usd > 0
            ? body.max_budget_usd
            : undefined

    // conversation_id keys the durable managed-context store (ADR-0049).
    const conversationId =
        typeof body?.conversation_id === "string" && body.conversation_id.length <= 64
            ? body.conversation_id
            : undefined

    const { data: project, error: pErr } = await supabase
        .from("projects")
        .select("id")
        .eq("id", id)
        .single<Pick<Project, "id">>()
    if (pErr || !project) return jsonError("not_found", "project not found", 404)

    const { data: analyser, error: aErr } = await supabase
        .from("project_analyser")
        .select("*")
        .eq("project_id", id)
        .maybeSingle<ProjectAnalyser>()
    if (aErr) return jsonError("db_error", aErr.message, 500)
    if (!analyser?.enabled || analyser.status !== "ready" || !analyser.graph_id) {
        return jsonError(
            "needs_indexing",
            "Enable bobby-analyser and run an index for this project before using Mind.",
            409,
        )
    }

    try {
        // Pass the project uuid (scopes the "issues" action, ADR-0048) and the
        // conversation id (keys the managed-context store, ADR-0049).
        const upstream = await chatStream(analyser.graph_id, question, history, maxBudgetUsd, id, conversationId)
        // Pipe the analyser's SSE stream straight to the browser.
        return new Response(upstream.body, {
            status: 200,
            headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
            },
        })
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        const code = e instanceof AnalyserError ? e.code : "chat_failed"
        const status = code === "timeout" ? 504 : 502
        return jsonError(code, message, status)
    }
}
