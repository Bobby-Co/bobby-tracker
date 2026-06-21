"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useApi } from "@/lib/hooks/use-api"
import { AskPanel } from "@/components/ask-panel"
import { AskSkeleton } from "@/components/ask-skeleton"
import type { Project, ProjectAnalyser } from "@/lib/supabase/types"

type KnowledgeData = {
    project: Pick<Project, "id" | "repo_url" | "repo_full_name"> | null
    analyser: ProjectAnalyser | null
}

export default function AskPage() {
    const { id } = useParams<{ id: string }>()
    const { data, error, loading } = useApi<KnowledgeData>(
        id ? `/api/projects/${id}/knowledge` : null,
    )

    if (loading) return <AskSkeleton />

    if (error) {
        return (
            <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800">
                {error}
            </div>
        )
    }

    const project = data?.project ?? null
    const analyser = data?.analyser ?? null
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
