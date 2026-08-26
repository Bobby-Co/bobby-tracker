"use client"

import { useParams } from "next/navigation"
import { useApi } from "@/lib/client/hooks/use-api"
import { AnalyserPanel } from "@/components/projects/analyser-panel"
import { AutoUpdatePanel } from "@/components/projects/auto-update-panel"
import { BranchIndexPanel } from "@/components/projects/branch-index-panel"
import { DuplicateSensitivityPanel } from "@/components/projects/duplicate-sensitivity-panel"
import { AnalyserDefaultEffort } from "@/components/projects/analyser-default-effort"
import { ReviewProfilePanel } from "@/components/projects/review-profile-panel"
import { VerifyPanel } from "@/components/projects/verify-panel"
import { KnowledgeSkeleton } from "@/components/projects/knowledge-skeleton"
import type { Project, ProjectAnalyser } from "@/lib/shared/types"
import { ProjectAnalyser as ProjectAnalyserModel } from "@/modules/analysis/domain/ProjectAnalyser"

// Intelligence tab — everything the project INFERS, as opposed to what it is
// told. The knowledge graph (AnalyserPanel builds it, VerifyPanel inspects it),
// how current it stays (AutoUpdatePanel), how hard it thinks by default
// (AnalyserDefaultEffort), and how readily it decides two issues are the same
// one (DuplicateSensitivityPanel).
//
// Named "Knowledge" while it only held the graph. Duplicate detection does not
// fit that word — it is inference over issue embeddings, which exist whether or
// not a repo has ever been indexed — but it fits "what this project works out
// for itself", which is what the tab has actually become. The route stays
// /knowledge: renaming it buys a tidier URL nobody reads, at the cost of a
// redirect maintained forever.
//
// These controls lived under "Integrations" beside GitHub-sync stubs once, which
// made that tab a junk drawer. The split that works is source of truth: told vs
// inferred.

type KnowledgeData = {
    project: Pick<Project, "id" | "repo_url" | "repo_full_name" | "team_id"> | null
    analyser: ProjectAnalyser | null
}

export default function KnowledgePage() {
    const { id } = useParams<{ id: string }>()
    const { data, error, loading } = useApi<KnowledgeData>(
        id ? `/api/projects/${id}/knowledge` : null,
    )

    if (loading) return <KnowledgeSkeleton />

    if (error) {
        return (
            <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800">
                {error}
            </div>
        )
    }

    const project = data?.project ?? null
    const state = data?.analyser ?? null
    const ready = ProjectAnalyserModel.from(state).isReady()

    return (
        <div className="flex flex-col gap-4">
            <header>
                <h2 className="h-section">Intelligence</h2>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Everything this project infers about itself: the knowledge graph behind suggestions and
                    reviews, and how eagerly it treats two issues as the same one.
                </p>
            </header>
            <AnalyserPanel projectId={id} state={state ?? null} />
            {/* Auto-update on push keeps the graph current on every commit. An
                indexing setting, so it lives here with the analyser controls. */}
            <AutoUpdatePanel projectId={id} />
            <BranchIndexPanel projectId={id} />
            {/* Default effort lives with the analyser settings. Only meaningful
                once the project has an indexed graph the preference keys to. */}
            {state?.graph_id && <AnalyserDefaultEffort projectId={id} />}
            {/* Duplicate detection reads the same embeddings the graph work
                produces, so it belongs with the rest of what the project infers
                rather than beside renaming and deletion in Settings. Placed
                after the graph controls because it is a tuning knob, not a
                prerequisite — and unlike the panels above it works whether or
                not a graph exists, since issue embeddings are independent of
                repo indexing. */}
            {/* Which reviewer this project's pull requests get (0077). Here rather
                than under Settings for the same reason the effort default is: it
                is a property of how this project THINKS, not of its identity. It
                works with or without an indexed graph — a profile a project can't
                use yet is still a choice worth recording. */}
            <ReviewProfilePanel projectId={id} teamId={project?.team_id ?? null} />
            <DuplicateSensitivityPanel projectId={id} />
            <VerifyPanel
                projectId={id}
                repo={project ? { repo_url: project.repo_url, repo_full_name: project.repo_full_name } : null}
                indexedSha={state?.last_indexed_sha ?? null}
                ready={ready}
                initialReport={(state?.last_health_report as unknown) || null}
                initialCheckedAt={state?.last_health_check_at ?? null}
            />
        </div>
    )
}
