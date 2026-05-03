import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { Project } from "@/lib/supabase/types"
import { ProjectTabs } from "@/components/project-tabs"

// The project header (name + repo link) used to do a `select * from
// projects` synchronously, blocking every child page render behind
// it. Now the header is wrapped in <Suspense>; the tabs render
// immediately from the URL param, and `children` streams in parallel
// with the project lookup.
export default async function ProjectLayout({
    children,
    params,
}: {
    children: React.ReactNode
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    return (
        <div className="flex min-h-full flex-col">
            <div className="border-b border-[color:var(--c-border)] bg-white">
                <div className="mx-auto flex w-full max-w-5xl items-start justify-between gap-4 px-4 pt-5 sm:px-6 sm:pt-6">
                    <div className="min-w-0 max-w-full">
                        <Link
                            href="/projects"
                            className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]"
                        >
                            ← Projects
                        </Link>
                        <Suspense fallback={<HeaderSkeleton />}>
                            <ProjectHeader id={id} />
                        </Suspense>
                    </div>
                </div>
                <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
                    <ProjectTabs projectId={id} />
                </div>
            </div>
            <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</div>
        </div>
    )
}

async function ProjectHeader({ id }: { id: string }) {
    const supabase = await createClient()
    const { data: project } = await supabase
        .from("projects")
        .select("id,name,repo_url,repo_full_name")
        .eq("id", id)
        .maybeSingle<Pick<Project, "id" | "name" | "repo_url" | "repo_full_name">>()
    if (!project) notFound()
    return (
        <>
            <h1 className="mt-1 truncate text-[20px] font-bold tracking-[-0.012em] sm:text-[22px]">
                {project.name}
            </h1>
            <a
                href={project.repo_url}
                target="_blank"
                rel="noreferrer"
                className="block max-w-full truncate font-mono text-[12px] text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)] hover:underline"
            >
                {project.repo_full_name ? project.repo_full_name : project.repo_url}
            </a>
        </>
    )
}

function HeaderSkeleton() {
    return (
        <>
            <div className="skeleton mt-1 h-6 w-48 rounded-[6px] sm:h-7" />
            <div className="skeleton mt-1.5 h-3 w-64 max-w-full rounded-[4px]" />
        </>
    )
}
