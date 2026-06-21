"use client"

import { useParams } from "next/navigation"
import { useApi } from "@/lib/hooks/use-api"
import { AnalyserPanel } from "@/components/analyser-panel"
import { AnalyserDefaultEffort } from "@/components/analyser-default-effort"
import { VerifyPanel } from "@/components/verify-panel"
import { KnowledgeSkeleton } from "@/components/knowledge-skeleton"
import type { Project, ProjectAnalyser } from "@/lib/supabase/types"

// Knowledge tab — single home for everything that drives the project's
// analyser-backed knowledge graph: indexing controls (AnalyserPanel) +
// graph health report (VerifyPanel). Previously these lived under
// "Integrations" alongside GitHub-sync stubs; that conflation made
// the tab feel like a junk drawer. Knowledge keeps the cognitive
// model clear: this is where the graph is born and inspected.

type KnowledgeData = {
    project: Pick<Project, "id" | "repo_url" | "repo_full_name"> | null
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
    const ready = !!state?.enabled && state.status === "ready" && !!state.graph_id

    return (
        <div className="flex flex-col gap-4">
            <header>
                <h2 className="h-section">Knowledge</h2>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Index this project to build a knowledge graph. Verify it any time to see coverage and citation health.
                </p>
            </header>
            <AnalyserPanel projectId={id} state={state ?? null} />
            {/* Default effort lives with the analyser settings. Only meaningful
                once the project has an indexed graph the preference keys to. */}
            {state?.graph_id && <AnalyserDefaultEffort projectId={id} />}
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
