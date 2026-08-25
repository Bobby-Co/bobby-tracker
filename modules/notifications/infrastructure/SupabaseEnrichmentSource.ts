// Notifications infrastructure — the Supabase adapter for EnrichmentSource.
//
// Reads through OTHER MODULES' public contracts (projects, vcs) rather than
// querying their tables: the PR mirror is regional and the project row is
// central, and which is which is not this module's business to know.
//
// Every lookup is individually try/caught. A pruned mirror row, a region that
// can't be reached, a project deleted between the event and the send — each
// costs the mail one section, and none of them costs the send.

import { dataClientForProject } from "@/lib/server/regional"
import { Supabase } from "@/lib/server/supabase"
import type { PrAnalysis, PullRequest } from "@/lib/shared/types"
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { createServicePullRequestStore, createSupabasePullRequestReadRepository } from "@/modules/vcs"

import type { Enrichment, EnrichmentSource, EnrichmentSubject } from "../ports/EnrichmentSource"
import { NO_ENRICHMENT } from "../ports/EnrichmentSource"

/** The service-role client shape, taken from the projects module's own seam
 *  rather than restated — this adapter has no opinion about the generic. */
type ServiceDb = Parameters<typeof createSupabaseProjectsRepository>[0]

export class SupabaseEnrichmentSource implements EnrichmentSource {
    constructor(private readonly svc: ServiceDb) {}

    async load(subject: EnrichmentSubject): Promise<Enrichment> {
        const { projectId, prNumber, kind } = subject
        if (!projectId) return NO_ENRICHMENT

        const project = await this.loadProject(projectId)
        const base: Enrichment = {
            projectName: project?.name ?? null,
            repoFullName: project?.repo_full_name ?? null,
            pull: null,
            analysis: null,
        }
        if (prNumber === null) return base

        // Only the PR kinds have a mirror row worth fetching; a review also wants
        // the stored result, which is the bulk of what makes that mail useful.
        if (kind === "pr_opened") return { ...base, pull: await this.loadPull(projectId, prNumber) }
        if (kind === "pr_analysis_ready") {
            const [pull, analysis] = await Promise.all([this.loadPull(projectId, prNumber), this.loadAnalysis(projectId, prNumber)])
            return { ...base, pull, analysis }
        }
        return base
    }

    private async loadProject(projectId: string) {
        try {
            return await createSupabaseProjectsRepository(this.svc).findPullContext(projectId)
        } catch {
            return null
        }
    }

    // The mirror is regional, and this is a service-role context, so the read
    // side is bound to the project's data client rather than a caller's.
    private async loadPull(projectId: string, prNumber: number): Promise<PullRequest | null> {
        try {
            return await createSupabasePullRequestReadRepository(await dataClientForProject(projectId)).findByNumber(projectId, prNumber)
        } catch {
            return null
        }
    }

    private async loadAnalysis(projectId: string, prNumber: number): Promise<PrAnalysis | null> {
        try {
            return await createServicePullRequestStore(await dataClientForProject(projectId)).findAnalysisResult(projectId, prNumber)
        } catch {
            return null
        }
    }
}

/** Composition seam: bind an EnrichmentSource to a SERVICE-ROLE client (the
 *  project read and the regional client both need it). */
export function createSupabaseEnrichmentSource(svc?: ServiceDb): EnrichmentSource {
    return new SupabaseEnrichmentSource(svc ?? (Supabase.service() as ServiceDb))
}
