import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { ProjectForm } from "@/components/project-form"
import { WorkflowCard } from "@/components/workflow-card"
import type { Project } from "@/lib/supabase/types"

export const dynamic = "force-dynamic"

export default async function ProjectsPage() {
    const supabase = await createClient()
    const { data: projects } = await supabase
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false })
        .returns<Project[]>()

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
            <header>
                <h1 className="h-page">Projects</h1>
                <p className="mt-1 max-w-prose text-[13.5px] text-[color:var(--c-text-muted)]">
                    One project per repository. Issues, integrations, and the analyser knowledge base hang off it.
                </p>
            </header>

            <section className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-5 shadow-[var(--shadow-card)]">
                <div className="mb-1 inline-flex items-center gap-2">
                    <span className="card-tag card-tag-trigger">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" /></svg>
                        New
                    </span>
                </div>
                <h2 className="text-[15px] font-bold tracking-[-0.005em]">Create a project</h2>
                <p className="mt-0.5 text-[12.5px] text-[color:var(--c-text-muted)]">
                    Connect a Git repo and start filing issues.
                </p>
                <div className="mt-4">
                    <ProjectForm />
                </div>
            </section>

            <section>
                <h2 className="h-section mb-3">Your projects</h2>

                {(projects ?? []).length === 0 && (
                    <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white px-5 py-12 text-center text-[13px] text-[color:var(--c-text-muted)]">
                        No projects yet — create one above.
                    </div>
                )}

                <ul
                    className="grid gap-3 stagger"
                    style={{
                        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                        ["--stagger-step" as string]: "60ms",
                    } as React.CSSProperties}
                >
                    {(projects ?? []).map((p, i) => (
                        <li
                            key={p.id}
                            className="anim-rise"
                            style={{ ["--i" as string]: i } as React.CSSProperties}
                        >
                            <Link href={`/projects/${p.id}/issues`} className="block">
                                <WorkflowCard
                                    tag="action"
                                    tagLabel="Project"
                                    icon={<RepoIcon />}
                                    title={p.name}
                                    menu={<span className="card-menu-btn"><ChevronIcon /></span>}
                                    footer={
                                        <>
                                            <span className="inline-flex items-center gap-1">
                                                <ClockIcon />
                                                {new Date(p.updated_at).toLocaleDateString()}
                                            </span>
                                        </>
                                    }
                                >
                                    <div className="rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-2 font-mono text-[12px] text-[color:var(--c-text-muted)] truncate">
                                        {p.repo_full_name ? p.repo_full_name : p.repo_url}
                                    </div>
                                    {p.description && (
                                        <p className="text-[12.5px] leading-5 text-[color:var(--c-text-muted)]">
                                            {p.description}
                                        </p>
                                    )}
                                </WorkflowCard>
                            </Link>
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    )
}

function RepoIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 4h12a4 4 0 014 4v12H8a4 4 0 01-4-4V4z" />
            <path d="M4 16a4 4 0 014-4h12" />
        </svg>
    )
}
function ClockIcon() {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
        </svg>
    )
}
function ChevronIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M9 6l6 6-6 6" />
        </svg>
    )
}
