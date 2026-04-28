import { createClient } from "@/lib/supabase/server"
import { AnalyserPanel } from "@/components/analyser-panel"
import { VerifyPanel } from "@/components/verify-panel"
import type { Project, ProjectAnalyser } from "@/lib/supabase/types"

export const dynamic = "force-dynamic"

export default async function IntegrationsPage({ params }: { params: Promise<{ id: string }> }) {
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
                <h2 className="h-section">Integrations</h2>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Connect this project to bobby-analyser to power smart issue suggestions.
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

            <div className="card-stack">
                <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white p-5 text-[13px] text-[color:var(--c-text-muted)]">
                    <div className="text-[14px] font-bold text-[color:var(--c-text)]">GitHub Issues sync</div>
                    <p className="mt-1">Two-way sync of issues with the linked GitHub repo.</p>
                </div>
            </div>
        </div>
    )
}
