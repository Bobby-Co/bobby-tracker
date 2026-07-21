import { after } from "next/server"
import { jsonError, requireUser } from "@/lib/platform/http/api"
import { ProjectAnalyser, createSupabaseProjectAnalyserRepository, ensureAnalysis } from "@/modules/analysis"
import { tryOrNull, RepositoryError } from "@/lib/kernel"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/supabase/types"
import type { IssuePriority, IssueStatus } from "@/lib/supabase/types"
import { createSupabaseIssuesRepository, embedIssueAsync } from "@/modules/issues"
import { getVcsAppService } from "@/modules/vcs"
import { createSupabaseProjectsRepository } from "@/modules/projects"

export async function POST(request: Request) {
    const { supabase, user, error } = await requireUser()
    if (error) return error

    // Bind the request's RLS-scoped client to each repository once, up front,
    // and reuse the instances throughout the handler.
    const analyserRepo = createSupabaseProjectAnalyserRepository(supabase)
    const issues = createSupabaseIssuesRepository(supabase)
    const projects = createSupabaseProjectsRepository(supabase)

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const project_id = String(body?.project_id ?? "")
    const title = String(body?.title ?? "").trim()
    if (!project_id) return jsonError("bad_request", "project_id required", 400)
    if (!title) return jsonError("bad_request", "title required", 400)

    // Issues without a knowledge graph are low-value (no suggestions,
    // no Ask citations). Block creation until the project has been
    // bootstrapped at least once. The UI mirrors this with a banner +
    // disabled "New issue" button on the issues page; this is the
    // server-side enforcement so direct API calls can't bypass it.
    const analyser = await tryOrNull(() => analyserRepo.findReadiness(project_id))
    if (!ProjectAnalyser.from(analyser).isReady()) {
        return jsonError(
            "needs_indexing",
            "Enable the analyser and run the first index on the Knowledge tab before creating issues.",
            409,
        )
    }

    const rawStatus = typeof body?.status === "string" ? body.status : ""
    const rawPriority = typeof body?.priority === "string" ? body.priority : ""
    const status: IssueStatus = (ISSUE_STATUSES as readonly string[]).includes(rawStatus)
        ? (rawStatus as IssueStatus)
        : "open"
    const priority: IssuePriority = (ISSUE_PRIORITIES as readonly string[]).includes(rawPriority)
        ? (rawPriority as IssuePriority)
        : "medium"
    const labels = Array.isArray(body?.labels)
        ? body.labels.filter((l: unknown): l is string => typeof l === "string")
        : []
    const issueBody = typeof body?.body === "string" ? body.body : ""
    const ai_proposed = body?.ai_proposed === true
    const duplicate_of_issue_id = typeof body?.duplicate_of_issue_id === "string"
        ? body.duplicate_of_issue_id
        : null
    // Per-issue analyser effort from the create modal's advanced settings.
    // Null unless a real level was chosen, so untouched issues inherit the
    // project default (and then the analyser's own default) at analyse time.
    const analyse_effort = ProjectAnalyser.isValidEffort(body?.analyse_effort) ? body.analyse_effort : null

    // Persist through the issues module's repository — the controller never
    // touches the DB client directly (see modules/README.md: the interface layer
    // parses/validates/authorizes, then delegates to the owning context).
    let issue
    try {
        issue = await issues.create({
            project_id,
            user_id: user.id,
            title,
            body: issueBody,
            status,
            priority,
            labels,
            ai_proposed,
            duplicate_of_issue_id,
            analyse_effort,
        })
    } catch (e) {
        const message = e instanceof RepositoryError ? e.message : "failed to create issue"
        return jsonError("db_error", message, 500)
    }

    // Best-effort embedding — runs after the response so issue
    // creation isn't blocked on the analyser round-trip. Use after()
    // (NOT a bare `void`): on Cloudflare Workers a detached promise is
    // abandoned the instant the response returns, so the embed fetch
    // gets cancelled and the issue is never indexed. after() registers
    // the work with the runtime's waitUntil so it runs to completion.
    after(() => embedIssueAsync(issue))

    // If the project is linked to GitHub with two-way sync on, mirror the new
    // issue to GitHub and post the auto-analysis comment. Fire-and-forget via
    // after() (same reason as the embed above — a bare `void` gets cancelled
    // when the response returns on Workers). Independent of the needs_indexing
    // gate above; a no-op when the project isn't sync-wired.
    const project = await projects.findGithubSyncContext(project_id)
    if (project?.github_sync_enabled && project.github_installation_id && project.github_repo_id) {
        const origin = new URL(request.url).origin
        after(async () => {
            // Push first so the issue has its github_issue_number, then start
            // the placeholder-comment + detached analysis run.
            await getVcsAppService(project)?.syncIssueCreated(issue, project)
            await ensureAnalysis(issue.id, origin)
        })
    }

    return Response.json({ issue })
}

