"use client"
// TEMPORARY harness — delete after verifying the project tile redesign.
//
// Drives real ProjectInsight rows (0047) through the real pickStatus, so what
// renders here is the same derivation the signed-in grid runs. The dashboards
// are OAuth-gated, so this unauthed route is the only way to eyeball the tile.

import { AppShell } from "@/components/layout/app-shell"
import { TeamProvider } from "@/lib/client/auth/team-context"
import { ProjectTile } from "@/components/projects/project-tile"
import { ProjectOrgGrid } from "@/components/projects/project-org-grid"
import type { Project, ProjectInsight } from "@/lib/shared/types"

const mk = (id: string, name: string, repo: string, description: string | null): Project => ({
    id, user_id: "u", team_id: "t", name, repo_url: `https://github.com/${repo}`, repo_full_name: repo,
    description, created_at: "2026-06-01T00:00:00.000Z", updated_at: "2026-06-20T00:00:00.000Z",
    github_installation_id: null, github_repo_id: null, github_sync_enabled: false,
    github_sync_direction: "both", github_sync_deletes: false, auto_index_on_push: true,
    duplicate_sensitivity: "medium",
    icon_name: null, provider: "github", gitlab_project_id: null, gitlab_host: null,
})

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const ins = (o: Partial<ProjectInsight>): ProjectInsight => ({
    project_id: "p", user_id: "u", open_total: 0, done_total: 0, urgent_open: 0,
    last_urgent_at: null, last_issue_created_at: null, recent_pr_opens: [],
    last_activity_at: hoursAgo(2), updated_at: hoursAgo(0), ...o,
})

// Same org (repo owner) → same colour. Varied orgs → varied palette colours.
// `note` states the variant pickStatus should pick, so the render is checkable.
const PROJECTS: { p: Project; insight: ProjectInsight | null; note: string }[] = [
    {
        p: mk("a1", "Bobby-ui", "bobby-co/Bobby-ui", "This is a deliberately long project description that should be truncated to a single line with an ellipsis."),
        insight: ins({ open_total: 1, done_total: 5, last_issue_created_at: hoursAgo(50) }),
        note: "progress → 5 / 6 · 2d ago (newest issue created)",
    },
    {
        p: mk("a2", "Bobby-api", "bobby-co/Bobby-api", null),
        insight: ins({ last_issue_created_at: hoursAgo(26) }),
        note: "clear → no issues open · 1d ago (newest issue created)",
    },
    {
        p: mk("a3", "Bobby-cli", "bobby-co/Bobby-cli", "Same org as the two above — same header colour."),
        insight: ins({ open_total: 4, done_total: 2, urgent_open: 1, last_urgent_at: hoursAgo(1), last_issue_created_at: hoursAgo(1) }),
        note: "critical → 1 urgent · 1h ago (the urgent issue)",
    },
    {
        p: mk("b1", "Pryter Web", "pryter/web", "Different org, different colour."),
        insight: ins({ open_total: 5, done_total: 2, recent_pr_opens: [minsAgo(12)], last_issue_created_at: hoursAgo(70) }),
        note: "pr → 1 PR · 12m ago (the PR, not the issue)",
    },
    {
        p: mk("b2", "Pryter Mobile", "pryter/mobile", "Same org as Pryter Web."),
        insight: ins({ open_total: 7, done_total: 2, last_issue_created_at: hoursAgo(5) }),
        note: "progress → 2 / 9 · 5h ago (newest issue created)",
    },
    {
        p: mk("c1", "Atlas", "acme/atlas", "Urgent outranks a fresh PR while its window holds."),
        insight: ins({ open_total: 6, done_total: 1, urgent_open: 2, last_urgent_at: hoursAgo(3), recent_pr_opens: [hoursAgo(1)], last_issue_created_at: hoursAgo(3) }),
        note: "critical → 2 urgent beats the 1h PR · 3h ago (the urgent issue)",
    },
    {
        p: mk("d1", "Octo Sync", "octo/sync", "PR window lapsed — same row, no writes, decayed on its own."),
        insight: ins({ open_total: 5, done_total: 2, recent_pr_opens: [hoursAgo(7), hoursAgo(20)], last_issue_created_at: hoursAgo(9) }),
        note: "progress → 2 / 7 · 9h ago — PRs (7h/20h) are past the 6h window, so the time reverts to the issue too",
    },
    {
        p: mk("e1", "Personal notes", "", "No repo owner → org falls back to the name."),
        insight: ins({ open_total: 9, done_total: 3, recent_pr_opens: [minsAgo(4), hoursAgo(3), hoursAgo(5)], last_issue_created_at: hoursAgo(80) }),
        note: "pr → 3 PRs · 4m ago (the newest of the three)",
    },
]

const GRID = "repeat(auto-fill, minmax(300px, 1fr))"

export default function PreviewDashboard() {
    return (
        <TeamProvider>
        <AppShell projects={PROJECTS.map((x) => x.p)}>
            <div className="flex w-full flex-col gap-6 px-5 py-6 sm:px-7 sm:py-7">
                <h1 className="h-page">Project tiles</h1>

                {/* What /projects actually renders now: minimal tiles, grouped by org,
                    each collapsible. The fixtures below are deliberately multi-org
                    (bobby-co ×3, pryter ×2, then three singletons) so grouping,
                    counts, and the shared header/tile tint are all checkable. */}
                <section className="flex flex-col gap-3">
                    <h2 className="text-[13px] font-bold tracking-[-0.01em]">
                        Grouped by organisation
                        <span className="ml-2 font-medium text-[color:var(--c-text-dim)]">
                            minimal tiles · click a header to collapse (persists)
                        </span>
                    </h2>
                    <ProjectOrgGrid projects={PROJECTS.map(({ p, insight }) => ({ ...p, insight }))} />
                </section>

                <section className="flex flex-col gap-3">
                    <h2 className="text-[13px] font-bold tracking-[-0.01em]">
                        Default
                        <span className="ml-2 font-medium text-[color:var(--c-text-dim)]">with the field table</span>
                    </h2>
                    <ul className="grid gap-3" style={{ gridTemplateColumns: GRID }}>
                        {PROJECTS.map(({ p, insight, note }) => (
                            <li key={p.id} className="flex flex-col gap-1.5">
                                <ProjectTile project={p} insight={insight} />
                                <p className="px-1 text-[11px] text-[color:var(--c-text-dim)]">{note}</p>
                            </li>
                        ))}
                    </ul>
                </section>
            </div>
        </AppShell>
        </TeamProvider>
    )
}
