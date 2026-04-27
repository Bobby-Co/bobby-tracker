import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { ProjectForm } from "@/components/project-form"
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
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
            <header>
                <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
                <p className="mt-1 text-sm text-zinc-500">One project per repository. Issues, integrations, and the analyser knowledge base hang off it.</p>
            </header>

            <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="text-sm font-medium">New project</h2>
                <p className="mt-0.5 text-xs text-zinc-500">Connect a Git repo and start filing issues.</p>
                <div className="mt-4">
                    <ProjectForm />
                </div>
            </section>

            <section>
                <h2 className="text-sm font-medium">Your projects</h2>
                <ul className="mt-3 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
                    {(projects ?? []).length === 0 && (
                        <li className="px-5 py-8 text-center text-sm text-zinc-500">
                            No projects yet — create one above.
                        </li>
                    )}
                    {(projects ?? []).map((p) => (
                        <li key={p.id}>
                            <Link
                                href={`/projects/${p.id}/issues`}
                                className="flex items-center justify-between px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                            >
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-medium">{p.name}</div>
                                    <div className="truncate text-xs text-zinc-500">{p.repo_url}</div>
                                </div>
                                <div className="text-xs text-zinc-500">
                                    {new Date(p.updated_at).toLocaleDateString()}
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    )
}
