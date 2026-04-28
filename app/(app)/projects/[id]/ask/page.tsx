import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { AskPanel } from "@/components/ask-panel"
import type { Project, ProjectAnalyser } from "@/lib/supabase/types"

export const dynamic = "force-dynamic"

export default async function AskPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const supabase = await createClient()

    const [{ data: project }, { data: analyser }] = await Promise.all([
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

    const ready =
        !!analyser?.enabled && analyser.status === "ready" && !!analyser.graph_id

    return (
        <div className="flex flex-col gap-4">
            <header>
                <h2 className="h-section">Ask</h2>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Ask anything about this repo. Answers cite specific files and line numbers from the indexed graph.
                </p>
            </header>

            {!ready ? (
                <div className="card">
                    <div className="text-[14px] font-bold text-[color:var(--c-text)]">
                        Index this project first
                    </div>
                    <p className="mt-1 text-[12.5px] text-[color:var(--c-text-muted)]">
                        Bobby-analyser needs to build a knowledge graph of the repo before it can answer questions. Enable the integration and run an index, then come back here.
                    </p>
                    <div className="mt-4">
                        <Link
                            href={`/projects/${id}/integrations`}
                            className="btn-primary inline-flex"
                        >
                            Go to Integrations
                        </Link>
                    </div>
                </div>
            ) : (
                <AskPanel
                    projectId={id}
                    repo={project ? { repo_url: project.repo_url, repo_full_name: project.repo_full_name } : null}
                    indexedSha={analyser?.last_indexed_sha ?? null}
                />
            )}
        </div>
    )
}
