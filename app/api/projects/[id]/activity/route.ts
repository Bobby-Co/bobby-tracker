import { after } from "next/server"
import { jsonError, repoRead, requireProjectAccess } from "@/lib/platform/http/api"
import { createSupabaseProjectAnalyserRepository } from "@/modules/analysis"
import { countUnembeddedIssues, ensureIssueEmbeddings } from "@/modules/issues"

// How many issues one sweep embeds. Small on purpose: this runs in the request's
// after() on a Worker, so the batch has to finish inside that budget. A backlog
// larger than this drains across visits — the chip shows the count falling.
const SWEEP_BATCH = 10

export interface ProjectActivity {
    /** Present only while a graph build is in flight, so the client can render
     *  the phase without also having to know the whole analyser state machine. */
    indexing: { phase: string | null } | null
    /** Issues still lacking a similarity vector. */
    unembedded: number
}

// GET /api/projects/[id]/activity
//
// The background-work summary behind the project header's chips. One cheap
// round-trip for "is anything happening right now?", rather than making the
// layout fetch the analyser row, count embeddings, and reconcile them itself.
//
// THIS GET HAS A SIDE EFFECT, deliberately: when issues are missing embeddings
// it schedules one bounded sweep via after(). That mirrors GET
// /api/projects/[id]/pulls, which kicks backfillPullRequests(id) the same way
// and reports `syncing: true`. The reason is structural rather than stylistic —
// there is no cron in this stack (the OpenNext worker has no scheduled
// handler), so a backlog can only ever be drained by something a user's visit
// triggers. Polling this endpoint IS the drain, and the chip is its progress
// bar.
//
// Ownership: the count runs through the caller's RLS-scoped client, so a
// project the user doesn't own reports nothing and — because the 404 below
// returns first — schedules no sweep on their behalf.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireProjectAccess(id)
    if (error) return error

    // Confirm the caller actually owns this project BEFORE scheduling any work
    // for it. RLS would hide the rows anyway, but the sweep runs service-role
    // (it has to — it writes embeddings), so it would happily embed a stranger's
    // backlog if we let an unowned id reach it. Cheap gate, real teeth.
    const { data: project, error: pErr } = await supabase
        .from("projects")
        .select("id")
        .eq("id", id)
        .maybeSingle<{ id: string }>()
    if (pErr) return jsonError("db_error", pErr.message, 500)
    if (!project) return jsonError("not_found", "project not found", 404)

    const { data: analyser, error: aErr } = await repoRead(() =>
        createSupabaseProjectAnalyserRepository(supabase).findByProjectId(id),
    )
    if (aErr) return aErr

    const unembedded = await countUnembeddedIssues(id)

    if (unembedded > 0) {
        after(() => ensureIssueEmbeddings(id, SWEEP_BATCH))
    }

    const activity: ProjectActivity = {
        indexing:
            analyser?.status === "indexing"
                ? // progress is written by the analyser as the job runs and every key
                  // is optional (0004), so treat a missing phase as "no detail yet"
                  // rather than assuming the shape.
                  { phase: analyser.progress?.phase ?? null }
                : null,
        unembedded,
    }
    return Response.json({ activity })
}
