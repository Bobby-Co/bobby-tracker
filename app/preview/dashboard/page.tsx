"use client"
// TEMPORARY harness — delete after verifying the project tile redesign.

import { AppShell } from "@/components/app-shell"
import { ProjectTile, type ProjectStatus } from "@/components/project-tile"
import type { Project } from "@/lib/supabase/types"

const mk = (id: string, name: string, repo: string, description: string | null): Project => ({
    id, user_id: "u", name, repo_url: `https://github.com/${repo}`, repo_full_name: repo,
    description, created_at: "2026-06-01T00:00:00.000Z", updated_at: "2026-06-20T00:00:00.000Z",
})

// Same org (repo owner) → same colour. Varied orgs → varied palette colours.
const PROJECTS: { p: Project; status?: ProjectStatus }[] = [
    { p: mk("a1", "Bobby-ui", "bobby-co/Bobby-ui", "This is a deliberately long project description that should be truncated to a single line with an ellipsis."), status: { kind: "progress", done: 5, total: 6 } },
    { p: mk("a2", "Bobby-api", "bobby-co/Bobby-api", null), status: { kind: "clear" } },
    { p: mk("a3", "Bobby-cli", "bobby-co/Bobby-cli", "Same org as the two above — same header colour."), status: { kind: "critical", count: 1 } },
    { p: mk("b1", "Pryter Web", "pryter/web", "Different org, different colour."), status: { kind: "pr", count: 1 } },
    { p: mk("b2", "Pryter Mobile", "pryter/mobile", "Same org as Pryter Web."), status: { kind: "progress", done: 2, total: 9 } },
    { p: mk("c1", "Atlas", "acme/atlas", "Critical issue variant."), status: { kind: "critical", count: 2 } },
    { p: mk("d1", "Octo Sync", "octo/sync", null), status: { kind: "clear" } },
    { p: mk("e1", "Personal notes", "", "No repo owner → org falls back to the name."), status: { kind: "pr", count: 3 } },
]

export default function PreviewDashboard() {
    return (
        <AppShell projects={PROJECTS.map((x) => x.p)}>
            <div className="flex w-full flex-col gap-6 px-5 py-6 sm:px-7 sm:py-7">
                <h1 className="h-page">Project tiles</h1>
                <ul className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
                    {PROJECTS.map(({ p, status }) => (
                        <li key={p.id}>
                            <ProjectTile project={p} status={status} />
                        </li>
                    ))}
                </ul>
            </div>
        </AppShell>
    )
}
