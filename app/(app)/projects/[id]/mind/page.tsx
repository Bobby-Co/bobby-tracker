"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useApi } from "@/lib/hooks/use-api"
import { MindPanel } from "@/components/mind-panel"
import type { Project, ProjectAnalyser } from "@/lib/supabase/types"

type KnowledgeData = {
    project: Pick<Project, "id" | "repo_url" | "repo_full_name"> | null
    analyser: ProjectAnalyser | null
}

export default function MindPage() {
    const { id } = useParams<{ id: string }>()
    const { data, error, loading } = useApi<KnowledgeData>(
        id ? `/api/projects/${id}/knowledge` : null,
    )

    if (error) {
        return (
            <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
                <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800">
                    {error}
                </div>
            </div>
        )
    }

    const project = data?.project ?? null
    const analyser = data?.analyser ?? null
    const ready =
        !!analyser?.enabled && analyser.status === "ready" && !!analyser.graph_id

    // No skeleton during the morph — the chat shell is static and doesn't need
    // the knowledge payload to render. Show it immediately and let repo/indexedSha
    // (used only for citation links, which appear after an answer) fill in when
    // the fetch lands. Only fall back to the gate once we've loaded AND confirmed
    // the project isn't indexed yet.
    if (!loading && !ready) {
        return (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
                <header>
                    <h2 className="h-section">Mind</h2>
                    <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                        Ask anything about this repo. Bobby explores the codebase graph and answers with citations to specific files and lines.
                    </p>
                </header>
                <div className="card">
                    <div className="text-[14px] font-bold text-[color:var(--c-text)]">
                        Index this project first
                    </div>
                    <p className="mt-1 text-[12.5px] text-[color:var(--c-text-muted)]">
                        Bobby needs to build a knowledge graph of the repo before it can reason about it. Enable the integration and run an index, then come back here.
                    </p>
                    <div className="mt-4">
                        <Link href={`/projects/${id}/integrations`} className="btn-primary inline-flex">
                            Go to Integrations
                        </Link>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <MindPanel
            projectId={id}
            repo={project ? { repo_url: project.repo_url, repo_full_name: project.repo_full_name } : null}
            indexedSha={analyser?.last_indexed_sha ?? null}
        />
    )
}
