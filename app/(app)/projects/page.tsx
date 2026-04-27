import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { NewProjectButton } from "@/components/new-project-button"
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

    const list = projects ?? []

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
            <header className="flex items-end justify-between gap-4">
                <div>
                    <h1 className="h-page">Projects</h1>
                    <p className="mt-1 max-w-prose text-[13.5px] text-[color:var(--c-text-muted)]">
                        One project per repository. Issues, integrations, and the analyser knowledge base hang off it.
                    </p>
                </div>
                <NewProjectButton />
            </header>

            {list.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white px-5 py-16 text-center">
                    <div className="mx-auto grid h-10 w-10 place-items-center rounded-[10px] bg-[color:var(--c-surface-2)] text-[color:var(--c-text-dim)]">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <rect x="3" y="3" width="18" height="18" rx="3" />
                            <path d="M3 9h18M9 21V9" />
                        </svg>
                    </div>
                    <p className="mt-3 text-[14px] font-semibold">No projects yet</p>
                    <p className="mt-1 text-[12.5px] text-[color:var(--c-text-muted)]">
                        Create one to start tracking issues against a repo.
                    </p>
                    <div className="mt-4 flex justify-center">
                        <NewProjectButton />
                    </div>
                </div>
            ) : (
                <ul
                    className="grid gap-3 stagger"
                    style={{
                        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                        ["--stagger-step" as string]: "60ms",
                    } as React.CSSProperties}
                >
                    {list.map((p, i) => (
                        <li
                            key={p.id}
                            className="anim-rise"
                            style={{ ["--i" as string]: i } as React.CSSProperties}
                        >
                            <Link href={`/projects/${p.id}/issues`} className="block">
                                <WorkflowCard
                                    icon={<RepoIcon />}
                                    title={p.name}
                                    menu={<span className="card-menu-btn"><ChevronIcon /></span>}
                                    footer={
                                        <span className="inline-flex items-center gap-1">
                                            <ClockIcon />
                                            {new Date(p.updated_at).toLocaleDateString()}
                                        </span>
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
            )}
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
