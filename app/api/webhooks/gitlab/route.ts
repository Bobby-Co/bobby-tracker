import { getSpendGate } from "@/modules/billing"
import { after } from "next/server"
import { getAnalyser, createIssueAnalysisService, createPullRequestAnalysisService, createSupabaseProjectAnalyserRepository, createSupabaseProjectBranchRepository } from "@/modules/analysis"
import { tryOrNull } from "@/lib/shared/kernel"
import { SyncHash, timingSafeEqual, createServicePullRequestStore, getGitlabCloneAuth } from "@/modules/vcs"
import { createIssueEmbedder, Issue as IssueAggregate, createServiceIssueSyncStore } from "@/modules/issues"
import { Project as ProjectAggregate, createSupabaseProjectsRepository } from "@/modules/projects"
import { Supabase } from "@/lib/server/supabase"
import type { Issue, Project } from "@/lib/shared/types"
import { dataClientForProject } from "@/lib/server/regional"

// INBOUND GITLAB WEBHOOK — public. GitLab authenticates each delivery with a
// PER-PROJECT secret sent in the X-Gitlab-Token header (a plaintext compare, not
// a body signature). We resolve the project from the payload, look up its stored
// secret, and constant-time compare BEFORE any write. Mirrors the GitHub receiver
// onto GitLab's event/payload shapes; reuses the same stores + services.
export const dynamic = "force-dynamic"

function ack() {
    return new Response(null, { status: 202 })
}
type Svc = ReturnType<typeof Supabase.service>

interface GlProjectRow {
    id: string
    user_id: string
    repo_url: string
    repo_full_name: string | null
    gitlab_project_id: number | null
    gitlab_host: string | null
    github_sync_enabled: boolean
    github_sync_direction: "inbound" | "outbound" | "both"
    github_sync_deletes: boolean
    auto_index_on_push: boolean
}

export async function POST(request: Request) {
    const raw = await request.text()
    const token = request.headers.get("x-gitlab-token")
    const event = request.headers.get("x-gitlab-event") ?? ""
    const deliveryId = request.headers.get("x-gitlab-event-uuid") ?? ""

    let payload: Record<string, unknown>
    try {
        payload = JSON.parse(raw)
    } catch {
        return ack()
    }

    const glProject = payload.project as { id?: number; web_url?: string; default_branch?: string } | undefined
    const projectId = glProject?.id
    if (!projectId || !glProject?.web_url) return ack()
    let host: string
    try {
        host = new URL(glProject.web_url).hostname.toLowerCase()
    } catch {
        return ack()
    }

    const svc = Supabase.service()

    // Resolve the tracker project by (host, gitlab project id) + its webhook secret.
    //
    // A repo can back a project in more than one team, so this may match several
    // rows — `maybeSingle` used to ERROR on that. It is not a fan-out though:
    // each project provisions its OWN webhook on the GitLab side with its own
    // secret (provisionGitlabProject), so GitLab sends one delivery PER project
    // and the secret is what says which one this delivery belongs to.
    const { data: candidates } = await svc
        .from("projects")
        .select(
            "id,user_id,repo_url,repo_full_name,gitlab_project_id,gitlab_host,github_sync_enabled,github_sync_direction,github_sync_deletes,auto_index_on_push",
        )
        .eq("gitlab_project_id", projectId)
        .eq("gitlab_host", host)
        .returns<GlProjectRow[]>()
    if (!candidates?.length) return ack()
    if (!token) return new Response("bad token", { status: 401 })

    const { data: links } = await svc
        .from("gitlab_project_links")
        .select("project_id,webhook_secret")
        .in("project_id", candidates.map((p) => p.id))
        .returns<{ project_id: string; webhook_secret: string | null }[]>()

    // Compare against every candidate rather than looking one up by id: the
    // secret is the credential, so it decides the project — not the other way
    // round. Each comparison stays constant-time; only the NUMBER of candidates
    // is observable, which reveals nothing about the secrets.
    const matched = (links ?? []).find((l) => l.webhook_secret && timingSafeEqual(token, l.webhook_secret))
    const project = matched ? candidates.find((p) => p.id === matched.project_id) : undefined
    if (!project) return new Response("bad token", { status: 401 })

    // Delivery dedupe (generic ledger; GitLab's X-Gitlab-Event-UUID).
    if (deliveryId) {
        const { error: dErr } = await svc
            .from("webhook_deliveries")
            .insert({ provider: "gitlab", delivery_id: deliveryId, event })
        if (dErr) {
            if (dErr.code === "23505") return ack()
            return new Response("delivery record failed", { status: 500 })
        }
    }

    const origin = new URL(request.url).origin
    if (event === "Issue Hook") return handleIssue(svc, project, payload, origin)
    if (event === "Note Hook") return handleNote(svc, project, payload)
    if (event === "Merge Request Hook") return handleMr(svc, project, payload, origin)
    if (event === "Push Hook") return handlePush(svc, project, payload)
    return ack()
}

// ── issues ────────────────────────────────────────────────────────────────
async function handleIssue(svc: Svc, project: GlProjectRow, payload: Record<string, unknown>, origin: string): Promise<Response> {
    if (!project.github_sync_enabled || !ProjectAggregate.of(project).allowsInbound()) return ack()

    // This project's regional database. Resolved per project because the fan-out
    // above may span teams in different regions, and an issue written to the
    // wrong one is a silent loss — it succeeds, and nothing ever reads it back.
    const regional = await dataClientForProject(project.id)

    const attrs = payload.object_attributes as
        | { iid?: number; id?: number; title?: string; description?: string | null; state?: string; action?: string; updated_at?: string }
        | undefined
    const number = attrs?.iid
    if (!number) return ack()
    const action = attrs?.action ?? "update"
    const state: "open" | "closed" = attrs?.state === "closed" ? "closed" : "open"

    if (action === "delete") {
        if (project.github_sync_deletes) {
            await regional.from("issues").delete().eq("project_id", project.id).eq("github_issue_number", number)
        }
        return ack()
    }

    const title = attrs?.title ?? ""
    const body = attrs?.description ?? ""
    const hash = await new SyncHash().compute(title, body, state)

    const { data: existing } = await regional
        .from("issues")
        .select("id,updated_at,last_synced_hash")
        .eq("project_id", project.id)
        .eq("github_issue_number", number)
        .maybeSingle<Pick<Issue, "id" | "updated_at" | "last_synced_hash">>()
    if (existing && existing.last_synced_hash === hash) return ack() // echo of our own push

    const nowIso = new Date().toISOString()
    const syncFields = {
        title,
        body,
        status: IssueAggregate.statusFromGithubState(state),
        github_issue_number: number,
        github_node_id: attrs?.id != null ? String(attrs.id) : null,
        sync_source: "gitlab" as const,
        last_synced_hash: hash,
        github_synced_at: nowIso,
    }

    if (existing) {
        await regional.from("issues").update(syncFields).eq("id", existing.id)
        if (action === "close") after(() => createIssueAnalysisService(regional).cancel(existing.id))
    } else {
        const { data: inserted } = await regional
            .from("issues")
            .insert({ project_id: project.id, user_id: project.user_id, ...syncFields })
            .select("id")
            .single<Pick<Issue, "id">>()
        if (action === "open" && inserted) after(() => createIssueAnalysisService(regional).ensure(inserted.id, origin))
        if (inserted) after(() => createIssueEmbedder(regional).embedIssue({ id: inserted.id, project_id: project.id, title, body }))
    }
    return ack()
}

// ── notes (issue comments only; MR notes mirror to pr_comments) ──────────────
async function handleNote(svc: Svc, project: GlProjectRow, payload: Record<string, unknown>): Promise<Response> {
    if (!project.github_sync_enabled) return ack()
    const attrs = payload.object_attributes as
        | { id?: number; note?: string | null; noteable_type?: string; url?: string; created_at?: string; updated_at?: string }
        | undefined
    if (!attrs?.id) return ack()
    const author = payload.user as { username?: string; avatar_url?: string } | undefined

    if (attrs.noteable_type === "Issue") {
        const issue = payload.issue as { iid?: number } | undefined
        if (!issue?.iid) return ack()
        await createServiceIssueSyncStore(await dataClientForProject(project.id)).upsertComment(project.id, {
            issue_number: issue.iid,
            github_comment_id: attrs.id,
            author_login: author?.username ?? null,
            author_avatar_url: author?.avatar_url ?? null,
            body: attrs.note ?? null,
            html_url: attrs.url ?? null,
            gh_created_at: attrs.created_at ?? null,
            gh_updated_at: attrs.updated_at ?? null,
        })
        return ack()
    }
    if (attrs.noteable_type === "MergeRequest") {
        const mr = payload.merge_request as { iid?: number } | undefined
        if (!mr?.iid) return ack()
        await createServicePullRequestStore(await dataClientForProject(project.id)).upsertComment(project.id, {
            pr_number: mr.iid,
            source: "issue_comment",
            github_comment_id: attrs.id,
            author_login: author?.username ?? null,
            author_avatar_url: author?.avatar_url ?? null,
            body: attrs.note ?? null,
            html_url: attrs.url ?? null,
            gh_created_at: attrs.created_at ?? null,
            gh_updated_at: attrs.updated_at ?? null,
        })
    }
    return ack()
}

// ── merge requests → pull_requests mirror ────────────────────────────────────
async function handleMr(svc: Svc, project: GlProjectRow, payload: Record<string, unknown>, origin: string): Promise<Response> {
    if (!project.github_sync_enabled) return ack()
    const a = payload.object_attributes as
        | {
              iid?: number
              id?: number
              title?: string
              description?: string | null
              state?: string
              action?: string
              source_branch?: string
              target_branch?: string
              draft?: boolean
              work_in_progress?: boolean
              url?: string
              created_at?: string
              updated_at?: string
              last_commit?: { id?: string }
              // GitLab ships the resolved three-way refs on the MR payload. The
              // base is what `base…head` means for this MR, and the scope
              // decision needs it: without a base, "the pull request's base
              // moved" is a rule that can never fire, and a target branch that
              // has moved under the MR would be reviewed incrementally as if
              // nothing had happened.
              diff_refs?: { base_sha?: string; head_sha?: string; start_sha?: string }
              merge_status?: string
          }
        | undefined
    const number = a?.iid
    if (!number) return ack()
    const author = payload.user as { username?: string; avatar_url?: string } | undefined
    const merged = a?.state === "merged"

    await createServicePullRequestStore(await dataClientForProject(project.id)).upsertPullRequest(project.id, {
        pr_number: number,
        github_node_id: a?.id != null ? String(a.id) : null,
        title: a?.title ?? "",
        body: a?.description ?? null,
        state: a?.state === "opened" ? "open" : "closed",
        merged,
        draft: a?.draft ?? a?.work_in_progress ?? false,
        author_login: author?.username ?? null,
        author_avatar_url: author?.avatar_url ?? null,
        html_url: a?.url ?? null,
        head_ref: a?.source_branch ?? null,
        base_ref: a?.target_branch ?? null,
        head_sha: a?.diff_refs?.head_sha ?? a?.last_commit?.id ?? null,
        base_sha: a?.diff_refs?.base_sha ?? null,
        additions: null,
        deletions: null,
        changed_files: null,
        comments_count: null,
        gh_created_at: a?.created_at ?? null,
        gh_updated_at: a?.updated_at ?? null,
        closed_at: null,
        merged_at: merged ? (a?.updated_at ?? null) : null,
    })

    if (a?.action === "close" || a?.action === "merge") {
        after(async () => createPullRequestAnalysisService(await dataClientForProject(project.id)).cancel(project.id, number))
        return ack()
    }
    if (a?.draft || a?.work_in_progress) return ack()

    // Auto-review the MR (already mirrored above). Build a provider-aware
    // PrProject so the analysis service resolves the GitLab adapter + notes.
    const prProject = {
        id: project.id,
        repo_url: project.repo_url,
        repo_full_name: project.repo_full_name,
        github_installation_id: null,
        github_repo_id: null,
        github_sync_enabled: project.github_sync_enabled,
        provider: "gitlab" as const,
        gitlab_project_id: project.gitlab_project_id,
    }
    after(async () =>
        createPullRequestAnalysisService(await dataClientForProject(project.id)).start(
            prProject,
            {
                number,
                title: a?.title ?? "",
                body: a?.description ?? null,
                baseSha: a?.diff_refs?.base_sha ?? null,
                headSha: a?.diff_refs?.head_sha ?? a?.last_commit?.id ?? null,
                // GitLab spells the target branch target_branch.
                baseRef: a?.target_branch ?? null,
            },
            origin,
        ),
    )
    return ack()
}

// ── push → incremental graph update ─────────────────────────────────────────
async function handlePush(svc: Svc, project: GlProjectRow, payload: Record<string, unknown>): Promise<Response> {
    if (!project.auto_index_on_push) return ack()
    const ref = String((payload as { ref?: unknown }).ref ?? "")
    const headSha = String((payload as { after?: unknown }).after ?? "")
    // Three ways: the default branch drives the project's graph, a TRACKED
    // branch refreshes its own, anything else is dropped. Before this a tracked
    // branch went stale the moment anyone pushed to it.
    const defaultBranch = (payload.project as { default_branch?: string } | undefined)?.default_branch
    const pushedBranch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null
    if (!pushedBranch) return ack()
    const isDefaultBranch = Boolean(defaultBranch) && pushedBranch === defaultBranch
    if (/^0+$/.test(headSha)) return ack()

    const analyser = await tryOrNull(() => createSupabaseProjectAnalyserRepository(svc).findByProjectId(project.id))
    if (!analyser?.enabled || !analyser.graph_id) return ack()

    // Resolved before the no-op check, which otherwise compares a branch push
    // against the DEFAULT branch's sha.
    const tracked = isDefaultBranch
        ? null
        : await tryOrNull(() => createSupabaseProjectBranchRepository(svc).find(project.id, pushedBranch))
    if (!isDefaultBranch && !tracked) return ack()

    const indexedSha = tracked ? tracked.last_indexed_sha : analyser.last_indexed_sha
    if (indexedSha && indexedSha === headSha) return ack()

    // Which cell holds this graph. An unreadable cell acks rather than
    // retrying — redelivery won't fix a routing gap, it just replays the push.
    const cell = await tryOrNull(() => createSupabaseProjectsRepository(svc).findCell(project.id))
    if (!cell) {
        console.error("[gitlab webhook] unknown cell — skipping incremental index", project.id)
        return ack()
    }


    // Hard gate (0076). A paused team must not spend, and a push webhook is the
    // one billable path with nobody watching — it would keep indexing on every
    // commit forever. ACK rather than error: GitHub/GitLab redelivery cannot fix a
    // pause, and a failed webhook would just retry until it gave up.
    const payer = await tryOrNull(() => createSupabaseProjectsRepository(svc).findTeamId(project.id))
    const refusal = payer ? await getSpendGate().check(payer) : null
    if (!payer || refusal) {
        console.warn(
            `[gitlab webhook] ${payer ? `team ${payer} cannot spend (${refusal?.reason})` : "team unresolved"}` +
                ` — skipping incremental index for project ${project.id}`,
        )
        return ack()
    }
    const graphId = analyser.graph_id

    // A tracked branch refreshes its own graph and stops here.
    if (tracked) {
        const branchRepo = createSupabaseProjectBranchRepository(svc)
        await tryOrNull(() => branchRepo.markIndexing(project.id, pushedBranch))
        after(async () => {
            try {
                const gitAuth = await getGitlabCloneAuth(project.id)
                await getAnalyser(cell).startIndex({
                    job_type: "branch",
                    repo_url: project.repo_url,
                    repo_ref: pushedBranch,
                    // The push payload already names the default branch, so the
                    // base costs no extra API call here.
                    ...(defaultBranch ? { base_ref: defaultBranch } : {}),
                    repo_id: graphId,
                    user_id: project.user_id,
                    ...(gitAuth ? { git_auth: gitAuth } : {}),
                    // The BRANCH row, not the project's.
                    supabase_progress: { key_value: tracked.id },
                })
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e)
                console.error("[gitlab webhook] push → branch index failed", project.id, pushedBranch, message)
                await branchRepo.markFailed(project.id, pushedBranch, message).catch(() => {})
            }
        })
        return ack()
    }

    after(async () => {
        try {
            // Explicit git_auth (bot token + oauth2 user) so the analyser can clone
            // a private GitLab repo — its user_id path only knows github_tokens.
            const gitAuth = await getGitlabCloneAuth(project.id)
            await getAnalyser(cell).startIndex({
                job_type: "incremental",
                repo_url: project.repo_url,
                repo_id: graphId,
                user_id: project.user_id,
                ...(gitAuth ? { git_auth: gitAuth } : {}),
                supabase_progress: { key_value: project.id },
            })
        } catch (e) {
            console.error("[gitlab webhook] push → incremental kickoff failed", project.id, e)
        }
    })
    return ack()
}
