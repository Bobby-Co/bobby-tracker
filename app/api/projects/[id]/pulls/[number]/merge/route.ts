import { jsonError, requireUser, requireProjectAccess } from "@/lib/platform/http/api"
import { getVcsAppService, VcsMergeError, createServicePullRequestStore } from "@/modules/vcs"
import { MergePolicy, type MergeMethod, type MergeMethods, type VcsMergeMethods } from "@/modules/vcs"
import type { Project, PullRequest, PullRequestAnalysis } from "@/lib/supabase/types"

// GET  /api/projects/[id]/pulls/[number]/merge — everything the merge bar needs:
//        our policy gate (from mirrored data), the repo's allowed merge methods,
//        and GitHub's live mergeability. Fetched lazily by the bar, so a PR the
//        user never tries to merge costs no GitHub calls.
// POST /api/projects/[id]/pulls/[number]/merge — perform the merge, re-checking
//        the gate server-side first.
//
// Only projects the caller OWNS reach GitHub: the ownership select runs on the
// RLS-scoped client, and the GitHub calls (service-role installation token) are
// gated behind it. Neither verb touches GitHub for a project the user can't see.

type MergeProject = Pick<Project, "id" | "repo_url" | "repo_full_name"> & {
    github_installation_id: number | null
    github_repo_id: number | null
    github_sync_enabled: boolean
}
const PROJECT_COLS = "id,repo_url,repo_full_name,github_installation_id,github_repo_id,github_sync_enabled"

function connected(p: MergeProject): boolean {
    return p.github_sync_enabled && p.github_installation_id != null && p.github_repo_id != null
}

// Shared loader: ownership + the PR + its review, all through the caller's
// RLS-scoped client so a project/PR they don't own simply isn't found.
async function load(
    supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
    id: string,
    prNumber: number,
) {
    const [projectR, pullR, analysisR] = await Promise.all([
        supabase.from("projects").select(PROJECT_COLS).eq("id", id).maybeSingle<MergeProject>(),
        supabase
            .from("pull_requests")
            .select("*")
            .eq("project_id", id)
            .eq("pr_number", prNumber)
            .maybeSingle<PullRequest>(),
        supabase
            .from("pull_request_analyses")
            .select("*")
            .eq("project_id", id)
            .eq("pr_number", prNumber)
            .maybeSingle<PullRequestAnalysis>(),
    ])
    return { projectR, pullR, analysisR }
}

function toMethods(m: VcsMergeMethods): MergeMethods {
    return { merge: m.mergeCommit, squash: m.squash, rebase: m.rebase }
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string; number: string }> }) {
    const { id, number } = await params
    const prNumber = Number(number)
    if (!Number.isInteger(prNumber)) return jsonError("bad_request", "invalid PR number", 400)

    const { supabase, error } = await requireProjectAccess(id)
    if (error) return error

    const { projectR, pullR, analysisR } = await load(supabase, id, prNumber)
    const dbErr = projectR.error || pullR.error || analysisR.error
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    const project = projectR.data
    const pull = pullR.data
    if (!project || !pull) return jsonError("not_found", "pull request not found", 404)

    const gate = new MergePolicy().evaluate(pull, analysisR.data ?? null)

    // The repo's allowed methods + GitHub's live mergeability are only worth a
    // round-trip when our own gate would otherwise let the merge through — and
    // only when the App is actually linked. Skip the GitHub calls otherwise.
    let methods: MergeMethods | null = null
    let mergeable: boolean | null = null
    let mergeableState: string | null = null
    const vcs = gate.mergeable && connected(project) ? getVcsAppService(project) : null
    if (vcs) {
        try {
            // Both are independent GETs — run them together.
            const [m, mg] = await Promise.all([vcs.getMergeMethods(), vcs.getMergeability(prNumber)])
            methods = toMethods(m)
            mergeable = mg.mergeable
            mergeableState = mg.mergeableState
        } catch {
            // A remote hiccup here shouldn't blank the bar — the POST re-checks
            // and is the real gate. Fall back to offering all methods; the
            // provider rejects a disabled one with a clear 405 we translate.
            methods = { merge: true, squash: true, rebase: true }
        }
    }

    return Response.json({
        gate,
        connected: connected(project),
        methods,
        default_method: methods ? new MergePolicy().defaultMethod(methods) : null,
        mergeable,
        mergeable_state: mergeableState,
    })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; number: string }> }) {
    const { id, number } = await params
    const prNumber = Number(number)
    if (!Number.isInteger(prNumber)) return jsonError("bad_request", "invalid PR number", 400)

    let body: { method?: unknown; commit_title?: unknown; commit_message?: unknown } = {}
    try {
        body = await request.json()
    } catch {
        // empty body → default method resolved below
    }
    const method = body.method as MergeMethod | undefined
    if (method && !["merge", "squash", "rebase"].includes(method)) {
        return jsonError("bad_request", "invalid merge method", 400)
    }

    const { supabase, error } = await requireProjectAccess(id)
    if (error) return error

    const { projectR, pullR, analysisR } = await load(supabase, id, prNumber)
    const dbErr = projectR.error || pullR.error || analysisR.error
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    const project = projectR.data
    const pull = pullR.data
    if (!project || !pull) return jsonError("not_found", "pull request not found", 404)

    // ENFORCE the gate server-side. The client disables the button, but a
    // hand-crafted POST must not be able to merge a PR the review blocked — this
    // is the authoritative check, not the UI.
    const gate = new MergePolicy().evaluate(pull, analysisR.data ?? null)
    if (!gate.mergeable) {
        return jsonError("merge_blocked", gate.block?.label ?? "Merge is not allowed", 409)
    }

    if (!connected(project)) {
        return jsonError("not_connected", "Connect the GitHub App to merge from here.", 409)
    }
    const vcs = getVcsAppService(project)
    if (!vcs) return jsonError("not_connected", "This project has no GitHub repository.", 409)

    const chosen: MergeMethod = method ?? "merge"

    try {
        const result = await vcs.mergePullRequest(prNumber, {
            method: chosen,
            // Pin to the head we mirrored, so the merge can't land on a commit the
            // reviewer never saw — the provider 409s if it moved.
            sha: pull.head_sha ?? undefined,
        })

        // Reflect the merge immediately so the UI updates without waiting on the
        // webhook's `closed` event.
        await createServicePullRequestStore().markMerged(id, prNumber, new Date().toISOString())

        return Response.json({ merged: true, sha: result.sha, method: chosen })
    } catch (e) {
        if (e instanceof VcsMergeError) {
            // Map GitHub's well-known refusals to messages the user can act on.
            if (e.status === 405) {
                return jsonError(
                    "not_mergeable",
                    e.message || "GitHub can't merge this PR (conflicts, failing checks, or branch protection).",
                    409,
                )
            }
            if (e.status === 409) {
                return jsonError(
                    "sha_conflict",
                    "This PR changed since the page loaded. Refresh and try again.",
                    409,
                )
            }
            if (e.status === 403) {
                return jsonError(
                    "forbidden",
                    "The GitHub App isn't allowed to merge (it needs Contents: write). Re-authorise it, or merge on GitHub.",
                    403,
                )
            }
            return jsonError("merge_failed", e.message, 502)
        }
        return jsonError("merge_failed", e instanceof Error ? e.message : "merge failed", 502)
    }
}
