import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { AnalyserPanel } from "@/components/analyser-panel"
import { VerifyPanel } from "@/components/verify-panel"
import { KnowledgeSkeleton } from "@/components/knowledge-skeleton"
import type { Project, ProjectAnalyser } from "@/lib/supabase/types"

export const dynamic = "force-dynamic"

// Knowledge tab — single home for everything that drives the project's
// analyser-backed knowledge graph: indexing controls (AnalyserPanel) +
// graph health report (VerifyPanel). Previously these lived under
// "Integrations" alongside GitHub-sync stubs; that conflation made
// the tab feel like a junk drawer. Knowledge keeps the cognitive
// model clear: this is where the graph is born and inspected.
//
// Synchronous shell + <Suspense> so soft tab switches paint the
// skeleton instantly instead of stalling on the project_analyser fetch.
export default function KnowledgePage({ params }: { params: Promise<{ id: string }> }) {
    return (
        <Suspense fallback={<KnowledgeSkeleton />}>
            <KnowledgeContent params={params} />
        </Suspense>
    )
}

async function KnowledgeContent({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const supabase = await createClient()
    const [{ data: project }, { data: state }] = await Promise.all([
        supabase
            .from("projects")
            .select("id,repo_url,repo_full_name")
            .eq("id", id)
            .single<Pick<Project, "id" | "repo_url" | "repo_full_name">>(),
        supabase
            .from("project_analyser")
            .select("*")
            .eq("project_id", id)
            .maybeSingle<ProjectAnalyser>(),
    ])

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
