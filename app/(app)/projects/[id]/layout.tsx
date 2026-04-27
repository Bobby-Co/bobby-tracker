import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { Project } from "@/lib/supabase/types"
import { ProjectTabs } from "@/components/project-tabs"

export default async function ProjectLayout({
    children,
    params,
}: {
    children: React.ReactNode
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const supabase = await createClient()
    const { data: project } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .single<Project>()
    if (!project) notFound()

    return (
        <div className="flex min-h-full flex-col">
            <div className="border-b border-zinc-200 dark:border-zinc-800">
                <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 pt-6">
                    <div className="min-w-0">
                        <Link href="/projects" className="text-xs text-zinc-500 hover:underline">
                            Projects
                        </Link>
                        <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">{project.name}</h1>
                        <a
                            href={project.repo_url}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-xs text-zinc-500 hover:underline"
                        >
                            {project.repo_url}
                        </a>
                    </div>
                </div>
                <div className="mx-auto w-full max-w-5xl px-6">
                    <ProjectTabs projectId={project.id} />
                </div>
            </div>
            <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">{children}</div>
        </div>
    )
}
