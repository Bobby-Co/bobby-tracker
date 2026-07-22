// VCS module — composition root. The ONE place that inspects a project's
// provider wiring and hands back the right bound instance for each authority
// (app/bot vs signed-in user) plus the app-level webhook verifier. Today every
// linked project is GitHub; when a second provider lands, this is the only file
// that branches on it. VcsAppService / VcsUserService and their callers depend on
// the PORTS and obtain implementations here — they never `new` an adapter.

import { createServiceIssueSyncStore } from "@/modules/issues"
import { createSupabaseProjectsRepository, Project } from "@/modules/projects"
import { createServiceClient } from "@/lib/server/supabase"
import { RepoRef } from "./domain/RepoRef"
import { VcsAppService } from "./application/VcsAppService"
import { VcsUserService } from "./application/VcsUserService"
import { PullRequestService } from "./application/PullRequestService"
import { GithubVcsAppInstance } from "./infrastructure/GithubVcsAppInstance"
import { GithubVcsUserInstance } from "./infrastructure/GithubVcsUserInstance"
import { githubWebhookVerifier } from "./infrastructure/GithubWebhookVerifier"
import { createServicePullRequestStore } from "./infrastructure/SupabasePullRequestStore"
import type { VcsAppInstance } from "./ports/VcsAppInstance"
import type { VcsUserInstance } from "./ports/VcsUserInstance"
import type { WebhookVerifier } from "./ports/WebhookVerifier"

/** Just the repo coordinates — all the USER-authority resolver needs (a personal
 *  token isn't tied to an app installation). */
export interface VcsRepoCoords {
    repo_url: string | null
    repo_full_name: string | null
}

/** The provider-wiring fields the APP resolver reads off a project. Adds the
 *  installation id to the repo coordinates; today only the GitHub ones exist. */
export interface VcsProviderBinding extends VcsRepoCoords {
    github_installation_id: number | null
}

/** owner/repo for a project's linked repo, or null when it can't be resolved.
 *  RepoRef.fullName() resolves from repo_full_name first, else parses repo_url; a null
 *  url just means "fall back to the name" (empty string → no match). */
function ownerRepo(project: VcsRepoCoords): [string, string] | null {
    const full = RepoRef.of({ repo_url: project.repo_url ?? "", repo_full_name: project.repo_full_name }).fullName()
    if (!full) return null
    const [owner, repo] = full.split("/")
    if (!owner || !repo) return null
    return [owner, repo]
}

/** The APP-authority instance for a project, or null when the project isn't
 *  linked to any VCS (no installation / no resolvable owner-repo). A null return
 *  is the signal to VcsAppService to no-op — a web-only project has no remote. */
export function resolveVcsAppInstance(project: VcsProviderBinding): VcsAppInstance | null {
    if (!project.github_installation_id) return null
    const or = ownerRepo(project)
    if (!or) return null
    return new GithubVcsAppInstance(project.github_installation_id, or[0], or[1])
}

/** The USER-authority instance for a project + the caller's already-resolved VCS
 *  token, or null when the project has no resolvable owner-repo. Acquiring the
 *  token (a DB read + scope check) is the service/gate's job, not the composition
 *  root's — this only binds a known token to the repo. */
export function resolveVcsUserInstance(repo: VcsRepoCoords, token: string): VcsUserInstance | null {
    const or = ownerRepo(repo)
    if (!or) return null
    return new GithubVcsUserInstance(token, or[0], or[1])
}

/** The app-level webhook verifier for the (single) configured provider. */
export function getWebhookVerifier(): WebhookVerifier {
    return githubWebhookVerifier
}

// ─── services ────────────────────────────────────────────────────────────────

/** The app/bot-authority orchestrator for a project, or null when the project
 *  isn't linked to any VCS (a web-only project has no remote to sync). Binds the
 *  resolved app instance to a fresh service-role IssueSyncStore for the sync
 *  bookkeeping. Callers do `const vcs = getVcsAppService(project); if (vcs) …`. */
export function getVcsAppService(project: VcsProviderBinding): VcsAppService | null {
    const instance = resolveVcsAppInstance(project)
    if (!instance) return null
    return new VcsAppService(instance, createServiceIssueSyncStore())
}

/** The user-authority orchestrator for a project + the caller's already-resolved
 *  VCS token, or null when the project has no resolvable owner-repo. */
export function getVcsUserService(repo: VcsRepoCoords, token: string): VcsUserService | null {
    const instance = resolveVcsUserInstance(repo, token)
    if (!instance) return null
    return new VcsUserService(instance)
}

/** The PR-mirror orchestrator for a project, or null when it isn't linked to any
 *  VCS. Binds the resolved app instance to a service-role PR store + the issues
 *  context's comment sink (issue-comment backfill writes that table). */
export function getPullRequestService(project: VcsProviderBinding): PullRequestService | null {
    const instance = resolveVcsAppInstance(project)
    if (!instance) return null
    const issues = createServiceIssueSyncStore()
    return new PullRequestService(instance, createServicePullRequestStore(), (projectId, comment) =>
        issues.upsertComment(projectId, comment),
    )
}

/** Resolve the PR-mirror service by project id — the ergonomic entry point for
 *  the backfill routes (which hold only an id). Fetches the project's sync
 *  context and gates on it being sync-ready; null when not linked/ready. */
export async function getPullRequestServiceForProject(projectId: string): Promise<PullRequestService | null> {
    const project = await createSupabaseProjectsRepository(createServiceClient()).findGithubSyncContext(projectId)
    if (!project || !Project.of(project).isSyncReady()) return null
    return getPullRequestService(project)
}

/** Hard-sync a project's existing remote issues into the tracker (the "import"
 *  action). Resolves the project's sync context then delegates to VcsAppService.
 *  The gating (sync-ready + inbound direction) lives in the service. */
export async function importExistingIssues(
    projectId: string,
): Promise<{ imported: number; total: number; skipped: number }> {
    const project = await createSupabaseProjectsRepository(createServiceClient()).findGithubSyncContext(projectId)
    if (!project) return { imported: 0, total: 0, skipped: 0 }
    const vcs = getVcsAppService(project)
    if (!vcs) return { imported: 0, total: 0, skipped: 0 }
    return vcs.importIssues({ projectId, userId: project.user_id }, project)
}
