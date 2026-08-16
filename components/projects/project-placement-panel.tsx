"use client"

import { FieldRow, FieldTable, MiniCard } from "@/components/ui/field-card"
import { useApi } from "@/lib/client/hooks/use-api"
import type { Project, TeamWithRole } from "@/lib/shared/types"

// Where a project's code index physically lives (0064). Read-only on purpose:
// placement is pinned when the TEAM is created, because moving it means
// rebuilding every knowledge graph the team owns at the destination. There is no
// toggle to offer here — only an honest answer to "where is my code being
// analysed?", which is the question a data-residency review actually asks.
//
// Resolved through the team rather than the project: since 0064 a team lives in
// exactly one region and everything it owns is served from there. Showing it on
// the project page anyway, because that is where someone thinks to look.
//
// Shows the REGION, never the cell. Which cell holds the data is an internal
// capacity detail; surfacing it would invite users to care about something they
// cannot act on and that we may rebalance underneath them.

/** `south-east-asia` → `South East Asia`. Mirrors deriveRegionLabel on the server
 *  rather than importing it: modules/* is server-side, and this is one line. */
function labelFor(region: string): string {
    return region
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
}

export function ProjectPlacementPanel({ projectId }: { projectId: string }) {
    const projectQ = useApi<{ project: Project | null }>(`/api/projects/${projectId}`)
    const teamId = projectQ.data?.project?.team_id
    // Only ask for teams once we know which one to look for; useApi skips a null path.
    const teamsQ = useApi<{ teams: TeamWithRole[] }>(teamId ? "/api/teams" : null)

    const region = teamsQ.data?.teams?.find((t) => t.id === teamId)?.region
    const loading = projectQ.loading || teamsQ.loading
    const failed = projectQ.error || teamsQ.error

    return (
        <MiniCard
            tone="cyan"
            interactive={false}
            icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
                </svg>
            }
            title="Data location"
            subtitle="Where this project is indexed and analysed"
        >
            <FieldTable>
                <FieldRow label="Region">
                    {loading ? (
                        <span className="text-[color:var(--c-text-muted)]">Loading…</span>
                    ) : failed || !region ? (
                        <span className="text-[color:var(--c-text-muted)]">Unknown</span>
                    ) : (
                        labelFor(region)
                    )}
                </FieldRow>
            </FieldTable>
            <p className="mt-2 text-[12px] text-[color:var(--c-text-muted)]">
                Set for the whole team when it was created, and shared by every project it owns. Changing it means
                re-indexing those repositories elsewhere — contact support if you need the team moved.
            </p>
        </MiniCard>
    )
}
