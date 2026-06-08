import { analyseIssue, AnalyserError } from "@/lib/analyser"
import { jsonError } from "@/lib/api"
import { publicIssueSuggestionChannel } from "@/lib/realtime-channels"
import { createServiceClient } from "@/lib/supabase/server"
import type { IssueSuggestion, ProjectAnalyser } from "@/lib/supabase/types"
import { fetchPublicIssue, requireInviteAccess, requireOwnVisibility, resolvePublicSession } from "@/lib/public-session"

// POST /api/public-issues/[id]/suggest
//
// Body: { token }
//
// Mirrors the authenticated /api/issues/[id]/suggest path but is gated
// by the public session token instead of an auth cookie. Calls the
// analyser, caches the result, and returns it. Returns 409
// `needs_indexing` if the project's graph isn't ready — the public
// detail page renders that as a "still preparing" state.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* allow empty */ }
    const token = String(body?.token ?? "").trim()

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

    const { data: analyser } = await svc
        .from("project_analyser")
        .select("enabled,status,graph_id")
        .eq("project_id", issue.project_id)
        .maybeSingle<Pick<ProjectAnalyser, "enabled" | "status" | "graph_id">>()
    if (!analyser?.enabled || analyser.status !== "ready" || !analyser.graph_id) {
        return jsonError(
            "needs_indexing",
            "Maintainer hasn't indexed this project yet — analysis will appear once they do.",
            409,
        )
    }

    try {
        const result = await analyseIssue({
            repoId:   analyser.graph_id,
            title:    issue.title,
            body:     issue.body || "",
            labels:   issue.labels,
            priority: issue.priority,
        })

        const { data: row, error: insErr } = await svc
            .from("issue_suggestions")
            .insert({
                issue_id:    issue.id,
                data:        result,
                markdown:    result.markdown ?? result.summary ?? "",
                code_cites:  (result.suggestions ?? []).map((s) => ({ file: s.file, line: s.line })),
                graph_cites: result.graph_cites ?? [],
                confidence:  result.confidence ?? null,
                cost_usd:    result.cost_usd ?? 0,
                duration_ms: result.duration_ms ?? 0,
                graph_id:    analyser.graph_id,
            })
            .select("*")
            .single<IssueSuggestion>()
        if (insErr) return jsonError("db_error", insErr.message, 500)

        // Push the row to anyone watching this issue's broadcast
        // channel. Public visitors can't read issue_suggestions over
        // postgres_changes (anon role doesn't get realtime SELECT on
        // tracker tables, by design), so a broadcast channel scoped
        // to the issue id is the safe push path: no DB exposure, the
        // server controls exactly what's emitted.
        //
        // Best-effort: the suggestion is already persisted and the
        // HTTP response below carries it too, so a broadcast failure
        // just means the client has to wait for the POST response
        // instead of getting a push.
        try {
            const channel = svc.channel(publicIssueSuggestionChannel(issue.id))
            await channel.send({
                type: "broadcast",
                event: "ready",
                payload: { suggestion: row },
            })
            await svc.removeChannel(channel)
        } catch {
            // swallow — see comment above
        }

        return Response.json({ suggestion: row })
    } catch (e) {
        const code = e instanceof AnalyserError ? e.code : "analyser_failed"
        const message = e instanceof Error ? e.message : String(e)
        return jsonError(code, message, 502)
    }
}
